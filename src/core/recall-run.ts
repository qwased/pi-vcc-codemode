import { loadAllMessages, type LoadedMessages } from "./load-messages";
import { searchEntriesDetailed, getTouchedFiles, type SearchHit } from "./search-entries";
import { formatRecallOutput, formatTouchedOutput, TOUCHED_PAGE_SIZE } from "./format-recall";
import { getActiveLineageEntryIds, type LineageSessionManagerLike } from "./lineage";
import { expandEntryFile } from "./drill-down";
import type { RecallScope } from "./recall-scope";
import type { RecallRequest } from "./recall-request";
import type { Message, NestedToolCalls } from "@earendil-works/pi-ai";
import { isCodemodeMessage } from "../codemode/active";
import type { RenderedEntry } from "./render-entries";
import {
  readSavedRecord,
  scanSavedFields,
  SCAN_OUTPUT_CHARS,
  READ_MAX_LENGTH,
  type ReadOutcome,
  type ScanOutcome,
} from "./recall-full";

export const SEARCH_PAGE_SIZE = 5;
export const RANGE_PAGE_SIZE = 20;
export const RECENT_COUNT = 25;

/**
 * The session as one recall call sees it. Scope is applied here, once, and
 * every action reads through it. Loads are cached per call.
 */
export interface RecallView {
  sessionFile: string;
  scope: RecallScope;
  load(full: boolean): LoadedMessages;
  /** The same session with scope:'all' (itself when already 'all'). */
  widen(): RecallView;
  /**
   * #N of the turn in progress on the active path (its last user message and
   * everything after it), all in the agent's context. Empty when there is no
   * turn in progress or the context was compacted inside it.
   */
  currentTurn(): Set<number>;
  /** Entry ids on the active path; undefined for scope:'all'. */
  allowedEntryIds(): Set<string> | undefined;
  /** Every entry id on the current branch, for scan-cursor validity. */
  branchEntryIds(): Set<string>;
  /** Last entry id on the current branch (new scan cursor anchor). */
  branchAnchor(): string;
}

const lineageIdsOf = (sessionManager: LineageSessionManagerLike, scope: RecallScope): Set<string> | undefined =>
  scope === "lineage" ? getActiveLineageEntryIds(sessionManager) : undefined;

const branchIdsOf = (sessionManager: LineageSessionManagerLike): string[] => {
  try {
    return (sessionManager.getBranch() ?? [])
      .map((entry) => entry?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
};

export const openRecallView = (
  sessionFile: string,
  scope: RecallScope,
  sessionManager: LineageSessionManagerLike,
): RecallView => {
  const lineageEntryIds = lineageIdsOf(sessionManager, scope);
  const cache = new Map<boolean, LoadedMessages>();
  let wide: RecallView | undefined;
  let turn: Set<number> | undefined;
  const view: RecallView = {
    sessionFile,
    scope,
    load(full) {
      let loaded = cache.get(full);
      if (!loaded) {
        loaded = loadAllMessages(sessionFile, full, lineageEntryIds);
        cache.set(full, loaded);
      }
      return loaded;
    },
    widen() {
      if (scope === "all") return view;
      return (wide ??= openRecallView(sessionFile, "all", sessionManager));
    },
    currentTurn() {
      return (turn ??= findCurrentTurn(sessionFile, sessionManager));
    },
    allowedEntryIds() {
      return lineageEntryIds;
    },
    branchEntryIds() {
      return new Set(branchIdsOf(sessionManager));
    },
    branchAnchor() {
      return branchIdsOf(sessionManager).at(-1) ?? "";
    },
  };
  return view;
};

/**
 * Walk the active path back to the last user message. The tool runs from an
 * agent message pi has already written, so a turn is in progress only when
 * something follows that user message; a compaction in between means the
 * start of the turn may have left the context.
 */
const findCurrentTurn = (sessionFile: string, sessionManager: LineageSessionManagerLike): Set<number> => {
  const none = new Set<number>();
  let branch: any[] = [];
  try { branch = sessionManager.getBranch() ?? []; } catch { return none; }
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e?.type === "compaction") return none;
    if (e?.type === "message" && e.message?.role === "user") break;
  }
  const { rendered } = loadAllMessages(sessionFile, false, getActiveLineageEntryIds(sessionManager));
  for (let i = rendered.length - 1; i >= 0; i--) {
    if (rendered[i].role !== "user") continue;
    return i < rendered.length - 1 ? new Set(rendered.slice(i).map((m) => m.index)) : none;
  }
  return none;
};

