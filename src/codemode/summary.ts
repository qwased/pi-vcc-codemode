import type { Message, NestedToolCalls } from "@earendil-works/pi-ai";
import { clip } from "../core/content";
import { extractPath, summarizeToolArgs } from "../core/tool-args";
import { parseDeclaredIntent } from "./intent";

const CODE_KEYS = ["code", "script", "source"] as const;

export const extractCode = (args: Record<string, unknown>): string | null => {
  for (const key of CODE_KEYS) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
};

/** Preview caps: one recall-entry line (list) vs. one expanded entry. */
export const CODE_PREVIEW_CHARS = 300;
export const CODE_FULL_CHARS = 1500;

/** Brief-time caps: the compact brief shares one char budget across blocks. */
export const CODE_BRIEF_CHARS = 80;
const CODE_BRIEF_TOOL_NAMES = 6;
const INTENT_BRIEF_CHARS = 200;

const firstChars = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

/**
 * Flatten a script body to one line and clip it. A clipped preview carries
 * the full size, so a reader knows how much is missing.
 */
export const condenseCodeTo = (code: string, limit: number, note = true): string => {
  const flat = code.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (flat.length <= limit) return flat;
  if (!note) return flat.slice(0, limit);
  const lineCount = code.split("\n").length;
  return flat.slice(0, limit) + " [" + lineCount + " lines, " + code.length + " chars total]";
};

export const condenseCode = (code: string, full = false): string =>
  condenseCodeTo(code, full ? CODE_FULL_CHARS : CODE_PREVIEW_CHARS);

/**
 * Recall rendering of a codemode call. Only the script body changes; a call
 * without a code argument keeps the upstream summary.
 */
export const summarizeCodemodeToolArgs = (args: Record<string, unknown>, full = false): string => {
  const code = extractCode(args);
  if (code) return `code=${condenseCode(code, full)}`;
  return summarizeToolArgs(args);
};

/**
 * Tool names a codemode script calls directly (tools.<name>(...)), most called
 * first, ties broken by first appearance. This is a static declaration, not a
 * record of what actually ran.
 */
export const codemodeToolNames = (code: string): Array<{ name: string; count: number }> => {
  const first = new Map<string, number>();
  const counts = new Map<string, number>();
  const re = /tools\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (!counts.has(name)) first.set(name, m.index);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (first.get(a.name) ?? 0) - (first.get(b.name) ?? 0));
};

/**
 * Brief rendering of a codemode call: declared intent when present, otherwise
 * a short script head. The static tool names stay separate from the intent so
 * neither is presented as proof that the script succeeded.
 */
export const summarizeCodemodeBrief = (code: string): string => {
  const names = codemodeToolNames(code);
  // The counts only order the names; printing them read as execution counts.
  const shown = names.slice(0, CODE_BRIEF_TOOL_NAMES).map(({ name }) => name);
  const omitted = names.length - Math.min(names.length, CODE_BRIEF_TOOL_NAMES);
  const namesText = shown.length > 0
    ? "-> " + shown.join(", ") + (omitted > 0 ? " +" + omitted + " more" : "") + " | "
    : "";

  const intent = parseDeclaredIntent(code);
  if (intent) {
    const goal = intent.length <= INTENT_BRIEF_CHARS
      ? intent
      : `${clip(intent, INTENT_BRIEF_CHARS - 1)}…`;
    return namesText + "goal: " + goal;
  }
  return namesText + "code: " + condenseCodeTo(code, CODE_BRIEF_CHARS, false);
};

/**
 * Compact rendering of one argument value: strings, numbers, booleans and
 * arrays of those. Returns null for values with no cheap summary (nested
 * objects), which the caller then names by key only.
 */
const summarizeValue = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const scalars = value.filter(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    if (scalars.length === 0) return null;
    const omitted = value.length - Math.min(scalars.length, 3);
    const head = scalars.slice(0, 3).map((item) => String(item)).join(" | ");
    return omitted > 0 ? head + " +" + omitted : head;
  }
  return null;
};

/**
 * Nested-call arguments: the same known fields as upstream, then scalar
 * key=value pairs. Only used inside nested records — the generic fallback
 * must not change how ordinary tools render.
 */
export const summarizeNestedToolArgs = (args: Record<string, unknown>): string => {
  if (extractPath(args)) return summarizeToolArgs(args);
  if (typeof args.command === "string") return summarizeToolArgs(args);
  if (typeof args.query === "string") return summarizeToolArgs(args);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const text = summarizeValue(value);
    parts.push(text === null ? key : key + "=" + firstChars(text, 120));
  }
  return firstChars(parts.join(", "), 400);
};

/**
 * Recall budget for one nested-call line (Pi caps the record itself).
 * Argument clips are tighter in the entry list than in expand, and every
 * record is flattened to one physical line: a multi-line bash command must
 * not leak newlines into the recall listing.
 */
export const NESTED_LINE_CHARS = 1500;
export const NESTED_LINE_CHARS_FULL = 6000;
export const NESTED_SHOWN = 12;
export const NESTED_SHOWN_FULL = 32;
const NESTED_ARG_CHARS = 120;
const NESTED_ARG_CHARS_FULL = 200;

/** Collapse a multi-line command or script body into one physical line. */
const flattenLine = (text: string): string =>
  text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();

/**
 * One line for the nested calls a tool made while it ran (ctx.executeTool,
 * e.g. from a codemode script). Pi records them on the tool result message
 * (nestedCalls), so a recall entry shows what a step actually did instead
 * of only its script body and the head of its stdout.
 */
export const nestedCallsLine = (msg: Message, full = false): string => {
  const nestedCalls = (msg as { nestedCalls?: NestedToolCalls }).nestedCalls;
  const calls = nestedCalls?.calls ?? [];
  if (calls.length === 0) return "";
  const cap = full ? NESTED_SHOWN_FULL : NESTED_SHOWN;
  const argCap = full ? NESTED_ARG_CHARS_FULL : NESTED_ARG_CHARS;
  const shown = calls.slice(-cap);
  const omitted = calls.length - shown.length;
  const parts = shown.map((call) => {
    const args = flattenLine(summarizeNestedToolArgs((call.arguments ?? {}) as Record<string, unknown>));
    const status = call.status && call.status !== "ok" ? " " + call.status : "";
    const error = call.error ? " " + flattenLine(clip(call.error, 120)) : "";
    const took = typeof call.durationMs === "number" ? " " + call.durationMs + "ms" : "";
    return call.name + "(" + clip(args, argCap) + ")" + status + error + took;
  });
  const head = omitted > 0
    ? "nested x" + calls.length + " (last " + shown.length + (full ? "" : ", expand for more") + "): "
    : "nested: ";
  const tail = nestedCalls?.complete === false ? " [record incomplete]" : "";
  return clip(flattenLine(head + parts.join(", ") + tail), full ? NESTED_LINE_CHARS_FULL : NESTED_LINE_CHARS);
};
