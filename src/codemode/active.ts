import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

export const CODEMODE_TOOL_NAME = "codemode";
export const RECALL_TOOL_NAME = "vcc_recall";

export const isCodemodeToolName = (name: string | undefined): boolean =>
  typeof name === "string" && name.toLowerCase() === CODEMODE_TOOL_NAME;

const hasTool = (tools: readonly string[], name: string): boolean =>
  tools.some((tool) => tool.toLowerCase() === name);

/** codemode is declared to the model in both `on` and `only` modes. */
export const isCodemodeActive = (pi: Pick<ExtensionAPI, "getActiveTools">): boolean =>
  hasTool(pi.getActiveTools(), CODEMODE_TOOL_NAME);

export const isRecallActive = (pi: Pick<ExtensionAPI, "getActiveTools">): boolean =>
  hasTool(pi.getActiveTools(), RECALL_TOOL_NAME);

/**
 * Read-only detection for historical codemode content: a codemode call or a
 * tool result that recorded nested calls. This is deliberately independent of
 * the current active tools, so old history stays readable when codemode is off.
 */
export const isCodemodeMessage = (msg: Message): boolean => {
  if (msg.role === "toolResult") return Boolean(msg.nestedCalls);
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) return false;
  return msg.content.some((part) => part.type === "toolCall" && isCodemodeToolName(part.name));
};