/**
 * When the current conversation path has nothing for a query, range or
 * #N:path, recall answers from edited or retried branches instead and says so
 * on the first line. An explicit scope:'all' never needs this.
 */
const OFF_PATH_NOTE =
  "Nothing on the current conversation path; showing edited or retried branches (scope:'all').\n\n";

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
  requested.filter((i) => !Number.isInteger(i) || !available.has(i));

/** Surface-specific wording: the tool says page:N, the command says /pi-vcc-recall … page:N. */
export interface RecallPagingHints {
  outOfRange(query: string, scope: RecallScope, totalPages: number, truncated: boolean): string;
  nextPage(query: string, scope: RecallScope, page: number): string;
  /** Next step after a search page, pointing at its first hit. The command has none. */
  aroundHit?(index: number, scope: RecallScope): string;
  /** Resume a partial scan with its returned cursor. */
  scanNext?(query: string, cursor: string, scope: RecallScope): string;
  /** Read the next window from the returned actualEnd, not offset+length. */
  readNext?(index: number, offset: number, length: number, scope: RecallScope): string;
  /**
   * Leave the current turn (last user message on the path and everything after
   * it) out of search: the agent has it in context, and its question would
   * otherwise match itself. Only the tool sets this; a /pi-vcc-recall command
   * adds no user message, so the last one there belongs to a finished turn.
   */
  skipCurrentTurn?: boolean;
}


const IGNORED_REASON: Record<RecallRequest["action"]["kind"], string> = {
  drill: "a #N:path query runs alone",
  touched: "mode:'touched' runs alone",
  expand: "expand runs alone; send the rest in a separate call",
  range: "range runs alone; send the rest in a separate call",
  search: "",
  recent: "page applies to query or range results",
  scan: "",
  read: "",
  invalid: "",
};

/**
 * The path the parse actually chose, not the params the caller typed: a
 * `mode:"scan"` value is dropped and the call still runs as a hybrid query.
 * The label names the action; it does not claim the action found anything.
 */
const ACTION_LABEL: Record<RecallRequest["action"]["kind"], string> = {
  drill: "file-content lookup",
  touched: "touched files",
  expand: "entry expansion",
  range: "entry range",
  search: "hybrid query",
  recent: "recent entries",
  scan: "literal scan",
  read: "saved-record read",
  invalid: "none (invalid request)",
};

/** One line naming unused or dropped params and the action that ran, so nothing is silent. */
export const ignoredNote = (request: RecallRequest): string => {
  const items = [...(request.dropped ?? [])];
  if (request.ignored?.length) {
    const reason = IGNORED_REASON[request.action.kind];
    items.push(`${request.ignored.join(", ")}${reason ? ` (${reason})` : ""}`);
  }
  if (items.length === 0) return "";
  return `Ignored: ${items.join("; ")}; action: ${ACTION_LABEL[request.action.kind]}.\n\n`;
};

export const runRecall = (request: RecallRequest, view: RecallView, hints: RecallPagingHints): string =>
  ignoredNote(request) + runAction(request, view, hints);

const runAction = (request: RecallRequest, view: RecallView, hints: RecallPagingHints): string => {
  const { action } = request;
  const scopeAll = view.scope === "all";

  switch (action.kind) {
    case "drill": {
      // expandEntryFile loads unfiltered so #N stays aligned with the global
      // message index; scope only decides whether the entry is off-path.
      const t = action.target;
      const offPath = !scopeAll && !view.load(false).rendered.some((m) => m.index === t.index);
      return (offPath ? OFF_PATH_NOTE : "") +
        expandEntryFile(view.sessionFile, t.index, t.pathPattern, t.full, t.offset, t.limit);
    }

    case "touched":
      return runTouched(action.page, view);

    case "expand":
      return runExpand(action.indices, view);

    case "range":
      return runRange(action.range, action.page, view);

    case "search":
      return runSearch(action.query, action.page, view, hints, hints.skipCurrentTurn ? view.currentTurn() : undefined);

    case "scan":
      return runScan(action.query, action.cursor, view, hints);

    case "read":
      return runRead(action.index, action.offset, action.length, view, hints);

    case "invalid":
      return action.message;

    case "recent": {
      const { rendered } = view.load(false);
      return (scopeAll ? "Scope: all\n\n" : "") + formatRecallOutput(rendered.slice(-RECENT_COUNT), action.query);
    }
  }
};

