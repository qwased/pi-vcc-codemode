const OPTIONS_LINE = /^\s*\/\/\s*@options\s*:/i;
const GOAL_LINE = /^\s*\/\/\s*goal\s*:\s*(.+?)\s*$/i;

/**
 * Parse the script's declared intent. codemode requires `// @options:` to be
 * the first line, so the intent is either line 1 or line 2 after options.
 * Only the fixed marker is recognized; the text itself is free-form.
 */
export const parseDeclaredIntent = (code: string): string | null => {
  if (typeof code !== "string" || code.length === 0) return null;
  const lines = code.split(/\r?\n/);
  const lineIndex = OPTIONS_LINE.test(lines[0] ?? "") ? 1 : 0;
  const intent = GOAL_LINE.exec(lines[lineIndex] ?? "")?.[1]?.trim();
  return intent ? intent : null;
};
