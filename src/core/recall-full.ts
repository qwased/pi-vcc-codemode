import type { Message, NestedToolCalls } from "@earendil-works/pi-ai";
import { basename } from "path";
import { statSync } from "fs";
import { forEachJsonlLine, type JsonlLinePosition } from "./jsonl";
import { isCountedMessageEntry } from "./global-indices";
import type { RecallScope } from "./recall-scope";

export const RECALL_TOOL_NAME = "vcc_recall";
export const SCAN_PAGE_HITS = 20;
export const SCAN_SNIPPET_CHARS = 200;
export const SCAN_OUTPUT_CHARS = 8000;
export const SCAN_BUDGET_MS = 3000;
export const READ_DEFAULT_LENGTH = 4000;
export const READ_MAX_LENGTH = 12000;

// ── canonical full-field view ─────────────────────────────────────────────

const field = (out: string[], path: string, value: string): void => {
  out.push(`[${path}]`, value);
};

/** Every saved JSON value under its field path, in save order. */
const appendJsonValue = (out: string[], path: string, value: unknown): void => {
  if (typeof value === "string") {
    field(out, path, value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    field(out, path, String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendJsonValue(out, `${path}.${i}`, item));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      appendJsonValue(out, `${path}.${key}`, nested);
    }
  }
};

const appendToolCall = (out: string[], path: string, part: any): void => {
  out.push(`[${path}] name=${part.name ?? ""} id=${part.id ?? ""}`);
  if (String(part.name ?? "").toLowerCase() === RECALL_TOOL_NAME) {
    field(out, `${path}.arguments`, "<excluded: recall tool arguments>");
    return;
  }
  appendJsonValue(out, `${path}.arguments`, part.arguments ?? {});
};

const appendNestedCalls = (out: string[], nested: NestedToolCalls): void => {
  field(out, "nestedCalls.complete", String(nested.complete));
  nested.calls.forEach((call, i) => {
    const prefix = `nestedCalls.calls.${i}`;
    out.push(`[${prefix}] name=${call.name ?? ""} id=${call.id ?? ""} status=${call.status ?? ""}`);
    if (typeof call.durationMs === "number") field(out, `${prefix}.durationMs`, String(call.durationMs));
    if (call.error) field(out, `${prefix}.error`, call.error);
    if (call.arguments !== undefined) {
      appendJsonValue(out, `${prefix}.arguments`, call.arguments);
    } else if (typeof call.argumentsBytes === "number") {
      field(out, `${prefix}.arguments`, `[arguments omitted by Pi; ${call.argumentsBytes} bytes]`);
    } else {
      field(out, `${prefix}.arguments`, "[arguments missing from saved record]");
    }
  });
};

/**
 * The complete saved text of one message, used by both scan and read. Field
 * boundaries are explicit and script/body text is never flattened. Typed
 * thinking/image parts, system messages, and the recall tool's own arguments
 * and results are excluded by record/part type; ordinary argument keys named
 * "thinking" or values that look like base64 are kept.
 */
export const fullViewOfMessage = (msg: Message, index: number): string => {
  if (!msg || msg.role === "system") return "";
  if (msg.role === "toolResult" && msg.toolName?.toLowerCase() === RECALL_TOOL_NAME) return "";

  const out: string[] = [];
  if ((msg as any).role === "bashExecution") {
    out.push(`#${index} [bashExecution]`);
    field(out, "command", (msg as any).command ?? "");
    field(out, "output", (msg as any).output ?? "");
    if ((msg as any).exitCode !== undefined) field(out, "exitCode", String((msg as any).exitCode));
    return out.join("\n");
  }

  out.push(`#${index} [${msg.role}]`);
  if (msg.role === "toolResult") {
    out.push(`[toolName] ${msg.toolName ?? ""}`);
    field(out, "toolCallId", msg.toolCallId ?? "");
    field(out, "isError", String(Boolean(msg.isError)));
  }

  const content = (msg as any).content;
  let visibleParts = 0;
  let recallCallsOnly = true;
  if (typeof content === "string") {
    field(out, "content", content);
    visibleParts = 1;
    recallCallsOnly = false;
  } else if (Array.isArray(content)) {
    content.forEach((part: any, i: number) => {
      if (!part || typeof part !== "object") return;
      if (part.type === "text" && typeof part.text === "string") {
        visibleParts++;
        recallCallsOnly = false;
        field(out, `content.${i}.text`, part.text);
        return;
      }
      if (part.type === "toolCall") {
        visibleParts++;
        appendToolCall(out, `content.${i}`, part);
        if (String(part.name ?? "").toLowerCase() !== RECALL_TOOL_NAME) recallCallsOnly = false;
        return;
      }
      // thinking, image, and every other typed media part are excluded by type.
    });
  }

  if (msg.role === "assistant" && visibleParts > 0 && recallCallsOnly) return "";

  if (msg.role === "toolResult") {
    const nested = (msg as { nestedCalls?: NestedToolCalls }).nestedCalls;
    if (nested) appendNestedCalls(out, nested);
  }

  return out.join("\n");
};