/** Tool output shown with an expanded call, clipped so one expand cannot flood the context. */
export const PAIRED_RESULT_CHARS = 4000;

const toolCallIds = (msg: Message | undefined): string[] =>
  msg?.role === "assistant" && Array.isArray(msg.content)
    ? msg.content.flatMap((b: any) => (b?.type === "toolCall" && typeof b.id === "string" ? [b.id] : []))
    : [];

/**
 * Full text of the requested entries. An expanded tool call brings its tool
 * results along (matched by toolCallId, clipped to PAIRED_RESULT_CHARS), so
 * the agent does not have to know the result sits at a later #N. Entries off
 * the current path are served from the whole session and named in a note.
 */
const runExpand = (indices: number[], view: RecallView): string => {
  const pools = view.scope === "all" ? [view] : [view, view.widen()];
  const lookup = (i: number) => {
    for (const v of pools) {
      const { rendered, rawMessages } = v.load(true);
      const pos = rendered.findIndex((m) => m.index === i);
      if (pos >= 0) return { entry: rendered[pos], raw: rawMessages[pos], v, pos };
    }
    return undefined;
  };

  const found = indices.map((i) => ({ i, hit: Number.isInteger(i) ? lookup(i) : undefined }));
  const invalid = found.filter((f) => !f.hit).map((f) => f.i);
  if (invalid.length > 0) return `Cannot expand indices outside session history: ${invalid.join(", ")}`;

  const offPath = found.filter((f) => f.hit!.v !== view).map((f) => `#${f.i}`);
  const requested = new Set(indices);
  const out: SearchHit[] = [];
  for (const { hit } of found) {
    const { entry, raw, v, pos } = hit!;
    out.push(entry);
    const ids = new Set(toolCallIds(raw));
    if (ids.size === 0) continue;
    const { rendered, rawMessages } = v.load(true);
    for (let j = pos + 1; j < rendered.length && ids.size > 0; j++) {
      const r = rawMessages[j] as any;
      // A call's results come before the next assistant message; past it, a
      // reused id (after an interrupted call) belongs to a later call.
      if (r?.role === "assistant") break;
      if (r?.role !== "toolResult" || !ids.has(r.toolCallId)) continue;
      ids.delete(r.toolCallId);
      const res = rendered[j];
      if (requested.has(res.index)) continue;
      const summary = res.summary.length > PAIRED_RESULT_CHARS
        ? `${res.summary.slice(0, PAIRED_RESULT_CHARS)}\n...[result of #${entry.index} clipped at ${PAIRED_RESULT_CHARS} of ${res.summary.length} chars; expand:[${res.index}] for all of it]`
        : res.summary;
      out.push({ ...res, summary });
    }
  }

  const header = `Expanded ${indices.map((i) => `#${i}`).join(", ")}`;
  const note = offPath.length > 0
    ? `${offPath.join(", ")} ${offPath.length === 1 ? "is" : "are"} not on the current conversation path (edited or retried branch).\n\n`
    : "";
  return (view.scope === "all" ? "Scope: all\n\n" : "") + note + formatRecallOutput(out, undefined, header);
};

/**
 * Entries #from..#to in order, RANGE_PAGE_SIZE per page, same per-entry clip
 * as search and recent. Indices are the global #N space shared with summaries
 * (global-indices.ts), so a ref copied from a summary lands on its message.
 */
