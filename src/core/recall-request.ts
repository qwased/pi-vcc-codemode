import { parseDrillDown } from "./drill-down";
import { normalizeRecallMode, normalizeRecallScope, parseRecallScope, type RecallScope } from "./recall-scope";
import { READ_DEFAULT_LENGTH, READ_MAX_LENGTH } from "./recall-full";

export type DrillTarget = NonNullable<ReturnType<typeof parseDrillDown>>;

/** The one thing a recall call does. Exactly one action runs per call. */
export type RecallAction =
  | { kind: "drill"; target: DrillTarget }
  | { kind: "touched"; page?: number }
  | { kind: "expand"; indices: number[] }
  | { kind: "range"; range: unknown[]; page: number }
  | { kind: "search"; query: string; page: number }
  | { kind: "recent"; query?: string }
  | { kind: "scan"; query: string; cursor?: string }
  | { kind: "read"; index: number; offset: number; length: number }
  | { kind: "invalid"; message: string };

export interface RecallRequest {
  scope: RecallScope;
  action: RecallAction;
  /** Params the caller set that this action does not use. Defaults (page:1, expand:[]) are not listed. */
  ignored?: string[];
  /** Values normalizeToolParams could not repair and removed. */
  dropped?: string[];
}

export interface ReadToolTarget {
  index?: number;
  offset?: number;
  length?: number;
}

export interface RecallToolParams {
  query?: string;
  expand?: number[];
  range?: unknown[];
  page?: number;
  scope?: string;
  mode?: string;
  scan?: boolean;
  cursor?: string;
  read?: ReadToolTarget | number;
}

/** Where normalizeToolParams records values it had to drop; read by parseToolRequest. */
export const DROPPED_KEY = "_vccDropped";
/** Where normalizeToolParams records invalid new-action values; never silently dropped. */
export const INVALID_KEY = "_vccInvalid";

const KNOWN_PARAMS = new Set([
  "query", "range", "expand", "page", "scope", "mode",
  "scan", "cursor", "read", DROPPED_KEY, INVALID_KEY,
]);

/** 12, "12", "#12", " 12 " -> 12. Anything else -> undefined. */
const toIndex = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isInteger(v) ? v : undefined;
  if (typeof v === "string") {
    const m = v.trim().match(/^#?(\d+)$/);
    return m ? Number(m[1]) : undefined;
  }
  return undefined;
};

