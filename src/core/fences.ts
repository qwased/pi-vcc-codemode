/**
 * Markdown code-fence state for the character-budget brief. Excerpt cuts and
 * line caps are position-based, so a fence can be split; these helpers keep
 * the rendered text self-consistent instead of letting one open fence swallow
 * the omission marker, section headers and the reading note.
 *
 * Scope is deliberately small: line-start fences (0-3 spaces) of at least
 * three backticks or tildes, CommonMark's info-string rule for backticks, and
 * closers that need the same character, at least the opener's length and an
 * empty info string. This is not a full CommonMark parser (indented code
 * blocks, list-contained fences and HTML blocks are out of scope).
 */

export interface FenceLine {
  char: "`" | "~";
  length: number;
  /** Text after the run, trimmed. Empty for a valid closer. */
  info: string;
  /** Leading spaces (0-3) of the original line. */
  indent: number;
  /** The line exactly as written, used to reopen a fence in the tail. */
  raw: string;
}

const FENCE_LINE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** Parse one line as a fence line, or null when it is ordinary text. */
export const parseFenceLine = (line: string): FenceLine | null => {
  const match = FENCE_LINE_RE.exec(line);
  if (!match) return null;
  const run = match[2];
  const info = match[3];
  // A backtick opener's info string cannot contain a backtick (CommonMark);
  // otherwise "```code `x`" would be misread as a fence opener.
  if (run[0] === "`" && info.includes("`")) return null;
  return {
    char: run[0] as "`" | "~",
    length: run.length,
    info: info.trim(),
    indent: match[1].length,
    raw: line,
  };
};

/** True when `line` closes `open`: same char, at least as long, empty info. */
export const isClosingFence = (open: FenceLine, line: FenceLine): boolean =>
  line.char === open.char && line.length >= open.length && line.info === "";

/** The opener still open at the end of `text`, or null. */
export const fenceStateAtEnd = (text: string): FenceLine | null => {
  let open: FenceLine | null = null;
  for (const line of text.split("\n")) {
    const fence = parseFenceLine(line);
    if (!fence) continue;
    if (!open) {
      open = fence;
      continue;
    }
    if (isClosingFence(open, fence)) open = null;
  }
  return open;
};

/**
 * The opener still open just before `offset`. Only complete lines before the
 * offset count: an offset in the middle of a line leaves that line to the
 * head/tail slice, which is what keeps a partial fence run from being
 * reported as a complete fence line.
 */
export const fenceStateBefore = (text: string, offset: number): FenceLine | null => {
  const end = Math.max(0, Math.min(text.length, offset));
  if (end <= 0) return null;
  const newline = text.lastIndexOf("\n", end - 1);
  if (newline < 0) return null;
  return fenceStateAtEnd(text.slice(0, newline + 1));
};

export interface ClosedText {
  text: string;
  /** Chars added by the closing fence, 0 when the text was already closed. */
  appendedChars: number;
}

/** Append the matching closer when `text` ends inside a fence. */
export const closeUnclosedFences = (text: string): ClosedText => {
  const open = fenceStateAtEnd(text);
  if (!open) return { text, appendedChars: 0 };
  const closer = open.char.repeat(open.length);
  if (!text || text.endsWith("\n")) return { text: text + closer, appendedChars: closer.length };
  const addition = `\n${closer}`;
  return { text: text + addition, appendedChars: addition.length };
};

/**
 * Line caps keep the tail, so the first kept fence line can be the closer of
 * an opener that was dropped. A bare closer reads as a NEW opener and swallows
 * everything after it; drop every such orphan closer. `droppedText` is the
 * prefix the cap removed (in order), `keptLines` the surviving lines.
 */
export const dropOrphanClosers = (droppedText: string, keptLines: string[]): string[] => {
  const open = fenceStateAtEnd(droppedText);
  if (!open) return keptLines;
  let kept = keptLines;
  for (;;) {
    const index = kept.findIndex((line) => parseFenceLine(line) !== null);
    if (index < 0) break;
    const fence = parseFenceLine(kept[index])!;
    if (!isClosingFence(open, fence)) break;
    kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
  }
  return kept;
};