const runRange = (range: unknown[], page: number, view: RecallView): string => {
  const [from, to] = range;
  if (range.length !== 2 || !Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (from as number) > (to as number)) {
    return `Invalid range ${JSON.stringify(range)}: use range:[from, to] with two #N indices, from <= to.`;
  }
  const lo = from as number;
  let hi = to as number;
  const scopeAll = view.scope === "all";
  const { rendered } = view.load(false);
  let entries = rendered.filter((m) => m.index >= lo && m.index <= hi);

  if (entries.length === 0) {
    if (!scopeAll) {
      const wide = view.widen();
      if (wide.load(false).rendered.some((m) => m.index >= lo && m.index <= hi)) {
        return OFF_PATH_NOTE + runRange(range, page, wide);
      }
    }
    const last = rendered[rendered.length - 1];
    return `No messages #${lo}..#${hi} in session history${last ? ` (last entry is #${last.index})` : ""}.`;
  }

  // A range past the end is read up to the last entry, and the header says so.
  const lastIndex = rendered[rendered.length - 1].index;
  const clamped = hi > lastIndex;
  if (clamped) hi = lastIndex;

  const totalPages = Math.ceil(entries.length / RANGE_PAGE_SIZE);
  const counts = `${entries.length} messages${scopeAll ? ", scope: all" : ""}${clamped ? `, #${hi} is the last entry` : ""}`;
  if (page > totalPages) {
    return `Page ${page} is outside the available range 1-${totalPages} (#${lo}..#${hi}: ${counts}). Use a page between 1 and ${totalPages}.`;
  }
  const start = (page - 1) * RANGE_PAGE_SIZE;
  const header = totalPages > 1
    ? `Range #${lo}..#${hi}, page ${page}/${totalPages} (${counts})`
    : `Range #${lo}..#${hi} (${counts})`;
  const footer = page < totalPages
    ? `\n--- Use range:[${lo}, ${hi}] page:${page + 1}${scopeAll ? " scope:'all'" : ""} for the next ${RANGE_PAGE_SIZE} ---`
    : "";
  return formatRecallOutput(entries.slice(start, start + RANGE_PAGE_SIZE), undefined, header) + footer;
};

/**
 * Search with the current turn left out of the corpus, not just out of the
 * results: filtering afterwards let turn entries win the regex path (so the
 * term fallback never ran), set the relative floor, and fill the hit cap,
 * which hid earlier matches.
 */
const searchBefore = (view: RecallView, query: string, skip: Set<number> | undefined) => {
  const { rendered, rawMessages } = view.load(false);
  if (!skip?.size) return searchEntriesDetailed(rendered, rawMessages, query);
  const keep = rendered.map((m) => !skip.has(m.index));
  return searchEntriesDetailed(rendered.filter((_, i) => keep[i]), rawMessages.filter((_, i) => keep[i]), query);
};

const runSearch = (query: string, page: number, view: RecallView, hints: RecallPagingHints, skip?: Set<number>): string => {
  const { hits, totalBeforeCap, truncated } = searchBefore(view, query, skip);
  if (hits.length === 0 && view.scope === "lineage") {
    const wide = view.widen();
    if (searchBefore(wide, query, skip).hits.length > 0) {
      return OFF_PATH_NOTE + runSearch(query, page, wide, hints, skip);
    }
  }
  if (hits.length === 0 && skip?.size) {
    const inTurn = searchEntriesDetailed(view.load(false).rendered, view.load(false).rawMessages, query).hits
      .filter((h) => skip.has(h.index)).length;
    if (inTurn > 0) {
      return `No earlier matches for "${query}"; its ${inTurn} match${inTurn === 1 ? " is" : "es are"} in the current turn, which is already in your context.`;
    }
  }
  // Single source of truth for page count: hits.length, the same array
  // that's actually paginated below (already floor-filtered and capped).
  const totalPages = Math.ceil(hits.length / SEARCH_PAGE_SIZE);
  const scopeSuffix = view.scope === "all" ? " (scope: all)" : "";
  // The hard cap can discard genuine matches; hits.length alone would then
  // understate the real total. Say so explicitly. Neutral wording ("showing",
  // not "showing top"): regex-path hits are chronological with no relevance
  // score, so "top" would falsely imply a ranking only the BM25 path has.
  const truncationNote = truncated
    ? ` — showing ${hits.length} of ${totalBeforeCap} matches, refine your query for more precise results`
    : "";

  // The hard cap creates a fixed reachable page range (1..totalPages). A page
  // beyond it isn't "no matches": say which pages exist instead of falling
  // through to formatRecallOutput's zero-hit message, which would be false.
  if (hits.length > 0 && page > totalPages) {
    return `Page ${page} is outside the available range 1-${totalPages} ` +
      `(${hits.length} matches${scopeSuffix}${truncationNote}). ` +
      hints.outOfRange(query, view.scope, totalPages, truncated);
  }

  const start = (page - 1) * SEARCH_PAGE_SIZE;
  const pageHits = hits.slice(start, start + SEARCH_PAGE_SIZE);
  const header = totalPages > 1
    ? `Page ${page}/${totalPages} (${hits.length} total matches${scopeSuffix}${truncationNote})`
    : `${hits.length} matches${scopeSuffix}${truncationNote}`;
  const around = pageHits.length > 0 && hints.aroundHit ? hints.aroundHit(pageHits[0].index, view.scope) : "";
  const footer = page < totalPages ? hints.nextPage(query, view.scope, page + 1) : "";
  return formatRecallOutput(pageHits, query, header) + around + footer;
};

const scopeLabel = (scope: RecallScope): string => scope === "all" ? "scope: all" : "scope: lineage";

const boundScanOutput = (text: string): string => {
  if (text.length <= SCAN_OUTPUT_CHARS) return text;
  const marker = "\n[output truncated at the scan character budget]";
  return text.slice(0, SCAN_OUTPUT_CHARS - marker.length) + marker;
};

const formatScanOutcome = (
  outcome: ScanOutcome,
  query: string,
  scope: RecallScope,
  hints: RecallPagingHints,
): string => {
  if (!outcome.ok) return outcome.error!;
  if (outcome.missingFile) {
    return `No saved session history to scan (${scopeLabel(scope)}).`;
  }

  const lines: string[] = [
    `Scan of saved fields (literal, case-insensitive; ${scopeLabel(scope)}).`,
  ];
  const matches = `${outcome.totalHits} match${outcome.totalHits === 1 ? "" : "es"}`;
  if (outcome.hits.length === 0) {
    lines.push(outcome.complete
      ? `No matches. Scan complete: ${outcome.scanned} messages scanned.`
      : `No matches on this page. Scan is partial: ${outcome.scanned} messages scanned, ${matches} so far.`);
  } else {
    lines.push(`This page: ${outcome.hits.length} new match${outcome.hits.length === 1 ? "" : "es"}; ${matches} total; ${outcome.scanned} messages scanned.`);
    for (const hit of outcome.hits) {
      lines.push("", `#${hit.index} [${hit.role}] ${hit.snippet}`);
    }
  }
  if (outcome.malformed > 0) {
    lines.push("", `Coverage incomplete: ${outcome.malformed} malformed record${outcome.malformed === 1 ? "" : "s"} skipped.`);
  }
  if (outcome.complete) {
    lines.push("", "Scan complete.");
  } else {
    const next = outcome.nextCursor && hints.scanNext
      ? hints.scanNext(query, outcome.nextCursor, scope)
      : outcome.nextCursor
        ? `\n--- Continue scan with cursor:${outcome.nextCursor} ---`
        : "";
    if (next) lines.push(next);
  }
  return boundScanOutput(lines.join("\n"));
};

const formatReadOutcome = (
  outcome: ReadOutcome,
  requested: { index: number; offset: number; length: number },
  scope: RecallScope,
  hints: RecallPagingHints,
): string => {
  if (!outcome.ok) return outcome.error!;
  const offPath = outcome.offPath
    ? `#${outcome.index} is not on the current conversation path (edited or retried branch).\n\n`
    : "";
  const role = outcome.role ?? "entry";
  const window = outcome.window!;

  if (window.kind === "eof") {
    return offPath + (window.total === 0
      ? `#${outcome.index} [${role}] has no readable saved fields (excluded or empty record); nothing to read.`
      : `End of record #${outcome.index} [${role}] at offset ${window.total}; no more text.`);
  }
  if (window.kind === "out-of-range") {
    return offPath + `Offset ${requested.offset} is beyond record #${outcome.index} [${role}] (${window.total} chars). Use offset:${window.total} for EOF or offset:0 to restart.`;
  }
  if (window.kind === "length-too-small") {
    return offPath + `Record #${outcome.index} [${role}] at offset ${window.actualStart}: length ${requested.length} is too small for the next grapheme (needs ${window.required}). Re-call with offset:${window.actualStart} length:${window.required}.`;
  }
  if (window.kind === "grapheme-too-large") {
    return offPath + `Record #${outcome.index} [${role}] at offset ${window.actualStart}: the next grapheme is ${window.required} chars, exceeding the ${READ_MAX_LENGTH}-char read limit; this record cannot be paged past this point.`;
  }

  const lines: string[] = [
    `${offPath}#${outcome.index} [${role}] read ${window.actualStart}-${window.actualEnd} of ${window.total} chars${window.remaining > 0 ? `; ${window.remaining} remaining` : ""}`,
    "",
    window.text,
  ];
  if (outcome.pairedCallIndex !== undefined) {
    lines.push("", `Verified paired call: #${outcome.pairedCallIndex}.`);
  }
  if (outcome.pairedResultIndices.length > 0) {
    lines.push("", `Verified paired result${outcome.pairedResultIndices.length === 1 ? "" : "s"}: ${outcome.pairedResultIndices.map((i) => `#${i}`).join(", ")}.`);
  }
  if (window.remaining > 0) {
    const next = hints.readNext
      ? hints.readNext(outcome.index, window.actualEnd, requested.length, scope)
      : `\n--- Read next: read:{ index: ${outcome.index}, offset: ${window.actualEnd}, length: ${requested.length} } ---`;
    if (next) lines.push(next);
  }
  return lines.join("\n");
};

const runScan = (query: string, cursor: string | undefined, view: RecallView, hints: RecallPagingHints): string => {
  const outcome = scanSavedFields({
    sessionFile: view.sessionFile,
    query,
    scope: view.scope,
    cursor,
    allowedEntryIds: view.allowedEntryIds(),
    branchEntryIds: view.branchEntryIds(),
    branchAnchor: view.branchAnchor(),
  });
  return formatScanOutcome(outcome, query, view.scope, hints);
};

const runRead = (index: number, offset: number, length: number, view: RecallView, hints: RecallPagingHints): string => {
  const outcome = readSavedRecord({
    sessionFile: view.sessionFile,
    index,
    offset,
    length,
    allowedEntryIds: view.allowedEntryIds(),
  });
  return formatReadOutcome(outcome, { index, offset, length }, view.scope, hints);
};

const WRITES_FILE = /write|edit|patch/i;

/**
 * Nested file writes whose arguments Pi dropped because the record exceeded
 * its size limits. `touched` cannot name their paths, so it reports how many
 * there are and which script-call entries to expand.
 */
const sizeOmittedWrites = (
  messages: Message[],
  rendered: RenderedEntry[],
): { count: number; scriptEntries: number[] } => {
  const callIndexById = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "toolCall" && typeof part.id === "string") {
        callIndexById.set(part.id, rendered[i]?.index ?? i);
      }
    }
  }

  const byEntry = new Map<number, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isCodemodeMessage(msg)) continue;
    const resultIndex = rendered[i]?.index ?? i;
    const scriptIndex = msg.role === "toolResult"
      ? callIndexById.get(msg.toolCallId) ?? resultIndex
      : resultIndex;
    const calls = (msg as { nestedCalls?: NestedToolCalls }).nestedCalls?.calls ?? [];
    for (const call of calls) {
      if (!WRITES_FILE.test(call.name) || call.arguments !== undefined) continue;
      if (typeof call.argumentsBytes !== "number") continue;
      byEntry.set(scriptIndex, (byEntry.get(scriptIndex) ?? 0) + 1);
    }
  }
  const scriptEntries = [...byEntry.keys()].sort((a, b) => a - b);
  return { count: [...byEntry.values()].reduce((sum, n) => sum + n, 0), scriptEntries };
};

