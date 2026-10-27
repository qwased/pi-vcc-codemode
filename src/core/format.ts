import type { SectionData } from "../sections";
import { graphemeStartAtOrBefore } from "./recall-full";

const section = (title: string, items: string[]): string => {
  if (items.length === 0) return "";
  const body = items.map((i) => `- ${i}`).join("\n");
  return `[${title}]\n${body}`;
};

/**
 * Join a categorized line's items, capped at `limit`. "head" keeps the
 * oldest and ends with "(+N more)" (right for a stable set like files);
 * "tail" keeps the newest and starts with "(+N earlier)" (right for a
 * recency ledger like Tracked Commands). stripCapMarker is its inverse, used
 * when a merge re-reads the line.
 */
export const capItems = (
  items: readonly string[],
  limit: number,
  joinWith: string,
  keep: "head" | "tail" = "head",
): string => {
  if (items.length <= limit) return items.join(joinWith);
  const over = items.length - limit;
  if (keep === "tail") return `(+${over} earlier) ` + items.slice(-limit).join(joinWith);
  return items.slice(0, limit).join(joinWith) + ` (+${over} more)`;
};

export const stripCapMarker = (text: string): string =>
  text.replace(/^\s*\(\+\d+ earlier\)\s*/, "").replace(/\s*\(\+\d+ (?:more|earlier)\)\s*$/, "");

export const BRIEF_MAX_LINES = 120;
const TUI_SAFE_LINE_CHARS = 120;

const wrapLine = (line: string, maxChars: number): string[] => {
  if (line.length <= maxChars) return [line];

  const indent = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)?/)?.[0] ?? "";
  const continuationIndent = indent ? " ".repeat(Math.min(indent.length, 8)) : "";
  const wrapped: string[] = [];
  let remaining = line;
  let prefix = "";

  while (prefix.length + remaining.length > maxChars) {
    const available = Math.max(20, maxChars - prefix.length);
    let splitAt = remaining.lastIndexOf(" ", available);
    if (splitAt < Math.floor(available * 0.5)) splitAt = available;

    wrapped.push(prefix + remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
    prefix = continuationIndent;
  }

  if (remaining) wrapped.push(prefix + remaining);
  return wrapped;
};

export const wrapLongLines = (text: string, maxChars = TUI_SAFE_LINE_CHARS): string =>
  text.split("\n").flatMap((line) => wrapLine(line, maxChars)).join("\n");

export const capBrief = (text: string): string => {
  const lines = text.split("\n");
  if (lines.length <= BRIEF_MAX_LINES) return text;
  const omitted = lines.length - BRIEF_MAX_LINES;
  const kept = lines.slice(-BRIEF_MAX_LINES);
  // Find first section header to avoid cutting mid-section
  const firstHeader = kept.findIndex((l) => /^\[.+\]/.test(l));
  const clean = firstHeader > 0 ? kept.slice(firstHeader) : kept;
  return `...(${omitted} earlier lines omitted)\n\n${clean.join("\n")}`;
};

export const RECALL_NOTE =
  "Use `vcc_recall` to search for prior work, decisions, and context from before this summary. " +
  "Do not redo work already completed.";

/**
 * Extra note for the new codemode path when a checkpoint itself was edited:
 * the summarized prefix before that checkpoint is deliberately not rebuilt.
 */
export const LIMITED_HISTORY_NOTE = "history limited by edited checkpoint; use recall";

/**
 * The new codemode brief's single reading note. Fixed English wording is part
 * of the agent-facing interface; tests pin it.
 */
export const HISTORICAL_NOTE =
  "Historical navigation, not current state or proof of success. User/assistant text and intent are past statements; " +
  "tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, " +
  "which may differ. Session Goal is a condensed excerpt; recall the original for constraints. " +
  "Use vcc_recall: scan searches saved fields; read pages through long records.";

