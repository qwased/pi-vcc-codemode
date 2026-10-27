import type { NormalizedBlock, ActivityClass, ActivityEvidence, ScriptHint } from "../types";
import { isCodemodeToolName } from "../codemode/active";
import { classifyNestedActivity, activityClassForToolName, extractCode, condenseCodeTo, summarizeCodemodeBrief } from "../codemode/summary";
import { parseScriptHints } from "../codemode/intent";
import { clip } from "./content";
import { extractPath } from "./tool-args";
import { collapseSkillText } from "./skill-collapse";
import { graphemeStartAtOrBefore } from "./recall-full";

const TRUNCATE_USER = 256;
const SEGMENT_CLOSING_ASSISTANT_HEAD_WORDS = 120;
const SEGMENT_CLOSING_ASSISTANT_TAIL_WORDS = 120;
const ASSISTANT_HEAD_WORDS = 80;
const ASSISTANT_TAIL_WORDS = 120;

// Strip common self-reflective assistant prefixes that carry no semantic info.
// Conservative list: only removes the leading filler, preserves the actual content.
const SELF_TALK_PREFIX_RE =
  /^\s*(?:hmm|wait|actually|oh|okay|ok|well|so)[,.!\s-]+/i;

// ── noise filtering ──

const isNoiseUser = (text: string): boolean => {
  return !text.trim();
};

// ── truncation ──

// Unicode-aware word segmentation via Intl.Segmenter (built-in, zero dependency)
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Check if segment is a word (Bun's isWordLike is unreliable for alphanumeric tokens) */
const isWord = (seg: { segment: string; isWordLike?: boolean }): boolean =>
  seg.isWordLike || /[\p{L}\p{N}]/u.test(seg.segment);

// Common stop words — don't count toward budget
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "over",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no",
  "that", "this", "these", "those", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "who", "which", "what",
  "if", "then", "than", "when", "where", "how", "just", "also",
]);

const normalizeForTokenBudget = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const truncateTokens = (text: string, limit: number): string => {
  const flat = normalizeForTokenBudget(text);
  let count = 0;
  let lastEnd = 0;
  for (const seg of segmenter.segment(flat)) {
    if (isWord(seg)) {
      if (!STOP_WORDS.has(seg.segment.toLowerCase())) {
        count++;
        if (count > limit) {
          return flat.slice(0, lastEnd).trimEnd() + "...(truncated)";
        }
      }
    }
    lastEnd = seg.index + seg.segment.length;
  }
  return flat;
};

const significantWordSpans = (flat: string): { start: number; end: number }[] => {
  const words: { start: number; end: number }[] = [];
  for (const seg of segmenter.segment(flat)) {
    if (!isWord(seg)) continue;
    if (STOP_WORDS.has(seg.segment.toLowerCase())) continue;
    words.push({ start: seg.index, end: seg.index + seg.segment.length });
  }
  return words;
};


const truncateTokensHeadTail = (text: string, headLimit: number, tailLimit: number): string => {
  const flat = normalizeForTokenBudget(text);
  if (headLimit <= 0 || tailLimit <= 0) return flat;
  const words = significantWordSpans(flat);
  if (words.length <= headLimit + tailLimit) return flat;
  const head = flat.slice(0, words[headLimit - 1].end).trimEnd();
  const tail = flat.slice(words[words.length - tailLimit].start).trimStart();
  return `${head}\n...(middle truncated)...\n${tail}`;
};

const nextRenderableBlock = (blocks: NormalizedBlock[], index: number): NormalizedBlock | undefined => {
  for (let i = index + 1; i < blocks.length; i++) {
    if (blocks[i].kind !== "tool_result") return blocks[i];
  }
  return undefined;
};

const isSegmentClosingAssistant = (blocks: NormalizedBlock[], index: number): boolean => {
  if (blocks[index]?.kind !== "assistant") return false;
  const next = nextRenderableBlock(blocks, index);
  return !next || next.kind === "user";
};

// ── bash command compression ──