const sizeOmittedNote = (omitted: { count: number; scriptEntries: number[] }): string => {
  const { count, scriptEntries } = omitted;
  if (count === 0) return "";
  const shown = scriptEntries.slice(0, 5).map((n) => `#${n}`).join(", ");
  const more = scriptEntries.length > 5 ? `, +${scriptEntries.length - 5} more` : "";
  const record = count === 1 ? "its" : "their";
  const calls = count === 1 ? "call" : "calls";
  return `\n--- ${count} nested write/edit ${calls} not listed: Pi dropped ${record} arguments for size ` +
    `(script calls ${shown}${more}); use expand:[${scriptEntries[0]}] to read the script and its result ---`;
};

/** Files worked on, plus a ready #N:path call for the first file on the page that was written. */
const runTouched = (page: number | undefined, view: RecallView): string => {
  const { rendered, rawMessages } = view.load(false);
  const touched = getTouchedFiles(rawMessages, rendered);
  const omitted = sizeOmittedWrites(rawMessages, rendered);
  // "No file operations" would be false when every write lost its arguments.
  let text = touched.length === 0 && omitted.count > 0
    ? "No listable file operations found in session history."
    : formatTouchedOutput(touched, page);
  const start = (Math.max(1, page ?? 1) - 1) * TOUCHED_PAGE_SIZE;
  for (const tf of touched.slice(start, start + TOUCHED_PAGE_SIZE)) {
    // A failed nested call has no readable content to drill into.
    const write = [...tf.entries].reverse().find((e) => !e.status && WRITES_FILE.test(e.toolName));
    if (!write) continue;
    const name = tf.path.replace(/\\/g, "/").split("/").pop();
    text += `\n--- File content at an entry: query:'#${write.index}:${name}' ---`;
    break;
  }
  return text + sizeOmittedNote(omitted);
};