/** "12", "#12, #15", "12 15" -> numbers; undefined unless the whole string is #N tokens. */
const indexList = (s: string): number[] | undefined => {
  const t = s.trim().replace(/^\[|\]$/g, "");
  if (!/^\s*#?\d+(\s*[,\s]\s*#?\d+)*\s*$/.test(t)) return undefined;
  return (t.match(/\d+/g) ?? []).map(Number);
};

/**
 * Repair argument mistakes whose meaning is certain, before pi validates the
 * schema: numbers sent as strings or with a leading #, a single index where a
 * list is expected, a range written as "10-20" or reversed, enum values in
 * the wrong case, and a scope value put in mode. Values that cannot be
 * repaired are removed and listed under DROPPED_KEY, so the output names them
 * instead of pi rejecting the whole call or recall dropping them silently.
 *
 * New scan/read values are different: an invalid value is recorded under
 * INVALID_KEY and parseToolRequest returns an explicit error. Dropping it
 * would otherwise run a different action (a plain query) than the caller
 * asked for.
 */
export const normalizeToolParams = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const p: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const dropped: string[] = [];
  const invalid: string[] = [];
  const drop = (key: string, why: string) => { dropped.push(`${key} ${JSON.stringify(p[key])} (${why})`); delete p[key]; };

  for (const key of Object.keys(p)) {
    if (!KNOWN_PARAMS.has(key) && key !== DROPPED_KEY) drop(key, "not a vcc_recall param");
  }

  if (p.page !== undefined) {
    const n = toIndex(p.page);
    if (n !== undefined && n >= 1) p.page = n; else drop("page", "not a page number");
  }

  if (p.expand !== undefined) {
    const list = Array.isArray(p.expand) ? p.expand.map(toIndex)
      : typeof p.expand === "string" ? indexList(p.expand)
      : [toIndex(p.expand)];
    if (list && list.every((n) => n !== undefined)) p.expand = list; else drop("expand", "not #N indices");
  }

  if (p.range !== undefined) {
    let pair: (number | undefined)[] | undefined;
    if (Array.isArray(p.range)) pair = p.range.map(toIndex);
    else if (typeof p.range === "string") {
      const m = p.range.trim().match(/^\[?\s*#?(\d+)\s*(?:(?:-|\.\.|,|to)\s*#?(\d+)\s*)?\]?$/i);
      pair = m ? [Number(m[1]), Number(m[2] ?? m[1])] : undefined;
    } else pair = [toIndex(p.range)];
    // A single index reads just that entry.
    if (pair?.length === 1) pair = [pair[0], pair[0]];
    if (pair && pair.length === 2 && pair.every((n) => n !== undefined)) {
      const [a, b] = pair as number[];
      p.range = a <= b ? [a, b] : [b, a];
    } else drop("range", "not [from, to]");
  }

  for (const key of ["scope", "mode"] as const) {
    if (typeof p[key] === "string") p[key] = (p[key] as string).trim().toLowerCase();
  }
  if ((p.mode === "all" || p.mode === "lineage") && p.scope === undefined) {
    p.scope = p.mode;
    delete p.mode;
  }
  if (p.scope !== undefined && p.scope !== "lineage" && p.scope !== "all") drop("scope", "use 'lineage' or 'all'");
  if (p.mode !== undefined && p.mode !== "hybrid" && p.mode !== "touched") {
    drop("mode", p.mode === "scan"
      ? "use scan:true with query for a literal scan"
      : "use 'touched' or leave it out");
  }
  if (p.query !== undefined && typeof p.query !== "string") drop("query", "not text");

  if (p.scan !== undefined) {
    if (typeof p.scan === "boolean") {
      // already usable
    } else if (typeof p.scan === "string" && /^(true|false)$/i.test(p.scan.trim())) {
      p.scan = p.scan.trim().toLowerCase() === "true";
    } else {
      invalid.push(`scan ${JSON.stringify(p.scan)} (use true or false)`);
      delete p.scan;
    }
  }

  if (p.cursor !== undefined) {
    if (typeof p.cursor !== "string" || p.cursor.trim().length === 0) {
      invalid.push(`cursor ${JSON.stringify(p.cursor)} (not a scan cursor)`);
      delete p.cursor;
    } else {
      p.cursor = p.cursor.trim();
    }
  }

  if (p.read !== undefined) {
    let value = p.read;
    if (typeof value === "number") value = { index: value };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid.push(`read ${JSON.stringify(p.read)} (use { index, offset?, length? })`);
      delete p.read;
    } else {
      const r: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const key of Object.keys(r)) {
        if (!["index", "offset", "length"].includes(key)) {
          invalid.push(`read.${key} (not a read param)`);
          delete r[key];
        }
      }
      if (r.index === undefined) {
        invalid.push("read.index is required");
      } else {
        const n = toIndex(r.index);
        if (n !== undefined && n >= 0) r.index = n;
        else invalid.push(`read.index ${JSON.stringify(r.index)} (not a #N index)`);
      }
      if (r.offset !== undefined) {
        const n = toIndex(r.offset);
        if (n !== undefined && n >= 0) r.offset = n;
        else invalid.push(`read.offset ${JSON.stringify(r.offset)} (not a character offset)`);
      }
      if (r.length !== undefined) {
        const n = toIndex(r.length);
        if (n !== undefined && n >= 1 && n <= READ_MAX_LENGTH) r.length = n;
        else invalid.push(`read.length ${JSON.stringify(r.length)} (use 1-${READ_MAX_LENGTH})`);
      }
      if (invalid.length === 0) p.read = r;
      else delete p.read;
    }
  }

  if (dropped.length > 0) p[DROPPED_KEY] = dropped;
  if (invalid.length > 0) p[INVALID_KEY] = invalid;
  return p;
};

