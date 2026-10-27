import { describe, expect, test } from "bun:test";
import { buildBriefSections, stringifyBrief, CODEMODE_SEGMENT_CHARS, type BriefBuildOptions } from "../src/core/brief";
import { normalize } from "../src/core/normalize";
import { activityClassForToolName, classifyNestedActivity } from "../src/codemode/summary";
import type { NormalizedBlock } from "../src/types";
import { assistantWithToolCall, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const briefOf = (messages: unknown[], options?: BriefBuildOptions): string =>
  stringifyBrief(buildBriefSections(normalize(messages as any), options));

const codemodeTurn = (count: number, prefix = "step") => {
  const messages: unknown[] = [userMsg("long task")];
  for (let i = 0; i < count; i++) {
    messages.push(codemodeCall(codemodeScript(`${prefix} ${i}`, `await tools.bash({ command: "echo ${i}" });`)));
    messages.push(codemodeResult({
      calls: [nestedCall({ name: "bash", arguments: { command: `echo ${i}` } })],
    }));
  }
  return messages;
};

const omittedLine = (brief: string): string =>
  brief.split("\n").find((line) => line.includes("tool-call entries omitted")) ?? "";

describe("codemode brief omission marker", () => {
  // These tests pin the marker itself; the default codemode quota would keep
  // these short lines, so restoration is disabled here.
  const noQuota = { codemodeSegmentChars: 0 } as const;

  test("dropped codemode lines name the recall range that holds them", () => {
    const brief = briefOf(codemodeTurn(17), noQuota);
    // Calls sit at #1, #3, ... #33; the first nine drop, the first kept is #19.
    expect(omittedLine(brief)).toBe(
      "* (9 earlier tool-call entries omitted; recall range:[1, 18])",
    );
    expect(brief).not.toContain("step 0");
    expect(brief).not.toContain("step 8");
    expect(brief).toContain("step 9");
  });

  test("direct bash calls keep the upstream marker unchanged", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      assistantWithToolCall("bash", { command: `echo ${i}` }),
    );
    const brief = briefOf(messages);
    expect(omittedLine(brief)).toBe("* (4 earlier tool-call entries omitted)");
    expect(brief).not.toContain("range:");
  });

  test("a mixed segment adds the range only when a codemode line was dropped", () => {
    const bash = (i: number) => assistantWithToolCall("bash", { command: `echo ${i}` });
    const codemode = (i: number) => codemodeCall(codemodeScript(`goal ${i}`, "text('ok');", false));

    const droppedCodemode = briefOf([
      codemode(0), codemode(1), codemode(2), codemode(3),
      ...Array.from({ length: 8 }, (_, i) => bash(i)),
    ], noQuota);
    expect(omittedLine(droppedCodemode)).toContain("recall range:[0, 3]");

    const droppedBash = briefOf([
      ...Array.from({ length: 4 }, (_, i) => bash(i)),
      ...Array.from({ length: 8 }, (_, i) => codemode(i)),
    ], noQuota);
    expect(omittedLine(droppedBash)).toBe("* (4 earlier tool-call entries omitted)");
  });

  test("a dropped merged line contributes every one of its refs to the range", () => {
    const same = codemodeScript("same goal", "text('ok');", false);
    const brief = briefOf([
      codemodeCall(same), codemodeCall(same),
      ...Array.from({ length: 9 }, (_, i) => assistantWithToolCall("bash", { command: `echo ${i}` })),
    ], noQuota);
    // The two identical calls merge into "(#0, #1) x2"; the first kept bash is #3.
    // The merged line is dropped, and its #0 must still widen the range; a marker
    // built only from the dropped bash line would start at #2.
    expect(omittedLine(brief)).toBe(
      "* (2 earlier tool-call entries omitted; recall range:[0, 2])",
    );
    expect(brief).not.toContain("same goal");
    expect(brief).toContain('* bash "echo 1" (#3)');
  });

  test("without global refs the marker falls back to the upstream text", () => {
    const blocks: NormalizedBlock[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "tool_call",
      name: "codemode",
      args: { code: codemodeScript(`goal ${i}`, "text('ok');", false) },
    }));
    const brief = stringifyBrief(buildBriefSections(blocks, noQuota));
    expect(omittedLine(brief)).toBe("* (4 earlier tool-call entries omitted)");
    expect(brief).not.toContain("range:");
  });
});