// ── grapheme-safe slicing ─────────────────────────────────────────────────

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const graphemeStartAtOrBefore = (text: string, offset: number): number => {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  let boundary = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index > offset) break;
    boundary = seg.index;
  }
  return boundary;
};

export const graphemeEndAfter = (text: string, offset: number): number => {
  if (offset >= text.length) return text.length;
  for (const seg of graphemeSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (end > offset) return end;
  }
  return text.length;
};

export type ReadWindow =
  | { kind: "ok"; actualStart: number; actualEnd: number; total: number; remaining: number; text: string }
  | { kind: "eof"; total: number }
  | { kind: "out-of-range"; total: number }
  | { kind: "length-too-small"; total: number; actualStart: number; required: number }
  | { kind: "grapheme-too-large"; total: number; actualStart: number; required: number };

export const readWindow = (view: string, offset: number, length: number): ReadWindow => {
  const total = view.length;
  if (offset === total) return { kind: "eof", total };
  if (offset > total) return { kind: "out-of-range", total };

  const actualStart = graphemeStartAtOrBefore(view, offset);
  let actualEnd = Math.min(actualStart + length, total);
  if (actualEnd < total) actualEnd = graphemeStartAtOrBefore(view, actualEnd);
  if (actualEnd <= actualStart) {
    const required = graphemeEndAfter(view, actualStart) - actualStart;
    return required > READ_MAX_LENGTH
      ? { kind: "grapheme-too-large", total, actualStart, required }
      : { kind: "length-too-small", total, actualStart, required };
  }
  return {
    kind: "ok",
    actualStart,
    actualEnd,
    total,
    remaining: total - actualEnd,
    text: view.slice(actualStart, actualEnd),
  };
};

// ── scan cursor ───────────────────────────────────────────────────────────

export interface ScanCursor {
  v: 1;
  /** Next unprocessed record's first byte. */
  nextByte: number;
  /** Session-global #N of the next unprocessed message entry. */
  nextIndex: number;
  /** File size fixed when the scan started. */
  maxBytes: number;
  scope: RecallScope;
  /** Lowercased literal query; the cursor is only valid for the same scan. */
  query: string;
  session: string;
  /** Branch entry id present when the scan started. */
  branch: string;
  totalHits: number;
  scanned: number;
  malformed: number;
}

export const encodeScanCursor = (cursor: ScanCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const decodeScanCursor = (raw: string): { ok: true; cursor: ScanCursor } | { ok: false; reason: string } => {
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "not a vcc_recall scan cursor" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1) {
    return { ok: false, reason: "unsupported cursor version" };
  }
  if (!isNonNegativeInt(parsed.nextByte) || !isNonNegativeInt(parsed.nextIndex) ||
      !isNonNegativeInt(parsed.maxBytes) || !isNonNegativeInt(parsed.totalHits) ||
      !isNonNegativeInt(parsed.scanned) || !isNonNegativeInt(parsed.malformed) ||
      parsed.maxBytes <= 0 || parsed.nextByte > parsed.maxBytes) {
    return { ok: false, reason: "malformed cursor bounds" };
  }
  if (parsed.scope !== "lineage" && parsed.scope !== "all") {
    return { ok: false, reason: "malformed cursor scope" };
  }
  if (typeof parsed.query !== "string" || parsed.query.length === 0 ||
      typeof parsed.session !== "string" || parsed.session.length === 0 ||
      typeof parsed.branch !== "string") {
    return { ok: false, reason: "malformed cursor identity" };
  }
  return { ok: true, cursor: parsed as ScanCursor };
};

/** Stable session identity: the session header id, or the file name. */
export const sessionIdentityOf = (sessionFile: string): string => {
  let id = "";
  try {
    forEachJsonlLine(sessionFile, (line) => {
      try {
        const entry = JSON.parse(line.toString("utf8"));
        if (entry?.type === "session" && typeof entry.id === "string") id = entry.id;
      } catch {
        // A malformed header falls back to the file name.
      }
      return false;
    });
  } catch {
    // Missing/unreadable files still get a stable name-based identity.
  }
  return id || basename(sessionFile);
};

// ── scan ──────────────────────────────────────────────────────────────────

export interface ScanHit {
  index: number;
  role: string;
  snippet: string;
}

export interface ScanOutcome {
  ok: boolean;
  error?: string;
  hits: ScanHit[];
  totalHits: number;
  scanned: number;
  malformed: number;
  complete: boolean;
  nextCursor?: string;
  missingFile?: boolean;
}

