import type { Message } from "@earendil-works/pi-ai";
import type { FileOps } from "../types";
import { normalize } from "./normalize";
import { filterNoise } from "./filter-noise";
import { buildSections } from "./build-sections";
import {
  formatSummary,
  formatHeaderSections,
  capBrief,
  capItems,
  stripCapMarker,
  trimHeaderToBudget,
  BRIEF_MAX_LINES,
  RECALL_NOTE,
  HISTORICAL_NOTE,
  LEGACY_HISTORICAL_NOTE,
  LIMITED_HISTORY_NOTE,
  wrapLongLines,
} from "./format";
import { COMMAND_SEPARATOR, COMMANDS_PER_NAME } from "../extract/tracked-commands";
import { selectRankedBriefBlocks, allocateBriefBudget, type BriefRankingOptions } from "./rank";
import { buildBriefCandidates, type BriefCandidateOptions } from "./brief";
import { briefHistoryHasCodemode, type BriefHistory } from "./brief-history";

export interface CompileInput {
  messages: Message[];
  previousSummary?: string;
  fileOps?: FileOps;
  /**
   * Session-global `#N` index per message position (see
   * src/core/global-indices.ts). Parallel to `messages`; a missing entry
   * renders as no ref (fail-closed). Omitted entirely → legacy positional.
   */
  sourceIndices?: Array<number | undefined>;
  /** See BuildSectionsInput.trackCommands (core/build-sections.ts) --
   * empty/omitted by default, threaded through from
   * PiVccSettings.trackCommands by the caller (hooks/before-compact.ts). */
  trackCommands?: readonly string[];
}

export interface RankedCompileInput extends CompileInput {
  ranking?: BriefRankingOptions;
  /**
   * Effective history rebuilt from the current branch (core/brief-history.ts).
   * When it holds codemode records (now or before edits), the new codemode
   * brief replaces the previous one instead of merging it.
   */
  briefHistory?: BriefHistory;
  /**
   * Whole-brief char budget for the new path (§7.1, hook-computed):
   * round(clamp(15 * historyBlockCount, 1100, 2000) * charsPerToken).
   * Without it the input keeps the legacy ranked path.
   */
  briefBudgetChars?: number;
  /** Internal ablation seam for the audit; production leaves it unset. */
  briefCandidateOptions?: BriefCandidateOptions;
}

export interface HeaderSectionDetail {
  name: string;
  /** Non-empty lines of this section in the trimmed header. */
  lines: number;
  /** Lines of this section dropped by the 20% header cap. */
  omitted: number;
}

/** Same-selection numbers for the audit (§9.3); no message content. */
export interface BriefPlanDetail {
  kind: "ok" | "budget-too-small" | "legacy";
  budgetChars: number;
  usedChars: number;
  reservedChars: number;
  noteChars: number;
  headerChars: number;
  headerTruncated: boolean;
  headerOmittedItems: number;
  headerSections: HeaderSectionDetail[];
  limited: boolean;
  counts: Record<string, number>;
}

export interface RankedCompileResult {
  summary: string;
  detail: BriefPlanDetail;
}

const HEADER_NAMES = ["Session Goal", "Files And Changes", "Commits", "Tracked Commands", "Outstanding Context", "User Preferences"];

const SEPARATOR = "\n\n---\n\n";

/** Extract a named section from summary text */
const sectionOf = (text: string, header: string): string => {
  const tag = `[${header}]`;
  const start = text.indexOf(tag);
  if (start < 0) return "";
  const after = text.slice(start);
  // Find next section header or separator
  const nextSection = HEADER_NAMES
    .filter((h) => h !== header)
    .map((h) => after.indexOf(`[${h}]`))
    .filter((n) => n > 0);
  const nextSep = after.indexOf("\n\n---\n\n");
  const candidates = [...nextSection, ...(nextSep > 0 ? [nextSep] : [])].sort((a, b) => a - b);
  const end = candidates[0];
  return (end ? after.slice(0, end) : after).trim();
};

