import { describe, expect, test } from "bun:test";
import { isCodemodeActive, isRecallActive } from "../src/codemode/active";
import {
  CODEMODE_INTENT_GUIDELINE,
  CODEMODE_RECALL_GUIDELINE,
  appendCodemodeGuidelines,
  codemodeGuidelines,
} from "../src/codemode/guideline";
import { registerBeforeCompactHook } from "../src/hooks/before-compact";

const activePi = (tools: string[]) => ({ getActiveTools: () => tools }) as any;

const handlerFor = (activeTools: string[]) => {
  let handler: ((event: any) => unknown) | undefined;
  const pi = {
    getActiveTools: () => activeTools,
    on: (eventName: string, h: (event: any) => unknown) => {
      if (eventName === "before_agent_start") handler = h;
    },
  } as any;
  registerBeforeCompactHook(pi);
  expect(handler).toBeDefined();
  return handler!;
};

const run = (activeTools: string[], existing: string[] = []) => {
  const event = {
    type: "before_agent_start",
    prompt: "next",
    systemPrompt: "base prompt",
    systemPromptOptions: { promptGuidelines: [...existing] },
  };
  const result = handlerFor(activeTools)(event);
  return { result, guidelines: event.systemPromptOptions.promptGuidelines, event };
};

describe("codemode guideline text", () => {
  test("pins the finalized wording", () => {
    expect(CODEMODE_RECALL_GUIDELINE).toBe(
      "- Use `vcc_recall` to recover compacted or earlier session context before concluding it is unavailable; if it is not listed, call `tools.vcc_recall` from a codemode script.",
    );
    expect(CODEMODE_INTENT_GUIDELINE).toBe(
      "- Start each codemode script with a one-line `// goal: <intended outcome>` in the same language as the user's request, describing intent rather than success; if you use `// @options:`, keep it first and put the intent on line 2.",
    );
  });
});

describe("codemode guideline selection", () => {
  test("mode on: codemode plus direct declarations gets both rules", () => {
    expect(codemodeGuidelines(true, true))
      .toEqual([CODEMODE_RECALL_GUIDELINE, CODEMODE_INTENT_GUIDELINE]);
  });

  test("mode only: hidden declarations stay active, so both rules are visible", () => {
    // mode:"only" hides declarations from requests; the active set itself is unchanged.
    expect(codemodeGuidelines(true, true))
      .toEqual([CODEMODE_RECALL_GUIDELINE, CODEMODE_INTENT_GUIDELINE]);
  });

  test("codemode active with vcc_recall disabled keeps only the intent rule", () => {
    expect(codemodeGuidelines(true, false)).toEqual([CODEMODE_INTENT_GUIDELINE]);
  });

  test("codemode inactive adds nothing, even if vcc_recall is active", () => {
    expect(codemodeGuidelines(false, true)).toEqual([]);
    expect(codemodeGuidelines(false, false)).toEqual([]);
  });

  test("active-tool detection is case-insensitive", () => {
    expect(isCodemodeActive(activePi(["CODEMODE"]))).toBe(true);
    expect(isRecallActive(activePi(["VCC_RECALL"]))).toBe(true);
    expect(isCodemodeActive(activePi(["read", "vcc_recall"]))).toBe(false);
    expect(isRecallActive(activePi(["read", "codemode"]))).toBe(false);
  });
});

describe("before_agent_start guideline injection", () => {
  test("appends the rules without replacing the system prompt", () => {
    const { result, guidelines, event } = run(["read", "codemode", "vcc_recall"], ["existing rule"]);
    expect(result).toBeUndefined();
    expect(event.systemPrompt).toBe("base prompt");
    expect(guidelines).toEqual([
      "existing rule",
      CODEMODE_RECALL_GUIDELINE,
      CODEMODE_INTENT_GUIDELINE,
    ]);
  });

  test("does nothing when codemode is inactive", () => {
    const { guidelines } = run(["read", "vcc_recall"], ["existing rule"]);
    expect(guidelines).toEqual(["existing rule"]);
  });

  test("drops the recall rule when vcc_recall is inactive", () => {
    const { guidelines } = run(["read", "codemode"], ["existing rule"]);
    expect(guidelines).toEqual(["existing rule", CODEMODE_INTENT_GUIDELINE]);
  });

  test("never appends a duplicate of a rule already present", () => {
    const first = run(["codemode", "vcc_recall"]);
    appendCodemodeGuidelines(activePi(["codemode", "vcc_recall"]), first.guidelines);
    expect(first.guidelines).toEqual([CODEMODE_RECALL_GUIDELINE, CODEMODE_INTENT_GUIDELINE]);
  });
});