/**
 * Tool params -> request. The precedence lives here and only here:
 * explicit scan/read actions, then #N:path drill-down, then mode:'touched',
 * then expand, then range, then query search, then the most recent entries.
 * scan/read never fall through to another action: conflicting or invalid
 * parameters return an explicit error instead.
 */
export const parseToolRequest = (params: RecallToolParams): RecallRequest => {
  const scope = normalizeRecallScope(params.scope);
  const q = params.query?.trim();
  const indices = [...new Set(params.expand ?? [])];
  const hasRange = Array.isArray(params.range) && params.range.length > 0;
  const droppedRaw = (params as Record<string, unknown>)[DROPPED_KEY];
  const dropped = Array.isArray(droppedRaw) && droppedRaw.length > 0 ? droppedRaw.map(String) : undefined;
  const invalidRaw = (params as Record<string, unknown>)[INVALID_KEY];
  const invalid = Array.isArray(invalidRaw) && invalidRaw.length > 0 ? invalidRaw.map(String) : undefined;

  const base = (action: RecallAction): RecallRequest =>
    dropped ? { scope, action, dropped } : { scope, action };
  const fail = (message: string): RecallRequest => base({ kind: "invalid", message });

  if (invalid) return fail(`Invalid vcc_recall parameters: ${invalid.join(", ")}.`);

  const readRaw = params.read;
  if (readRaw !== undefined) {
    const extras: string[] = [];
    if (q) extras.push("query");
    if (params.expand !== undefined) extras.push("expand");
    if (params.range !== undefined) extras.push("range");
    if (params.page !== undefined) extras.push("page");
    if (params.mode !== undefined) extras.push("mode");
    if (params.scan !== undefined) extras.push("scan");
    if (params.cursor !== undefined) extras.push("cursor");
    if (extras.length > 0) {
      return fail(`read runs alone; remove ${extras.join(", ")} (scope is allowed).`);
    }
    const r = typeof readRaw === "number" ? { index: readRaw } : readRaw as ReadToolTarget;
    return base({
      kind: "read",
      index: r.index!,
      offset: r.offset ?? 0,
      length: r.length ?? READ_DEFAULT_LENGTH,
    });
  }

  if (params.scan === true || params.cursor !== undefined) {
    if (params.scan !== true) return fail("cursor requires scan:true; re-open the scan without a cursor.");
    if (!q) return fail("scan requires a query.");
    const extras: string[] = [];
    if (params.expand !== undefined) extras.push("expand");
    if (params.range !== undefined) extras.push("range");
    if (params.page !== undefined) extras.push("page");
    if (params.mode !== undefined) extras.push("mode");
    if (extras.length > 0) return fail(`scan runs alone with query and scope; remove ${extras.join(", ")}.`);
    return base({ kind: "scan", query: params.query!, cursor: params.cursor });
  }

  const set = {
    query: Boolean(q),
    expand: indices.length > 0,
    range: hasRange,
    page: (params.page ?? 1) > 1,
    touched: normalizeRecallMode(params.mode) === "touched",
  };
  const req = (action: RecallAction, uses: (keyof typeof set)[]): RecallRequest => {
    const ignored = (Object.keys(set) as (keyof typeof set)[])
      .filter((k) => set[k] && !uses.includes(k))
      .map((k) => (k === "touched" ? "mode" : k));
    const result = base(action);
    return ignored.length > 0 ? { ...result, ignored } : result;
  };

  const target = q ? parseDrillDown(q) : null;
  if (target) return req({ kind: "drill", target }, ["query"]);
  if (set.touched) return req({ kind: "touched", page: params.page }, ["touched", "page"]);
  if (set.expand) return req({ kind: "expand", indices }, ["expand"]);
  if (hasRange) return req({ kind: "range", range: params.range!, page: Math.max(1, params.page ?? 1) }, ["range", "page"]);
  if (q) return req({ kind: "search", query: params.query!, page: Math.max(1, params.page ?? 1) }, ["query", "page"]);
  return req({ kind: "recent", query: params.query }, []);
};