/** Extract the brief transcript part (everything after ---) */
const briefOf = (text: string): string => {
  const idx = text.indexOf(SEPARATOR);
  if (idx < 0) return "";
  return text.slice(idx + SEPARATOR.length).trim();
};

/** Merge a header section */
const mergeHeaderSection = (header: string, prev: string, fresh: string): string => {
  // Outstanding Context is volatile -- always use fresh only
  if (header === "Outstanding Context") return fresh;
  if (!prev) return fresh;
  if (!fresh) return prev;

  // Files And Changes: merge by category (Modified/Created/Read), dedup paths
  if (header === "Files And Changes") {
    return mergeFileLines(prev, fresh);
  }

  // Tracked Commands: same categorized-merge shape as Files And Changes, but
  // categories are whatever command names the user configured in
  // trackCommands -- discover them from the actual text rather than a
  // fixed list, so a config change between compactions doesn't orphan a
  // category that was already recorded.
  if (header === "Tracked Commands") {
    return mergeTrackedCommandLines(prev, fresh);
  }

  // Session Goal, User Preferences: line-level dedup, cap
  const isClean = (l: string) => l.startsWith("- ") && !l.includes("<skill") && !l.includes("</skill");
  const prevLines = prev.split("\n").filter(isClean);
  const freshLines = fresh.split("\n").filter(isClean);
  const combined = [...new Set([...prevLines, ...freshLines])];
  const CAP = header === "Session Goal" ? 8 : header === "Commits" ? 8 : 15;
  const capped = combined.length > CAP ? combined.slice(-CAP) : combined;
  if (capped.length === 0) return "";
  return `[${header}]\n${capped.join("\n")}`;
};

/**
 * Generic categorized-section merge: parses "- Category: a, b, c (+N more)"
 * lines from both prev and fresh text, unions each category's items across
 * compactions (deduped via Set), and re-renders. Extracted from what used
 * to be Files And Changes' only inline implementation, in preparation for
 * a second categorized section reusing the identical shape (see the
 * follow-up `feat/track-commands-section` branch/PR).
 */
const mergeCategorizedLines = (
  categories: readonly string[],
  prev: string,
  fresh: string,
  splitOn: string,
  touchOnDup = false,
): Record<string, Set<string>> => {
  const merged: Record<string, Set<string>> = {};
  for (const cat of categories) merged[cat] = new Set();

  for (const text of [prev, fresh]) {
    for (const line of text.split("\n")) {
      for (const cat of categories) {
        const prefix = `- ${cat}: `;
        if (!line.startsWith(prefix)) continue;
        // Strip the overflow marker so it never merges back in as an entry.
        const rest = stripCapMarker(line.slice(prefix.length));
        for (const p of rest.split(splitOn)) {
          const trimmed = p.trim();
          if (!trimmed) continue;
          // touchOnDup: re-inserting an existing entry moves it to the
          // tail — with tail-capping this makes the section "N most-
          // recently-USED" rather than "N most-recently-first-seen".
          if (touchOnDup && merged[cat].has(trimmed)) merged[cat].delete(trimmed);
          merged[cat].add(trimmed);
        }
      }
    }
  }
  return merged;
};

const formatCategorizedLines = (
  header: string,
  merged: Record<string, Set<string>>,
  categories: readonly string[],
  joinWith: string,
  itemLimit = 10,
  keep: "head" | "tail" = "head",
): string => {
  const lines: string[] = [];
  for (const cat of categories) {
    if (merged[cat].size > 0) lines.push(`- ${cat}: ${capItems([...merged[cat]], itemLimit, joinWith, keep)}`);
  }
  if (lines.length === 0) return "";
  return `[${header}]\n${lines.join("\n")}`;
};

const FILE_CATEGORIES = ["Modified", "Created", "Read"] as const;