export interface ScanOptions {
  sessionFile: string;
  query: string;
  scope: RecallScope;
  cursor?: string;
  allowedEntryIds?: Set<string>;
  /** Entry ids on the current branch, for cursor validity. */
  branchEntryIds: Set<string>;
  /** Last branch entry id when the scan starts (stored in the cursor). */
  branchAnchor: string;
  maxMs?: number;
  now?: () => number;
}

const snippetAround = (view: string, queryLower: string): string => {
  const idx = view.toLowerCase().indexOf(queryLower);
  const radius = Math.max(0, Math.floor((SCAN_SNIPPET_CHARS - queryLower.length) / 2));
  // Start at the field label when it is close enough, so a hit does not echo
  // the "message #N [role]" header the formatter already prints.
  const fieldStart = idx >= 0 ? view.lastIndexOf("\n[", idx) : -1;
  const start = idx < 0
    ? 0
    : fieldStart >= 0 && idx - fieldStart <= SCAN_SNIPPET_CHARS
      ? fieldStart + 1
      : Math.max(0, idx - radius);
  const end = idx < 0
    ? Math.min(view.length, SCAN_SNIPPET_CHARS)
    : Math.min(view.length, idx + queryLower.length + radius);
  const raw = `${start > 0 ? "..." : ""}${view.slice(start, end).replace(/\n/g, " ").trim()}${end < view.length ? "..." : ""}`;
  return raw.length <= SCAN_SNIPPET_CHARS ? raw : raw.slice(0, SCAN_SNIPPET_CHARS);
};

const scanError = (error: string): ScanOutcome => ({
  ok: false, error, hits: [], totalHits: 0, scanned: 0, malformed: 0, complete: false,
});

/**
 * Literal, case-insensitive scan over the complete saved field view. One
 * message is the processing unit; records after `maxBytes` are never read, so
 * recall messages appended during a scan cannot extend it.
 */
export const scanSavedFields = (options: ScanOptions): ScanOutcome => {
  const queryLower = options.query.trim().toLowerCase();
  if (!queryLower) return scanError("scan requires a non-empty query");
  const session = sessionIdentityOf(options.sessionFile);

  let startByte = 0;
  let nextIndex = 0;
  let maxBytes = 0;
  let totalHits = 0;
  let scanned = 0;
  let malformed = 0;

  if (options.cursor) {
    const decoded = decodeScanCursor(options.cursor);
    if (!decoded.ok) {
      return scanError(`Invalid scan cursor (${decoded.reason}). Re-open the scan without a cursor.`);
    }
    const cursor = decoded.cursor;
    if (cursor.query !== queryLower) return scanError("This cursor belongs to a different scan query. Re-open the scan.");
    if (cursor.scope !== options.scope) return scanError("This cursor belongs to a different scope. Re-open the scan.");
    if (cursor.session !== session) return scanError("This cursor belongs to a different session. Re-open the scan.");
    if (cursor.branch && !options.branchEntryIds.has(cursor.branch)) {
      return scanError("The conversation branch changed since this scan started. Re-open the scan.");
    }
    let size: number;
    try {
      size = statSync(options.sessionFile).size;
    } catch {
      return scanError("The session file is no longer available. Re-open the scan.");
    }
    if (size < cursor.nextByte) {
      return scanError("The session file is shorter than the scan position (truncated or replaced). Re-open the scan.");
    }
    startByte = cursor.nextByte;
    nextIndex = cursor.nextIndex;
    maxBytes = cursor.maxBytes;
    totalHits = cursor.totalHits;
    scanned = cursor.scanned;
    malformed = cursor.malformed;
  } else {
    try {
      maxBytes = statSync(options.sessionFile).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { ok: true, hits: [], totalHits: 0, scanned: 0, malformed: 0, complete: true, missingFile: true };
      }
      return scanError(`Cannot read the session file: ${(err as Error).message}`);
    }
  }

  const hits: ScanHit[] = [];
  const maxMs = options.maxMs ?? SCAN_BUDGET_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let stop: { position: JsonlLinePosition; processed: boolean } | undefined;
  let lastPosition: JsonlLinePosition | undefined;
  let sawEnd = false;

  try {
    const finished = forEachJsonlLine(options.sessionFile, (line, position) => {
      if (now() - startedAt > maxMs) {
        stop = { position, processed: false };
        return false;
      }
      let entry: any;
      try {
        entry = JSON.parse(line.toString("utf8"));
      } catch {
        malformed++;
        return;
      }
      if (!isCountedMessageEntry(entry)) return;

      const index = nextIndex++;
      scanned++;
      lastPosition = position;

      const message = entry.message as Message;
      if (message.role === "system") return;
      if (options.scope === "lineage" && (!options.allowedEntryIds || !options.allowedEntryIds.has(entry.id))) return;

      const view = fullViewOfMessage(message, index);
      if (!view) return;
      if (!view.toLowerCase().includes(queryLower)) return;

      totalHits++;
      hits.push({ index, role: message.role, snippet: snippetAround(view, queryLower) });
      if (hits.length >= SCAN_PAGE_HITS) {
        stop = { position, processed: true };
        return false;
      }
    }, { start: startByte, maxEnd: maxBytes });
    sawEnd = finished && !stop;
  } catch (err) {
    return scanError(`Scan failed: ${(err as Error).message}`);
  }

  if (!sawEnd && !stop) {
    return scanError("The session file disappeared during the scan. Re-open the scan.");
  }

  let nextByte = maxBytes;
  if (stop) {
    nextByte = stop.processed ? stop.position.next : stop.position.start;
  } else if (lastPosition) {
    nextByte = lastPosition.next;
  } else {
    nextByte = startByte;
  }

  const complete = !stop || nextByte >= maxBytes;
  const outcome: ScanOutcome = {
    ok: true,
    hits,
    totalHits,
    scanned,
    malformed,
    complete,
  };
  if (!complete) {
    outcome.nextCursor = encodeScanCursor({
      v: 1,
      nextByte,
      nextIndex,
      maxBytes,
      scope: options.scope,
      query: queryLower,
      session,
      branch: options.branchAnchor,
      totalHits,
      scanned,
      malformed,
    });
  }
  return outcome;
};