const BASH_CAP = 240;
const PIPE_TAIL_RE = /\s*\|\s*(?:head|tail|sort|wc|column|tr|cut|awk|uniq|python3|node|bun)(?:\s[^|]*)?$/;
// Preamble/boilerplate lines that carry no durable fact on their own. Dropped
// when a script has more informative lines, so `set -euo pipefail\ngit commit`
// renders the commit rather than the shell option.
const TRIVIAL_LINE_RE = /^(?:set\s+[-+]|cd\s+\S+$|export\s+\w+=|(?:source|\.)\s+\S+|pwd$|true$|:$|#)/;
// A real heredoc opener: `<<` at a command boundary — not preceded by a word
// char or `)`, so shift ops (`8 << 20`, `Rd<<8`) are not misread — with an
// identifier terminator starting [A-Za-z_], so numeric `<< 10` is rejected too.
export const HEREDOC_OPEN_RE = /(?<![\w)])<<-?\s*["']?([A-Za-z_]\w*)["']?/;
// File-writer heredocs (`cat > f <<EOF`, tee, dd) already name their target, so
// the opener alone is informative → body-only. EVERY other heredoc has a
// content-free opener (interpreters python3/node, remote shells `ssh host <<CMD`,
// sqlite3, ...) → we surface a one-line body preview. This denylist replaces an
// interpreter allowlist that missed ssh/sqlite3/etc. and mis-handled heredocs
// combined with a `>` redirect.
const FILEWRITER_HEREDOC_RE = /(?:^|[|&;]\s*)(?:cat|tee|dd)\b/;
const HEREDOC_BODY_CAP = 80;
// Body lines that are pure boilerplate and make a poor preview.
const BODY_NOISE_RE = /^(?:import\s|from\s+\S+\s+import|require\(|const\s+\w+\s*=\s*require|#|\/\/|"""|'''|"use strict"|use\s+strict|<\?php)/;

/**
 * If `lines[i]` opens a heredoc whose terminator actually appears on a later
 * line, return that terminator's line index; otherwise -1. Callers use -1 to
 * leave following lines intact instead of treating a stray `<<` (a shift op, a
 * quoted string, or a truncated body) as a heredoc and skipping real commands.
 */
export const heredocCloseIndex = (lines: string[], i: number): number => {
  const hd = lines[i].match(HEREDOC_OPEN_RE);
  if (!hd) return -1;
  const term = hd[1];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === term) return j;
  }
  return -1;
};

const stripCdPrefix = (line: string): string => line.replace(/^cd\s+\S+\s*&&\s*/, "").trim();
const stripPipeTail = (line: string): string => {
  let c = line;
  for (let i = 0; i < 3; i++) {
    const stripped = c.replace(PIPE_TAIL_RE, "");
    if (stripped === c) break;
    c = stripped;
  }
  return c.trim();
};

/**
 * Semantic compression of a (possibly multi-line) bash command.
 * 1. Drop heredoc BODIES (keep the opener line, e.g. `cat > f <<EOF` or
 *    `python3 - <<PY`): the body is prose/script content that bloats the brief
 *    without adding countable facts, while the opener still records what ran.
 * 2. Drop trivial preamble lines (set -euo pipefail, cd-only, export, source,
 *    comments) unless they are the ONLY line, so real work below them surfaces.
 * 3. Strip `cd <path> &&` prefixes and pipe-tail formatting per line.
 * 4. Join the remaining meaningful lines with `; ` and cap length.
 */
const compressBash = (raw: string): string => {
  // Pass 1: keep heredoc opener lines, skip their bodies + terminators.
  const rawLines = raw.split("\n");
  const withoutHeredocBodies: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    withoutHeredocBodies.push(line);
    // Only treat this as a heredoc when its terminator appears downstream; a
    // stray `<<` (string/expression or truncated body) leaves later lines intact.
    const close = heredocCloseIndex(rawLines, i);
    if (close === -1) continue;
    // File-writer heredocs (`cat > f <<EOF`) name their target → keep opener only.
    // Every other heredoc has a content-free opener → grab the first meaningful
    // body line as a preview (`python3 - <<PY`, `ssh host <<CMD`, `sqlite3 <<SQL`).
    const wantPreview = !FILEWRITER_HEREDOC_RE.test(line);
    let preview = "";
    for (let j = i + 1; wantPreview && !preview && j < close; j++) {
      const t = rawLines[j].trim();
      if (t && !BODY_NOISE_RE.test(t)) preview = t;
    }
    if (preview) {
      const clipped = preview.length > HEREDOC_BODY_CAP ? preview.slice(0, HEREDOC_BODY_CAP - 1) + "\u2026" : preview;
      withoutHeredocBodies[withoutHeredocBodies.length - 1] = `${line.trim()} ${clipped}`;
    }
    i = close; // for-loop's i++ then skips past the terminator line
  }

  const lines = withoutHeredocBodies.map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return raw.trim();

  const meaningful = lines
    .filter(l => !TRIVIAL_LINE_RE.test(l))
    .map(l => stripPipeTail(stripCdPrefix(l)))
    .filter(Boolean);
  // If everything was trivial (e.g. a bare `set -e` or `ls`), fall back to the
  // first line so we never emit an empty marker.
  const chosen = meaningful.length ? meaningful : [stripPipeTail(stripCdPrefix(lines[0]))].filter(Boolean);

  const cmd = chosen.join("; ");
  if (cmd.length > BASH_CAP) {
    return cmd.slice(0, BASH_CAP - 3) + "...";
  }
  return cmd;
};