/** Merge Files And Changes by category, dedup paths across compactions */
const mergeFileLines = (prev: string, fresh: string): string => {
  const merged = mergeCategorizedLines(FILE_CATEGORIES, prev, fresh, ",");
  // Dedup: if already in Modified, drop from Created (file existed before)
  for (const p of merged.Modified) merged.Created.delete(p);
  return formatCategorizedLines("Files And Changes", merged, FILE_CATEGORIES, ", ");
};

/** Category names actually present in "- <name>: ..." lines in `text`. */
const discoverCategoryNames = (text: string): string[] => {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^- ([^:]+): /);
    if (m) names.add(m[1]);
  }
  return [...names];
};

/**
 * Merge Tracked Commands by whatever command names actually appear in prev/
 * fresh (not a fixed category list, since trackCommands is user-config).
 * Line format (separator, cap) is owned by extract/tracked-commands.ts.
 */
const mergeTrackedCommandLines = (prev: string, fresh: string): string => {
  const categories = [...new Set([...discoverCategoryNames(prev), ...discoverCategoryNames(fresh)])];
  const merged = mergeCategorizedLines(categories, prev, fresh, COMMAND_SEPARATOR, true);
  return formatCategorizedLines("Tracked Commands", merged, categories, COMMAND_SEPARATOR, COMMANDS_PER_NAME, "tail");
};

const mergeBriefTranscript = (prev: string, fresh: string): string => {
  if (!prev) return fresh;
  if (!fresh) return prev;
  return prev + "\n\n" + fresh;
};

const briefLineCount = (text: string): number =>
  text ? text.split("\n").length : 0;

const capBriefToLineBudget = (text: string, maxLines: number): string => {
  if (!text || maxLines <= 0) return "";
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(-maxLines);
  const firstHeader = kept.findIndex((l) => /^\[.+\]/.test(l));
  const clean = firstHeader > 0 ? kept.slice(firstHeader) : kept;
  const omitted = lines.length - clean.length;
  return `...(${omitted} earlier lines omitted)\n\n${clean.join("\n")}`;
};

const mergeBriefTranscriptWithFreshBudget = (prev: string, fresh: string): string => {
  if (!prev) return fresh;
  if (!fresh) return capBrief(prev);
  const freshLines = briefLineCount(fresh);
  const remainingPrevLines = Math.max(0, BRIEF_MAX_LINES - freshLines);
  const prevTail = capBriefToLineBudget(prev, remainingPrevLines);
  return prevTail ? `${prevTail}\n\n${fresh}` : fresh;
};

const mergePrevious = (prev: string, fresh: string, options: { preserveFreshBrief?: boolean } = {}): string => {
  // Merge header sections
  const headers = HEADER_NAMES
    .map((header) => {
      const freshSec = sectionOf(fresh, header);
      // The stored summary went through wrapLongLines; rejoin each item's
      // indented continuation lines so the per-section merges, which read
      // only "- " lines, see whole items.
      const prevSec = sectionOf(prev, header).replace(/\n[ \t]+(?=\S)/g, " ");
      return mergeHeaderSection(header, prevSec, freshSec);
    })
    .filter(Boolean);

  // Merge brief transcript
  const prevBrief = briefOf(prev);
  const freshBrief = briefOf(fresh);
  const mergedBrief = options.preserveFreshBrief
    ? mergeBriefTranscriptWithFreshBudget(prevBrief, freshBrief)
    : mergeBriefTranscript(prevBrief, freshBrief);

  const parts: string[] = [];
  if (headers.length > 0) {
    parts.push(headers.join("\n\n"));
  }
  if (mergedBrief) {
    parts.push(options.preserveFreshBrief ? mergedBrief : capBrief(mergedBrief));
  }

  return parts.join(SEPARATOR);
};

/** Header-only variant of mergePrevious for the new codemode path (§8.1). */
const mergeHeaderParts = (prev: string | undefined, fresh: string): string => {
  if (!prev) return fresh;
  return HEADER_NAMES
    .map((header) => {
      const freshSec = sectionOf(fresh, header);
      const prevSec = sectionOf(prev, header).replace(/\n[ \t]+(?=\S)/g, " ");
      return mergeHeaderSection(header, prevSec, freshSec);
    })
    .filter(Boolean)
    .join("\n\n");
};