// ── read ──────────────────────────────────────────────────────────────────

export interface ReadOptions {
  sessionFile: string;
  index: number;
  offset: number;
  length: number;
  /** Lineage entry ids; omitted for scope:'all'. */
  allowedEntryIds?: Set<string>;
}

export interface ReadOutcome {
  ok: boolean;
  error?: string;
  index: number;
  role?: string;
  entryId?: string;
  window?: ReadWindow;
  pairedResultIndices: number[];
  pairedCallIndex?: number;
  offPath: boolean;
}

const toolCallIdsOf = (msg: Message): Set<string> =>
  new Set(
    msg.role === "assistant" && Array.isArray(msg.content)
      ? msg.content.flatMap((part: any) =>
          part?.type === "toolCall" && typeof part.id === "string" ? [part.id] : [])
      : [],
  );

/** One saved record's full view plus its grapheme-safe window. */
export const readSavedRecord = (options: ReadOptions): ReadOutcome => {
  let messageIndex = 0;
  let lastIndex = -1;
  let found: { entry: any; message: Message; view: string } | undefined;
  let lastAssistant: { index: number; ids: Set<string> } | undefined;
  let pairedCallIndex: number | undefined;
  const pairedResultIndices: number[] = [];
  let collectIds: Set<string> | undefined;

  try {
    forEachJsonlLine(options.sessionFile, (line) => {
      let entry: any;
      try {
        entry = JSON.parse(line.toString("utf8"));
      } catch {
        return;
      }
      if (!isCountedMessageEntry(entry)) return;

      const index = messageIndex++;
      lastIndex = index;
      const message = entry.message as Message;

      if (!found) {
        if (index !== options.index) {
          if (message.role === "assistant") {
            lastAssistant = { index, ids: toolCallIdsOf(message) };
          }
          return;
        }
        found = { entry, message, view: fullViewOfMessage(message, index) };
        if (message.role === "toolResult" && lastAssistant?.ids.has(message.toolCallId)) {
          pairedCallIndex = lastAssistant.index;
        }
        if (message.role === "assistant") {
          const ids = toolCallIdsOf(message);
          if (ids.size > 0) collectIds = ids;
          else return false;
        } else {
          return false;
        }
        return;
      }

      // Collect verified results for a target assistant call, stopping at the
      // next assistant message so a reused id from a later interrupted call
      // cannot be attributed across boundaries.
      if (message.role === "assistant") return false;
      if (message.role === "toolResult" && collectIds?.has(message.toolCallId)) {
        pairedResultIndices.push(index);
        collectIds.delete(message.toolCallId);
        if (collectIds.size === 0) return false;
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Read failed: ${(err as Error).message}`,
      index: options.index,
      pairedResultIndices: [],
      offPath: false,
    };
  }

  if (!found) {
    return {
      ok: false,
      error: `Entry #${options.index} not found in session history${lastIndex >= 0 ? ` (last entry is #${lastIndex})` : ""}.`,
      index: options.index,
      pairedResultIndices: [],
      offPath: false,
    };
  }

  const offPath = options.allowedEntryIds
    ? !options.allowedEntryIds.has(found.entry?.id)
    : false;

  return {
    ok: true,
    index: options.index,
    role: found.message.role,
    entryId: typeof found.entry?.id === "string" ? found.entry.id : undefined,
    window: readWindow(found.view, options.offset, options.length),
    pairedResultIndices,
    pairedCallIndex,
    offPath,
  };
};
