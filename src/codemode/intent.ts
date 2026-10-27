import type { ScriptHint } from "../types";

const OPTIONS_LINE = /^\s*\/\/\s*@options\s*:/i;
const MARKER_LINE = /^\s*\/\/\s*(goal|blocked)\s*:\s*(.*?)\s*$/i;
const MAX_HINT_CHARS = 200;
const HEADER_COMMENT_LINES = 3;

export interface ScriptHintResult {
  hint: ScriptHint;
  rejected: { goal: number; blocked: number };
}

/**
 * Parse the script's declared intent and blocked marker from the opening
 * comment region: at most three lines after an optional first-line
 * `// @options:`, stopping at the first non-empty non-comment line. Markers
 * are case-insensitive; the first compliant value of each kind wins. Empty or
 * over-200-unit values are rejected and counted. Comments elsewhere in the
 * script are never declarations.
 */
export const parseScriptHints = (code: string): ScriptHintResult => {
  const result: ScriptHintResult = { hint: {}, rejected: { goal: 0, blocked: 0 } };
  if (typeof code !== "string" || code.length === 0) return result;

  const lines = code.split(/\r?\n/);
  const start = OPTIONS_LINE.test(lines[0] ?? "") ? 1 : 0;
  for (let i = start; i < lines.length && i - start < HEADER_COMMENT_LINES; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith("//")) break;

    const match = MARKER_LINE.exec(line);
    if (!match) continue;
    const marker = match[1].toLowerCase() as "goal" | "blocked";
    const value = match[2].trim();
    if (!value || value.length > MAX_HINT_CHARS) {
      result.rejected[marker]++;
      continue;
    }
    // Repeats do not stack: only the first compliant value is kept.
    if (result.hint[marker] === undefined) result.hint[marker] = value;
  }
  return result;
};

/**
 * Goal-only compatibility wrapper. The parsed goal describes the script's
 * intent at the time; it is not evidence that the script ran or succeeded.
 */
export const parseDeclaredIntent = (code: string): string | null =>
  parseScriptHints(code).hint.goal ?? null;