interface CompileWithBriefBlocksOptions {
  briefBlocksFor?: (blocks: ReturnType<typeof normalize>) => ReturnType<typeof normalize>;
  capFreshBrief?: boolean;
  preserveFreshBriefOnMerge?: boolean;
}

const compileWithBriefBlocks = (input: CompileInput, options: CompileWithBriefBlocksOptions = {}): string => {
  const blocks = filterNoise(normalize(input.messages, input.sourceIndices));
  const briefBlocks = options.briefBlocksFor?.(blocks);
  const data = buildSections({ blocks, briefBlocks, fileOps: input.fileOps, trackCommands: input.trackCommands });
  const fresh = formatSummary(data, { capBriefTranscript: options.capFreshBrief ?? true });
  // Strip the known notes baked into prev summaries (legacy RECALL_NOTE and the
  // new-path HISTORICAL_NOTE) so merge doesn't re-stack them inside the brief.
  const prev = input.previousSummary
    ? stripKnownNotes(input.previousSummary)
    : undefined;
  const merged = prev ? mergePrevious(prev, fresh, { preserveFreshBrief: options.preserveFreshBriefOnMerge }) : fresh;
  if (!merged) return "";
  return wrapLongLines(merged + SEPARATOR + RECALL_NOTE);
};

/**
 * New codemode path: one brief rebuilt from the effective history, a single
 * reading note, and headers that are either merged from the previous summary
 * (no edits) or rebuilt from the effective history (edits, §8.1). The previous
 * brief transcript is never merged, so no old line can outlive its source.
 */
/** Non-empty line counts per `[Section]` in header text. */
const sectionLineCounts = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  let current: string | undefined;
  for (const line of text.split("\n")) {
    const header = line.match(/^\[(.+?)\]$/)?.[1];
    if (header) {
      current = header;
      if (!counts.has(header)) counts.set(header, 0);
      continue;
    }
    if (!current || !line.trim()) continue;
    counts.set(current, (counts.get(current) ?? 0) + 1);
  }
  return counts;
};

const compileWithEffectiveHistory = (
  input: RankedCompileInput,
  history: BriefHistory,
  budgetChars: number,
): RankedCompileResult => {
  const budget = Math.max(0, Math.floor(budgetChars));
  const blocks = filterNoise(normalize(input.messages, input.sourceIndices));
  const historyBlocks = filterNoise(normalize(history.messages as any, history.sourceIndices), {
    keepUserSourceIndex: true,
  });
  const candidates = buildBriefCandidates(historyBlocks, input.briefCandidateOptions);

  // Static headers: this round's new messages plus the existing merge rule
  // normally; with edits, the effective history is the only trusted source.
  const data = buildSections({
    blocks,
    headerBlocks: history.hasContextEdits ? historyBlocks : blocks,
    outstandingBlocks: blocks,
    fileOps: input.fileOps,
    trackCommands: input.trackCommands,
    briefText: "",
  });
  const freshHeader = formatHeaderSections(data);
  const headerText = history.hasContextEdits
    ? freshHeader
    : mergeHeaderParts(input.previousSummary ? stripKnownNotes(input.previousSummary) : undefined, freshHeader);

  // The note and its separator are fixed costs; the header gets at most 20%
  // of what remains, and unused quota returns to the body.
  const limited = history.limitedReason === "edited-checkpoint";
  const note = wrapLongLines(limited ? `${HISTORICAL_NOTE}\n${LIMITED_HISTORY_NOTE}` : HISTORICAL_NOTE);
  const headerCap = Math.max(0, Math.floor((budget - note.length - SEPARATOR.length) * 0.2));
  const trimmedHeader = trimHeaderToBudget(wrapLongLines(headerText), headerCap);
  const header = trimmedHeader.text;

  const bodySeparator = header && candidates.length > 0 ? SEPARATOR.length : 0;
  const reservedChars = note.length + SEPARATOR.length + header.length + bodySeparator;
  const selection = allocateBriefBudget(candidates, { maxChars: budget, reservedChars });

  const before = sectionLineCounts(headerText);
  const after = sectionLineCounts(header);
  const headerSections = HEADER_NAMES
    .filter((name) => (before.get(name) ?? 0) > 0)
    .map((name) => ({
      name,
      lines: after.get(name) ?? 0,
      omitted: Math.max(0, (before.get(name) ?? 0) - (after.get(name) ?? 0)),
    }));

  const detail: BriefPlanDetail = {
    kind: selection.kind,
    budgetChars: budget,
    usedChars: selection.usedChars,
    reservedChars: selection.reservedChars,
    noteChars: note.length,
    headerChars: header.length,
    headerTruncated: trimmedHeader.truncated,
    headerOmittedItems: trimmedHeader.omittedItems,
    headerSections,
    limited,
    counts: selection.counts,
  };

  // No fake empty summary: the caller decides what to do with an explicit
  // "does not fit" result (production budgets cannot reach it).
  if (selection.kind !== "ok") return { summary: "", detail };

  const parts = [header, selection.text].filter(Boolean);
  if (parts.length === 0) return { summary: "", detail };
  return { summary: wrapLongLines(parts.join(SEPARATOR) + SEPARATOR + note), detail };
};

