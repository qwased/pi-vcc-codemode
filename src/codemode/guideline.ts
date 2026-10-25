import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isCodemodeActive, isRecallActive } from "./active";

// The host renders every prompt guideline as a list item ("- "), so these
// strings must not carry their own bullet.
export const CODEMODE_RECALL_GUIDELINE =
  "Use `vcc_recall` to recover compacted or earlier session context before concluding it is unavailable; if it is not listed, call `tools.vcc_recall` from a codemode script.";

export const CODEMODE_INTENT_GUIDELINE =
  "Start each codemode script with a one-line `// goal: <intended outcome>` in the same language as the user's request, describing intent rather than success; if you use `// @options:`, keep it first and put the intent on line 2.";

/**
 * Guidelines for the current run: nothing when codemode is inactive, the
 * intent rule when it is active, and the recall rule only while vcc_recall is
 * still available. The recall rule matters in `mode:"only"`, where a crowded
 * codemode catalog can omit the vcc_recall entry entirely.
 */
export const codemodeGuidelines = (codemodeActive: boolean, recallActive: boolean): string[] => {
  if (!codemodeActive) return [];
  return recallActive
    ? [CODEMODE_RECALL_GUIDELINE, CODEMODE_INTENT_GUIDELINE]
    : [CODEMODE_INTENT_GUIDELINE];
};

/** Append the guidelines in place, skipping any copy the prompt already has. */
export const appendCodemodeGuidelines = (
  pi: Pick<ExtensionAPI, "getActiveTools">,
  promptGuidelines: string[],
): void => {
  for (const guideline of codemodeGuidelines(isCodemodeActive(pi), isRecallActive(pi))) {
    if (!promptGuidelines.includes(guideline)) promptGuidelines.push(guideline);
  }
};