// ── tool summary ──

const TOOL_SUMMARY_FIELDS: Record<string, string> = {
  Read: "file_path", Edit: "file_path", Write: "file_path",
  read: "file_path", edit: "file_path", write: "file_path",
  Glob: "pattern", Grep: "pattern",
};

const toolOneLiner = (name: string, args: Record<string, unknown>): string => {
  const field = TOOL_SUMMARY_FIELDS[name];
  if (field && typeof args[field] === "string") {
    return `* ${name} "${args[field] as string}"`;
  }
  const path = extractPath(args);
  if (path) return `* ${name} "${path}"`;
  if (name === "bash" || name === "Bash") {
    const raw = (args.command ?? args.description ?? "") as string;
    const cmd = compressBash(raw);
    return `* ${name} "${cmd}"`;
  }
  if (typeof args.query === "string") {
    return `* ${name} "${clip(args.query as string, 60)}"`;
  }
  if (isCodemodeToolName(name)) {
    const code = extractCode(args);
    if (code) return `* ${name} ${summarizeCodemodeBrief(code)}`;
  }
  return `* ${name}`;
};

export interface BriefLine {
  /** Section header like "[user]" or "[assistant]" */
  header: string;
  /** Content lines for this section */
  lines: string[];
}

/**
 * Injection points for measurement: the audit script builds the same brief
 * with and without the per-segment limits. Production callers use defaults.
 */
export interface BriefBuildOptions {
  /** Tool lines kept per [assistant] segment (default 8). */
  toolCallsPerTurn?: number;
  /**
   * Extra chars of codemode-only lines restored immediately before the kept
   * tail. 0 disables restoration (the pre-quota behavior).
   */
  codemodeSegmentChars?: number;
}

/**
 * Char allowance for codemode lines restored just before the kept tail. The
 * 8-line cap stays untouched for direct tool calls; this only stops a
 * codemode-heavy segment from losing its earlier intents while the ranked
 * brief had already paid for their blocks. Initial value from the review's
 * measurements; the audit script reports discard rates at other values.
 */
export const CODEMODE_SEGMENT_CHARS = 1000;

/**
 * Build BriefLine sections from NormalizedBlocks.
 */