describe("codemode segment quota", () => {
  test("the shipped allowance stays at the measured value", () => {
    expect(CODEMODE_SEGMENT_CHARS).toBe(1000);
  });

  test("short intent lines that fit the quota are kept instead of dropped", () => {
    const brief = briefOf(codemodeTurn(17));
    expect(brief).not.toContain("tool-call entries omitted");
    expect(brief).toContain("step 0");
    expect(brief).toContain("step 16");
  });

  test("restoration stops at a non-codemode line", () => {
    const bash = (i: number) => assistantWithToolCall("bash", { command: `echo ${i}` });
    const codemode = (i: number) => codemodeCall(codemodeScript(`goal ${i}`, "text('ok');", false));
    const brief = briefOf([
      ...Array.from({ length: 4 }, (_, i) => bash(i)),
      ...Array.from({ length: 4 }, (_, i) => codemode(i)),
      ...Array.from({ length: 4 }, (_, i) => bash(10 + i)),
      ...Array.from({ length: 4 }, (_, i) => codemode(10 + i)),
    ]);
    // The four codemode lines before the kept tail are restored; the four
    // earlier bash lines stay dropped, so the marker keeps its upstream text.
    expect(omittedLine(brief)).toBe("* (4 earlier tool-call entries omitted)");
    expect(brief).toContain("goal 0");
    expect(brief).toContain("goal 3");
    expect(brief).toContain("goal 10");
    expect(brief).toContain("goal 13");
  });

  test("the quota stops before a line that would exceed it", () => {
    const longGoal = (i: number) => codemodeCall(codemodeScript("x".repeat(190) + i, "text('ok');", false));
    const brief = briefOf([
      longGoal(0), longGoal(1), longGoal(2), longGoal(3),
      ...Array.from({ length: 8 }, (_, i) => assistantWithToolCall("bash", { command: `echo ${i}` })),
    ], { codemodeSegmentChars: 500 });
    expect(omittedLine(brief)).toBe(
      "* (2 earlier tool-call entries omitted; recall range:[0, 1])",
    );
    // The two lines nearest the kept tail came back.
    expect(brief).toContain("x".repeat(190) + "2");
    expect(brief).toContain("x".repeat(190) + "3");
    expect(brief).not.toContain("x".repeat(190) + "1");
  });

  test("direct tool lines keep the same kept set with the quota on", () => {
    const bash = (i: number) => assistantWithToolCall("bash", { command: `echo ${i}` });
    const codemode = (i: number) => codemodeCall(codemodeScript(`goal ${i}`, "text('ok');", false));
    const messages = Array.from({ length: 6 }, (_, i) => [bash(i), codemode(i)]).flat();
    const keptBashRefs = (brief: string) =>
      brief.split("\n")
        .filter((line) => line.startsWith("* bash "))
        .map((line) => line.match(/\(#(\d+)\)$/)?.[1]);
    const withQuota = briefOf(messages);
    const noQuota = briefOf(messages, { codemodeSegmentChars: 0 });
    expect(keptBashRefs(withQuota)).toEqual(keptBashRefs(noQuota));
  });

  test("measurement override can build the uncapped brief", () => {
    const brief = briefOf(codemodeTurn(17), { toolCallsPerTurn: Infinity });
    expect(brief).not.toContain("tool-call entries omitted");
    expect(brief).toContain("step 0");
    expect(brief).toContain("step 16");
  });
});

describe("activity classification", () => {
  test("a recorded write is a potential mutation even when the record is incomplete", () => {
    const evidence = classifyNestedActivity({
      complete: false,
      calls: [nestedCall({ name: "write", status: "ok" }), nestedCall({ name: "bash", status: "unfinished" })],
    });
    expect(evidence.category).toBe("mutation");
    expect(evidence.incomplete).toBe(true);
  });

  test("readonly requires a complete record of known read tools", () => {
    const complete = classifyNestedActivity({
      complete: true,
      calls: [nestedCall({ name: "read" }), nestedCall({ name: "grep" })],
    });
    expect(complete.category).toBe("readonly");
    const incomplete = classifyNestedActivity({
      complete: false,
      calls: [nestedCall({ name: "read" })],
    });
    expect(incomplete.category).toBe("unknown");
    expect(incomplete.incomplete).toBe(true);
  });

  test("bash-only, unknown tools and missing records stay unknown", () => {
    expect(classifyNestedActivity({ complete: true, calls: [nestedCall({ name: "bash" })] }).category).toBe("unknown");
    expect(classifyNestedActivity({ complete: true, calls: [nestedCall({ name: "mystery" })] }).category).toBe("unknown");
    expect(classifyNestedActivity(undefined).category).toBe("unknown");
    expect(classifyNestedActivity(undefined).incomplete).toBe(true);
  });

  test("observes errors without inventing a state", () => {
    const evidence = classifyNestedActivity({
      complete: true,
      calls: [nestedCall({ name: "read" }), nestedCall({ name: "bash", status: "error", error: "exit 1" })],
    });
    expect(evidence.category).toBe("unknown"); // bash is not a known read tool
    expect(evidence.observedError).toBe(true);
    expect(classifyNestedActivity(undefined, true).observedError).toBe(true);
  });

  test("classifies direct tool names for potential mutation and readonly", () => {
    expect(activityClassForToolName("edit")).toBe("mutation");
    expect(activityClassForToolName("apply_patch")).toBe("mutation");
    expect(activityClassForToolName("read")).toBe("readonly");
    expect(activityClassForToolName("bash")).toBe("unknown");
  });
});