const COMMAND_SCAN_RE = /(?:^|\s)scan:(true|false)(?=\s|$)/i;
const COMMAND_CURSOR_RE = /(?:^|\s)cursor:(\S+)/i;
const COMMAND_READ_RE = /(?:^|\s)read:(\d+)(?=\s|$)/i;
const COMMAND_OFFSET_RE = /(?:^|\s)offset:(\d+)(?=\s|$)/i;
const COMMAND_LENGTH_RE = /(?:^|\s)length:(\d+)(?=\s|$)/i;

const invalidCommand = (scope: RecallScope, message: string): RecallRequest => ({
  scope,
  action: { kind: "invalid", message },
});

/** /pi-vcc-recall args -> request. A person types a query, scope:all and page:N only. */
export const parseCommandRequest = (args: string): RecallRequest => {
  const parsed = parseRecallScope(args.trim());
  const scope = parsed.scope;
  let text = parsed.text;

  const scanMatch = text.match(COMMAND_SCAN_RE);
  const scan = scanMatch ? scanMatch[1].toLowerCase() === "true" : undefined;
  if (scanMatch) text = text.replace(COMMAND_SCAN_RE, " ");

  const cursorMatch = text.match(COMMAND_CURSOR_RE);
  const cursor = cursorMatch?.[1];
  if (cursorMatch) text = text.replace(COMMAND_CURSOR_RE, " ");

  const readMatch = text.match(COMMAND_READ_RE);
  const offsetMatch = text.match(COMMAND_OFFSET_RE);
  const lengthMatch = text.match(COMMAND_LENGTH_RE);
  if (readMatch) text = text.replace(COMMAND_READ_RE, " ");
  if (offsetMatch) text = text.replace(COMMAND_OFFSET_RE, " ");
  if (lengthMatch) text = text.replace(COMMAND_LENGTH_RE, " ");

  const pageMatch = text.match(/\bpage:(\d+)\b/i);
  const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
  if (pageMatch) text = text.replace(/\bpage:\d+\b/i, " ");

  const rest = text.replace(/\s+/g, " ").trim();

  if (readMatch) {
    if (scan !== undefined || cursor !== undefined) {
      return invalidCommand(scope, "read runs alone; remove scan/cursor (scope is allowed).");
    }
    if (pageMatch) return invalidCommand(scope, "read runs alone; remove page (scope is allowed).");
    if (rest) return invalidCommand(scope, "read runs alone; send the query in a separate call.");
    const index = parseInt(readMatch[1], 10);
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
    const length = lengthMatch ? parseInt(lengthMatch[1], 10) : READ_DEFAULT_LENGTH;
    if (length < 1 || length > READ_MAX_LENGTH) {
      return invalidCommand(scope, `read length must be between 1 and ${READ_MAX_LENGTH}.`);
    }
    return { scope, action: { kind: "read", index, offset, length } };
  }

  if (offsetMatch || lengthMatch) {
    return invalidCommand(scope, "offset/length are only valid with read:N.");
  }

  if (scan === true) {
    if (pageMatch) return invalidCommand(scope, "scan runs alone; remove page (scope is allowed).");
    if (!rest) return invalidCommand(scope, "scan requires a query.");
    if (cursor !== undefined && cursor.trim().length === 0) {
      return invalidCommand(scope, "cursor is empty; re-open the scan without a cursor.");
    }
    return { scope, action: { kind: "scan", query: rest, cursor } };
  }

  if (cursor !== undefined) {
    return invalidCommand(scope, "cursor requires scan:true; re-open the scan without a cursor.");
  }

  const query = rest;
  if (!query) return { scope, action: { kind: "recent" } };
  return { scope, action: { kind: "search", query, page } };
};