export const buildBriefSections = (
  blocks: NormalizedBlock[],
  options: BriefBuildOptions = {},
): BriefLine[] => {
  const sections: BriefLine[] = [];
  let lastHeader = "";

  const push = (header: string, line: string) => {
    if (header === lastHeader && sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
      return;
    }
    sections.push({ header, lines: [line] });
    lastHeader = header;
  };

  const pushText = (header: string, text: string, ref = "") => {
    const lines = text.split("\n");
    if (ref && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${ref}`;
    }
    for (const line of lines) push(header, line);
  };

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const b = blocks[blockIndex];
    switch (b.kind) {
      case "user": {
        if (isNoiseUser(b.text)) break;
        const text = truncateTokens(collapseSkillText(b.text), TRUNCATE_USER);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          pushText("[user]", text, ref);
        }
        lastHeader = "[user]";
        break;
      }
      case "bash": {
        const cmd = compressBash(b.command);
        const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
        if (cmd) {
          push("[user]", `$ ${cmd}${ref}`);
        }
        lastHeader = "[user]";
        break;
      }
      case "assistant": {
        let raw = b.text;
        // Strip leading self-talk prefix (up to 2x; assistants sometimes chain "Hmm, actually, ...")
        for (let i = 0; i < 2; i++) {
          const stripped = raw.replace(SELF_TALK_PREFIX_RE, "");
          if (stripped === raw) break;
          raw = stripped;
        }
        const text = isSegmentClosingAssistant(blocks, blockIndex)
          ? truncateTokensHeadTail(raw, SEGMENT_CLOSING_ASSISTANT_HEAD_WORDS, SEGMENT_CLOSING_ASSISTANT_TAIL_WORDS)
          : truncateTokensHeadTail(raw, ASSISTANT_HEAD_WORDS, ASSISTANT_TAIL_WORDS);
        if (text) {
          const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
          pushText("[assistant]", text, ref);
        }
        break;
      }
      case "tool_call": {
        // Skip malformed tool calls from streaming providers (empty name / fragmented args).
        if (!b.name || b.name.trim() === "") break;
        const ref = b.sourceIndex != null ? ` (#${b.sourceIndex})` : "";
        const summary = toolOneLiner(b.name, b.args) + ref;
        push("[assistant]", summary);
        break;
      }
      case "tool_result":
        // Tool result bodies are intentionally omitted from compact briefs.
        break;
    }
  }

  // Collapse consecutive identical tool lines (same text, different #ref)
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const out: string[] = [];
    for (const line of sec.lines) {
      if (!line.startsWith("* ")) { out.push(line); continue; }
      const ref = line.match(/\(#(\d+)\)$/)?.[1] ?? "";
      // A ref-less line never joins a ref'd collapse group — merging it would
      // emit a malformed "(#12, #) x2" once mixed ref/no-ref lines can occur
      // (global indices: unresolved positions render no ref).
      if (!ref) { out.push(line); continue; }
      const base = line.slice(0, -(ref.length + 3)).trimEnd();
      const last = out.length > 0 ? out[out.length - 1] : "";
      const m = last.match(/^(.*) \((#[\d, #]+)\) x(\d+)$/);
      if (m && m[1] === base) {
        out[out.length - 1] = `${base} (${m[2]}, #${ref}) x${parseInt(m[3]) + 1}`;
      } else if (last.match(/\(#\d+\)$/) && last.replace(/\s*\(#\d+\)$/, "") === base) {
        const prevRef = last.match(/\(#(\d+)\)$/)?.[1];
        out[out.length - 1] = `${base} (#${prevRef}, #${ref}) x2`;
      } else {
        out.push(line);
      }
    }
    sec.lines = out;
  }

  // Cap tool calls per [assistant] turn — keep tail (latest actions tend to
  // be the deciding edits/writes; head is usually exploration noise).
  const TOOL_CALLS_PER_TURN = 8;
  const toolLimit = options.toolCallsPerTurn ?? TOOL_CALLS_PER_TURN;
  const codemodeQuota = options.codemodeSegmentChars ?? CODEMODE_SEGMENT_CHARS;
  for (const sec of sections) {
    if (sec.header !== "[assistant]") continue;
    const toolIdxs = sec.lines
      .map((l, i) => (l.startsWith("* ") ? i : -1))
      .filter((i) => i >= 0);
    if (toolIdxs.length <= toolLimit) continue;
    const keepStart = toolIdxs.length - toolLimit;
    // The quota only adds codemode lines adjacent to the kept tail, so every
    // discarded line stays earlier than every kept one and the marker's
    // "earlier" wording remains true. Non-codemode segments never change.
    let restoreStart = keepStart;
    let restoredChars = 0;
    while (restoreStart > 0) {
      const line = sec.lines[toolIdxs[restoreStart - 1]];
      if (!isCodemodeBriefLine(line)) break;
      if (restoredChars + line.length > codemodeQuota) break;
      restoredChars += line.length;
      restoreStart--;
    }
    if (restoreStart === 0) continue;
    const dropCount = restoreStart;
    const dropSet = new Set(toolIdxs.slice(0, dropCount));
    const firstKeptToolIdx = toolIdxs[dropCount];
    const marker = omissionMarker(
      toolIdxs.slice(0, dropCount).map((i) => sec.lines[i]),
      sec.lines[firstKeptToolIdx],
      dropCount,
    );
    const next: string[] = [];
    let inserted = false;
    for (let i = 0; i < sec.lines.length; i++) {
      if (dropSet.has(i)) continue;
      if (!inserted && i === firstKeptToolIdx) {
        next.push(marker);
        inserted = true;
      }
      next.push(sec.lines[i]);
    }
    sec.lines = next;
  }

  return sections;
};

const TRAILING_REFS_RE = /\((#\d+(?:, #\d+)*)\)(?: x\d+)?$/;

/** `#N` refs at the end of a brief tool line, including merged `(#1, #3) x2`. */
const briefLineRefs = (line: string): number[] => {
  const group = line.match(TRAILING_REFS_RE)?.[1];
  return group ? [...group.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10)) : [];
};

const isCodemodeBriefLine = (line: string): boolean =>
  isCodemodeToolName(line.match(/^\* (\S+)/)?.[1]);

/**
 * The omission marker stays exactly as upstream for non-codemode lines. When
 * a dropped line is a codemode call, the marker names the session-global
 * entry range that holds the dropped calls and their results, so the agent
 * can recover the intent instead of only being told something is missing.
 */
const refBounds = (values: number[]): { min: number; max: number } => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
};

const omissionMarker = (dropped: string[], firstKept: string | undefined, count: number): string => {
  const plain = `* (${count} earlier tool-call entries omitted)`;
  if (!dropped.some(isCodemodeBriefLine)) return plain;
  const droppedRefs = dropped.flatMap(briefLineRefs);
  if (droppedRefs.length === 0) return plain;
  const droppedBounds = refBounds(droppedRefs);
  const start = droppedBounds.min;
  const keptRefs = firstKept ? briefLineRefs(firstKept) : [];
  const end = keptRefs.length > 0 ? refBounds(keptRefs).min - 1 : droppedBounds.max;
  if (end < start) return plain;
  return `* (${count} earlier tool-call entries omitted; recall range:[${start}, ${end}])`;
};

/**
 * Stringify BriefLine sections into text format.
 */
export const stringifyBrief = (sections: BriefLine[]): string => {

  // Emit sections -- suppress blank lines between consecutive tool summaries
  const out: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (i > 0) {
      const prev = sections[i - 1];
      const prevIsTools = prev.header === "[assistant]" &&
        prev.lines.every((l) => l.startsWith("* "));
      const curIsTools = sec.header === "[assistant]" &&
        sec.lines.every((l) => l.startsWith("* "));
      if (!(prevIsTools && curIsTools)) {
        out.push("");
      }
    }
    out.push(sec.header);
    for (const line of sec.lines) {
      out.push(line);
    }
  }

  return out.join("\n");
};

/** Convenience: build sections from blocks and stringify to text */
export const compileBrief = (blocks: NormalizedBlock[]): string =>
  stringifyBrief(buildBriefSections(blocks));

// ── new codemode path: candidates, excerpts and actual-cost rendering ─────

export const BRIEF_MIN_TEXT_CHARS = 64;
export const BRIEF_TEXT_STEP_CHARS = 64;
export const BRIEF_INTENT_CHARS = 200;
export const BRIEF_CODE_CHARS = 80;
export const BRIEF_SHORT_NAV_CHARS = 80;

export interface BriefToolView {
  name: string;
  /** One-line activity navigation: `intent: ...`, `code: ...`, or arg summary. */
  shortNav: string;
  normalNav: string;
  resultIndex?: number;
  observedError: boolean;
  activity: ActivityClass;
}

export interface BriefCandidate {
  key: string;
  order: number;
  role: "user" | "assistant" | "tool";
  sourceIndex?: number;
  sourceText: string;
  score: number;
  evidence?: ActivityEvidence;
  /** Tool-only display data. */
  tool?: BriefToolView;
  /** Parsed script markers; scoring only — blocked text is never rendered. */
  hint?: ScriptHint;
  /** Rejected annotation counts (audit only; no text). */
  hintRejected?: { goal: number; blocked: number };
  /** Bash execution blocks render as `$ <compressed command>`. */
  bash?: boolean;
}

export interface BriefCandidateOptions {
  /** Internal ablations only; production defaults are goal 4, blocked 2. */
  annotationWeights?: { goal?: number; blocked?: number };
}

/**
 * One allocator result. `text` is the rendered body (no note, headers or
 * separator); `usedChars` is that body after `wrapLongLines`; `reservedChars`
 * is the caller's fixed cost (note, structure, header sections), so
 * `usedChars + reservedChars <= maxChars` is the release gate.
 */
export interface BriefSelection {
  kind: "ok" | "budget-too-small";
  text: string;
  usedChars: number;
  reservedChars: number;
  counts: Record<string, number>;
}

const firstCharsEllipsis = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;

const toolNavText = (name: string, args: Record<string, unknown>): string => {
  const field = TOOL_SUMMARY_FIELDS[name];
  if (field && typeof args[field] === "string") return `"${args[field] as string}"`;
  const path = extractPath(args);
  if (path) return `"${path}"`;
  if (/^bash$/i.test(name)) {
    const raw = (args.command ?? args.description ?? "") as string;
    return `"${compressBash(raw)}"`;
  }
  if (typeof args.query === "string") return `"${clip(args.query as string, 60)}"`;
  return "";
};

const toolResultOf = (block: NormalizedBlock | undefined): Extract<NormalizedBlock, { kind: "tool_result" }> | undefined =>
  block?.kind === "tool_result" ? block : undefined;

/** Pair calls with the first following result of the same assistant message. */
const pairToolResults = (blocks: NormalizedBlock[]): Map<number, NormalizedBlock> => {
  const paired = new Map<number, NormalizedBlock>();
  let activeAssistant: number | undefined;
  let pending = new Map<string, number>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === "assistant") {
      if (activeAssistant !== block.sourceIndex) {
        pending = new Map();
        activeAssistant = block.sourceIndex;
      }
      continue;
    }
    if (block.kind === "tool_call") {
      if (activeAssistant !== block.sourceIndex) {
        pending = new Map();
        activeAssistant = block.sourceIndex;
      }
      if (block.toolCallId) pending.set(block.toolCallId, i);
      continue;
    }
    if (block.kind === "tool_result" && block.toolCallId && pending.has(block.toolCallId)) {
      paired.set(pending.get(block.toolCallId)!, block);
      pending.delete(block.toolCallId);
    }
  }
  return paired;
};

/**
 * Turn the effective history into timeline candidates. User/assistant text is
 * kept raw (after the existing sanitize/noise handling); tools carry their
 * activity class, pairing and intent. Scores follow §6.3 with capped
 * annotation credit; blocked text is never copied into the candidate.
 */
export const buildBriefCandidates = (
  blocks: NormalizedBlock[],
  options: BriefCandidateOptions = {},
): BriefCandidate[] => {
  const paired = pairToolResults(blocks);
  const candidates: BriefCandidate[] = [];

  blocks.forEach((block, order) => {
    if (block.kind === "user") {
      const text = collapseSkillText(block.text);
      if (!text.trim()) return;
      candidates.push({
        key: `${order}:user`, order, role: "user",
        sourceIndex: block.sourceIndex, sourceText: text, score: 0,
      });
      return;
    }
    if (block.kind === "bash") {
      const text = compressBash(block.command);
      if (!text) return;
      candidates.push({
        key: `${order}:bash`, order, role: "user",
        sourceIndex: block.sourceIndex, sourceText: text, score: 0, bash: true,
      });
      return;
    }
    if (block.kind === "assistant") {
      if (!block.text) return;
      candidates.push({
        key: `${order}:assistant`, order, role: "assistant",
        sourceIndex: block.sourceIndex, sourceText: block.text, score: 0,
      });
      return;
    }
    if (block.kind !== "tool_call" || !block.name?.trim()) return;

    const result = toolResultOf(paired.get(order));
    const codemode = isCodemodeToolName(block.name);
    const code = codemode ? extractCode(block.args) : null;
    const parsed = code ? parseScriptHints(code) : undefined;
    const hint = parsed?.hint;
    const intent = hint?.goal;
    const codeNav = code ? condenseCodeTo(code, BRIEF_CODE_CHARS, false) : "";
    const shortNav = intent
      ? `intent: ${firstCharsEllipsis(intent, BRIEF_SHORT_NAV_CHARS)}`
      : code
        ? `code: ${firstCharsEllipsis(codeNav, BRIEF_CODE_CHARS)}`
        : toolNavText(block.name, block.args);
    const normalNav = intent
      ? `intent: ${firstCharsEllipsis(intent, BRIEF_INTENT_CHARS)}`
      : code
        ? `code: ${firstCharsEllipsis(codeNav, BRIEF_CODE_CHARS)}`
        : shortNav;

    const evidence: ActivityEvidence = codemode
      ? classifyNestedActivity(result?.nestedCalls, result?.isError)
      : {
          category: activityClassForToolName(block.name),
          observedError: Boolean(result?.isError),
          incomplete: !result,
        };
    if (result?.sourceIndex != null) evidence.resultIndex = result.sourceIndex;

    candidates.push({
      key: `${order}:tool`, order, role: "tool",
      sourceIndex: block.sourceIndex, sourceText: normalNav, score: 0,
      evidence, hint,
      ...(parsed && (parsed.rejected.goal > 0 || parsed.rejected.blocked > 0) ? { hintRejected: parsed.rejected } : {}),
      tool: {
        name: block.name,
        shortNav,
        normalNav,
        resultIndex: evidence.resultIndex,
        observedError: evidence.observedError,
        activity: evidence.category,
      },
    });
  });

  const total = candidates.length;
  const maxOrder = total - 1;
  const goalWeight = options.annotationWeights?.goal ?? 4;
  const blockedWeight = options.annotationWeights?.blocked ?? 2;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.role !== "tool" || !candidate.tool) continue;
    const r = maxOrder <= 0 ? 1 : i / maxOrder;
    const base = candidate.tool.activity === "mutation" ? 30
      : candidate.tool.activity === "readonly" ? 6
      : 14;
    let annotation = 0;
    if (candidate.hint?.goal) annotation += goalWeight;
    if (candidate.hint?.blocked && r >= 0.75) annotation += blockedWeight;
    candidate.score = base + Math.round(12 * r)
      + (candidate.evidence?.observedError ? 16 : 0)
      + Math.min(6, annotation);
  }

  // Consecutive identical activity: keep the most recent copy, penalize the rest.
  let runKey = "";
  let run: BriefCandidate[] = [];
  const flush = () => {
    for (let i = 0; i < run.length - 1; i++) run[i].score -= 12;
    run = [];
  };
  for (const candidate of candidates) {
    if (candidate.role !== "tool" || !candidate.tool) continue;
    const key = `${candidate.tool.name}\u0000${candidate.tool.normalNav}\u0000${candidate.tool.activity}`;
    if (key !== runKey) {
      flush();
      runKey = key;
    }
    run.push(candidate);
  }
  flush();

  return candidates;
};

const excerptText = (text: string, keepChars: number, sourceIndex?: number): string => {
  if (keepChars >= text.length) return text;
  const headChars = Math.ceil(Math.max(0, keepChars) / 2);
  const tailChars = Math.floor(Math.max(0, keepChars) / 2);
  const headEnd = graphemeStartAtOrBefore(text, headChars);
  const tailStart = graphemeStartAtOrBefore(text, Math.max(headEnd, text.length - tailChars));
  const omitted = Math.max(0, tailStart - headEnd);
  const marker = sourceIndex != null
    ? `[omitted ${omitted} of ${text.length} chars; recall #${sourceIndex}]`
    : `[omitted ${omitted} of ${text.length} chars; source index unavailable]`;
  const head = text.slice(0, headEnd).trimEnd();
  const tail = text.slice(tailStart).trimStart();
  return head ? `${head}\n${marker}\n${tail}` : `${marker}\n${tail}`;
};

const attachRef = (text: string, sourceIndex?: number): string => {
  if (sourceIndex == null) return text;
  const lines = text.split("\n");
  lines[0] = `${lines[0]} (#${sourceIndex})`;
  return lines.join("\n");
};

/** One user/assistant entry at a body-character budget (head/tail excerpt). */
export const renderTextCandidate = (candidate: BriefCandidate, keepChars: number): string => {
  const body = candidate.bash
    ? `$ ${excerptText(candidate.sourceText, keepChars, candidate.sourceIndex)}`
    : excerptText(candidate.sourceText, keepChars, candidate.sourceIndex);
  return attachRef(body, candidate.sourceIndex);
};

/** One tool line; short and normal differ only in navigation length. */
export const renderToolCandidate = (candidate: BriefCandidate, version: "short" | "normal" = "normal"): string => {
  const tool = candidate.tool!;
  const nav = version === "short" ? tool.shortNav : tool.normalNav;
  const ref = candidate.sourceIndex != null ? ` (#${candidate.sourceIndex})` : "";
  const error = tool.observedError
    ? tool.resultIndex != null
      ? ` {error observed; result #${tool.resultIndex}}`
      : " {error observed}"
    : "";
  return `* ${tool.name}${nav ? ` ${nav}` : ""}${ref}${error}`;
};

/** Range of saved-history refs, or null when any entry has no index. */
const numericRange = (candidates: BriefCandidate[]): { min: number; max: number } | null => {
  if (candidates.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const ref = candidate.sourceIndex;
    if (typeof ref !== "number") return null;
    if (ref < min) min = ref;
    if (ref > max) max = ref;
  }
  return { min, max };
};

const scanSuffix = (range: { min: number; max: number } | null): string =>
  range ? `; scan saved history #${range.min}..#${range.max}` : "";

/**
 * Formatter for callers that track count/min/max incrementally; it allocates
 * nothing beyond the marker string itself.
 */
export const formatTextOmissionMarker = (
  role: "user" | "assistant",
  count: number,
  range: { min: number; max: number } | null,
): string => `[${count} older ${role} ${count === 1 ? "message" : "messages"} omitted${scanSuffix(range)}]`;

export const renderTextOmissionMarker = (role: "user" | "assistant", omitted: BriefCandidate[]): string =>
  formatTextOmissionMarker(role, omitted.length, numericRange(omitted));

export const renderToolOmissionMarker = (omitted: BriefCandidate[]): string =>
  `* (${omitted.length} earlier tool-call entr${omitted.length === 1 ? "y" : "ies"} omitted${scanSuffix(numericRange(omitted))})`;