/** Pre-0.1.3 note text, still stripped from summaries written by older versions. */
export const LEGACY_HISTORICAL_NOTE =
  "Historical navigation, not current state or proof of success. User/assistant text and intent are past statements; " +
  "tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, " +
  "which may differ. Use vcc_recall: scan searches saved fields; read pages through long records.";

export interface HeaderBudgetResult {
  text: string;
  usedChars: number;
  truncated: boolean;
  /** Whole header lines dropped; a clipped line is reported through `truncated`. */
  omittedItems: number;
}

/**
 * Fit the static header sections into their 20% share at whole-line
 * boundaries, ending with a counted omission marker. A single overlong item
 * is grapheme-safe clipped with an ellipsis instead of being dropped
 * mid-character. Very small budgets return an empty header; the caller keeps
 * the marker contract by not claiming completeness.
 */
export const trimHeaderToBudget = (text: string, maxChars: number): HeaderBudgetResult => {
  if (!text) return { text: "", usedChars: 0, truncated: false, omittedItems: 0 };
  const limit = Math.max(0, Math.floor(maxChars));
  if (text.length <= limit) {
    return { text, usedChars: text.length, truncated: false, omittedItems: 0 };
  }

  const lines = text.split("\n");
  const markerFor = (count: number): string =>
    `...(${count} header line${count === 1 ? "" : "s"} omitted)`;

  for (let keepCount = lines.length; keepCount >= 1; keepCount--) {
    const keptText = lines.slice(0, keepCount).join("\n");
    const omitted = lines.length - keepCount;
    const candidate = omitted > 0 ? `${keptText}\n${markerFor(omitted)}` : keptText;
    if (candidate.length <= limit) {
      return { text: candidate, usedChars: candidate.length, truncated: omitted > 0, omittedItems: omitted };
    }
  }

  // A single overlong first item is worth more than dropping the header
  // entirely: clip it at a grapheme boundary and mark the rest.
  const first = lines[0];
  const remaining = lines.length - 1;
  const marker = remaining > 0 ? markerFor(remaining) : "";
  const room = limit - marker.length - (marker ? 1 : 0) - 1;
  if (room > 0) {
    const end = graphemeStartAtOrBefore(first, room);
    if (end > 0) {
      const clipped = `${first.slice(0, end)}…${marker ? `\n${marker}` : ""}`;
      if (clipped.length <= limit) {
        return { text: clipped, usedChars: clipped.length, truncated: true, omittedItems: remaining };
      }
    }
  }

  // No item fits; keep only the counted marker when it fits.
  const markerOnly = markerFor(lines.length);
  if (markerOnly.length <= limit) {
    return { text: markerOnly, usedChars: markerOnly.length, truncated: true, omittedItems: lines.length };
  }
  return { text: "", usedChars: 0, truncated: true, omittedItems: lines.length };
};

export interface FormatSummaryOptions {
  capBriefTranscript?: boolean;
}

/** Header sections only, unwrapped (the new codemode path adds its own note). */
export const formatHeaderSections = (data: SectionData): string =>
  [
    section("Session Goal", data.sessionGoal),
    section("Files And Changes", data.filesAndChanges),
    section("Commits", data.commits),
    section("Tracked Commands", data.trackedCommands),
    section("Outstanding Context", data.outstandingContext),
    section("User Preferences", data.userPreferences),
  ].filter(Boolean).join("\n\n");

export const formatSummary = (data: SectionData, options: FormatSummaryOptions = {}): string => {
  const capBriefTranscript = options.capBriefTranscript ?? true;
  const headers = formatHeaderSections(data);

  const parts: string[] = [];
  if (headers) {
    parts.push(headers);
  }
  if (data.briefTranscript) {
    parts.push(capBriefTranscript ? capBrief(data.briefTranscript) : data.briefTranscript);
  }

  if (parts.length === 0) return "";

  // NOTE: RECALL_NOTE is intentionally NOT appended here.
  // It is appended once by `compile()` at the very end, after merge-with-previous,
  // to avoid the note compounding inside the brief transcript across compactions.
  return wrapLongLines(parts.join("\n\n---\n\n"));
};