const legacyDetail = (): BriefPlanDetail => ({
  kind: "legacy",
  budgetChars: 0,
  usedChars: 0,
  reservedChars: 0,
  noteChars: 0,
  headerChars: 0,
  headerTruncated: false,
  headerOmittedItems: 0,
  headerSections: [],
  limited: false,
  counts: {},
});

export const compile = (input: CompileInput): string =>
  compileWithBriefBlocks(input);

/**
 * Compile with the same-selection detail the audit reads (§7.4). The summary
 * is identical to `compileRanked`; only the reporting is additional.
 */
export const compileRankedWithDetail = (input: RankedCompileInput): RankedCompileResult => {
  if (input.briefHistory && input.briefBudgetChars != null && briefHistoryHasCodemode(input.briefHistory)) {
    return compileWithEffectiveHistory(input, input.briefHistory, input.briefBudgetChars);
  }
  const summary = compileWithBriefBlocks(input, {
    briefBlocksFor: (blocks) => selectRankedBriefBlocks(blocks, {
      ...input.ranking,
      fileOps: input.ranking?.fileOps ?? input.fileOps,
    }),
    capFreshBrief: false,
    preserveFreshBriefOnMerge: true,
  });
  return { summary, detail: legacyDetail() };
};

export const compileRanked = (input: RankedCompileInput): string =>
  compileRankedWithDetail(input).summary;

/**
 * A note as stored: wrapLongLines breaks it across lines (it is longer than
 * the wrap width), so match its words separated by any whitespace, together
 * with the separator in front of it.
 */
const notePattern = (note: string): RegExp =>
  new RegExp(
    "\\n*(?:---\\n+)?" +
      note.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") +
      "\\n*",
    "g",
  );

const RECALL_NOTE_RE = notePattern(RECALL_NOTE);
const HISTORICAL_NOTE_RE = notePattern(HISTORICAL_NOTE);
const LEGACY_HISTORICAL_NOTE_RE = notePattern(LEGACY_HISTORICAL_NOTE);

/**
 * Remove known notes from a previous summary before merging. The exact match
 * this replaced never found the wrapped RECALL_NOTE, so each compaction kept
 * the old note inside the brief and stacked one more; this also cleans those.
 * HISTORICAL_NOTE is stripped too so a new-path summary never re-stacks when
 * read back by either path.
 */
const stripKnownNotes = (text: string): string =>
  text
    .replace(HISTORICAL_NOTE_RE, "\n\n")
    .replace(LEGACY_HISTORICAL_NOTE_RE, "\n\n")
    .replace(RECALL_NOTE_RE, "\n\n")
    .trimEnd();
