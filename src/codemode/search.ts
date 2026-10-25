import type { Message, NestedToolCalls } from "@earendil-works/pi-ai";
import { clip, extractToolCallArgsText } from "../core/content";
import { RECALL_TOOL_NAME } from "./active";

/**
 * Aggregate character budget for the nested-call text of one tool result.
 * Pi already bounds the record (call count, per-call argument bytes), so this
 * only stops one result with hundreds of nested calls from dominating the
 * BM25 corpus.
 */
export const NESTED_TEXT_BUDGET = 2000;

/**
 * Nested calls a tool made while it ran (ctx.executeTool, e.g. from a
 * codemode script), as search text: `name <args> <status> <error>` per call.
 * The recall tool's own nested calls are skipped for the same self-match
 * reason as `toolCallArgsText` (see RECALL_TOOL_NAME).
 */
export const nestedCallsSearchText = (msg: Message): string => {
  const nestedCalls = (msg as { nestedCalls?: NestedToolCalls }).nestedCalls;
  const calls = nestedCalls?.calls ?? [];
  if (calls.length === 0) return "";
  const raw = calls
    .filter((call) => call.name?.toLowerCase() !== RECALL_TOOL_NAME)
    .map((call) => {
      const args = extractToolCallArgsText((call.arguments ?? {}) as Record<string, unknown>);
      const status = call.status && call.status !== "ok" ? ` ${call.status}` : "";
      const error = call.error ? ` ${call.error}` : "";
      return [call.name, args, status, error].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("\n");
  return clip(raw, NESTED_TEXT_BUDGET);
};
