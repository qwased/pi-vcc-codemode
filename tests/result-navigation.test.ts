import { describe, expect, test } from "bun:test";
import {
  buildBriefCandidates,
  renderToolCandidate,
  type BriefCandidate,
  type BriefToolView,
} from "../src/core/brief";
import { allocateBriefBudget } from "../src/core/rank";
import { wrapLongLines } from "../src/core/format";
import { normalize } from "../src/core/normalize";
import { assistantWithToolCall, toolResult } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const toolCandidate = (overrides: Partial<BriefToolView> = {}): BriefCandidate => ({
  key: "0:tool",
  order: 0,
  role: "tool",
  sourceIndex: 5,
  sourceText: "",
  score: 30,
  evidence: { category: "mutation", observedError: false, incomplete: false },
  tool: {
    name: "Read",
    shortNav: '"src/a.ts"',
    normalNav: '"src/a.ts"',
    observedError: false,
    activity: "readonly",
    ...overrides,
  },
});

const toolOf = (blocks: ReturnType<typeof normalize>) =>
  buildBriefCandidates(blocks).filter((candidate) => candidate.role === "tool");

const noSuccessWords = (line: string) => {
  expect(line).not.toMatch(/success|verified|verified|passed|ok\b|done\b/i);
};

describe("H2: neutral result navigation", () => {
  test("a paired result renders as a plain result ref in both versions", () => {
    const paired = toolCandidate({ resultIndex: 11 });
    expect(renderToolCandidate(paired, "short")).toBe('* Read "src/a.ts" (#5) {result #11}');
    expect(renderToolCandidate(paired, "normal")).toBe('* Read "src/a.ts" (#5) {result #11}');
    noSuccessWords(renderToolCandidate(paired));
  });

  test("result index 0 is a real index (falsy, not missing)", () => {
    expect(renderToolCandidate(toolCandidate({ resultIndex: 0 }))).toContain("{result #0}");
  });

  test("a candidate without a result gets no guessed number", () => {
    expect(renderToolCandidate(toolCandidate())).toBe('* Read "src/a.ts" (#5)');
  });

  test("the suffix is applied to codemode rows too, not only direct tools", () => {
    const blocks = normalize([
      codemodeCall(codemodeScript("read the file", "await tools.read({path: 'a'});")),
      codemodeResult({ calls: [nestedCall({ name: "read", arguments: { path: "a" } })] }),
    ]);
    const [tool] = toolOf(blocks);
    expect(tool.tool!.resultIndex).toBe(1);
    expect(renderToolCandidate(tool)).toBe("* codemode goal: read the file (#0) {result #1}");
  });
});

describe("H2: observed errors keep their own shape", () => {
  test("error with a paired result keeps error observed and adds the ref", () => {
    const blocks = normalize([
      assistantWithToolCall("bash", { command: "false" }),
      { ...toolResult("bash", "exit 1"), isError: true },
    ]);
    const [tool] = toolOf(blocks);
    expect(renderToolCandidate(tool)).toContain('{error observed; result #1}');
    noSuccessWords(renderToolCandidate(tool));
  });

  test("error without a paired result has no number", () => {
    const candidate = toolCandidate({ observedError: true });
    candidate.evidence = { category: "mutation", observedError: true, incomplete: true };
    expect(renderToolCandidate(candidate)).toBe('* Read "src/a.ts" (#5) {error observed}');
  });

  test("an incomplete nested result is navigation, never success", () => {
    const blocks = normalize([
      codemodeCall(codemodeScript("partial run", "await tools.bash({command: 'true'});")),
      codemodeResult({
        complete: false,
        calls: [nestedCall({ name: "bash", arguments: { command: "true" }, status: "unfinished" })],
      }),
    ]);
    const [tool] = toolOf(blocks);
    expect(tool.evidence!.incomplete).toBe(true);
    const line = renderToolCandidate(tool);
    expect(line).toContain("{result #1}");
    noSuccessWords(line);
  });
});

describe("H2: pairing never crosses the effective history", () => {
  test("a call without a result in the history gets no ref", () => {
    const blocks = normalize([assistantWithToolCall("Read", { path: "src/a.ts" })]);
    const [tool] = toolOf(blocks);
    expect(renderToolCandidate(tool)).toBe('* Read "src/a.ts" (#0)');
  });

  test("parallel calls pair by id, and a reused id does not reach the next message", () => {
    // Real parallel calls are two toolCall parts of ONE assistant message.
    const parallel = {
      ...assistantWithToolCall("codemode", {}),
      content: [
        { type: "toolCall", id: "c1", name: "codemode", arguments: { code: codemodeScript("first", "const a = 1;") } },
        { type: "toolCall", id: "c2", name: "codemode", arguments: { code: codemodeScript("second", "const b = 2;") } },
      ],
    } as any;
    const blocks = normalize([
      parallel,
      codemodeResult({ toolCallId: "c2", calls: [nestedCall({ name: "write" })], isError: true }),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "read" })] }),
      codemodeCall(codemodeScript("third", "const c = 3;"), "c1"),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "edit" })] }),
    ]);
    const tools = toolOf(blocks);
    expect(tools.map((t) => t.tool!.resultIndex)).toEqual([2, 1, 4]);
    expect(tools[0].tool!.observedError).toBe(false);
    expect(tools[1].tool!.observedError).toBe(true);
  });
});

describe("H2: the suffix is part of the measured cost", () => {
  test("the suffix widens the measured body by exactly its own length", () => {
    const withRef = allocateBriefBudget([toolCandidate({ resultIndex: 11 })], { maxChars: 4000 });
    const without = allocateBriefBudget([toolCandidate()], { maxChars: 4000 });
    expect(withRef.kind).toBe("ok");
    expect(without.kind).toBe("ok");
    expect(withRef.usedChars - without.usedChars).toBe(" {result #11}".length);
  });

  test("the upgraded normal row is the renderer's own output", () => {
    const long = toolCandidate({ resultIndex: 11, normalNav: '"a much longer navigation string for the same call"' });
    const upgraded = allocateBriefBudget([long], { maxChars: 4000 });
    expect(upgraded.kind).toBe("ok");
    expect(upgraded.text).toContain("a much longer navigation string");
    expect(upgraded.text).toContain("{result #11}");
    const expected = `[assistant]\n${renderToolCandidate(long, "normal")}`;
    expect(upgraded.text).toBe(expected);
    expect(upgraded.usedChars).toBe(wrapLongLines(expected).length);
  });

  test("no row gains a suffix after selection: every line is a rendered candidate", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      ...toolCandidate({ resultIndex: i < 4 ? 20 + i : undefined, shortNav: `"f${i}.ts"`, normalNav: `"file number ${i} with a longer navigation"` }),
      key: `${i}:tool`,
      order: i,
      sourceIndex: 40 + i,
      score: 30 - i,
    }));
    const selection = allocateBriefBudget(candidates, { maxChars: 700 });
    expect(selection.kind).toBe("ok");
    const rendered = new Set(
      candidates.flatMap((candidate) => [
        renderToolCandidate(candidate, "short"),
        renderToolCandidate(candidate, "normal"),
      ]),
    );
    for (const line of selection.text.split("\n").filter((line) => line.startsWith("* "))) {
      expect(rendered.has(line)).toBe(true);
    }
  });
});

describe("H2: same-selection metrics", () => {
  test("counts kept and total result navigation separately from errors", () => {
    const candidates = [
      toolCandidate({ resultIndex: 11 }),
      { ...toolCandidate({ resultIndex: 12 }), key: "1:tool", order: 1, score: 20 },
      { ...toolCandidate({ resultIndex: 13, observedError: true }), key: "2:tool", order: 2, score: 10, evidence: { category: "mutation", observedError: true, incomplete: false } },
      { ...toolCandidate(), key: "3:tool", order: 3, score: 5 },
    ];
    const selection = allocateBriefBudget(candidates, { maxChars: 400 });
    expect(selection.kind).toBe("ok");
    expect(selection.metrics).toBeDefined();
    expect(selection.metrics!.toolResultNavTotal).toBe(2);
    expect(selection.metrics!.toolResultNavKept).toBe(2);
    expect(selection.metrics!.toolErrorResultNavTotal).toBe(1);
    expect(selection.metrics!.toolErrorResultNavKept).toBe(1);
  });

  test("metrics come from the final selection, not the first pass", () => {
    const candidates = [
      { ...toolCandidate({ resultIndex: 11 }), key: "0:tool", order: 0, score: 30, tool: { ...toolCandidate({ resultIndex: 11 }).tool!, normalNav: 'x'.repeat(200) } },
      ...Array.from({ length: 8 }, (_, i) => ({
        ...toolCandidate(),
        key: `${i + 1}:tool`,
        order: i + 1,
        score: 20 - i,
        sourceIndex: 20 + i,
      })),
    ];
    const selection = allocateBriefBudget(candidates, { maxChars: 260 });
    expect(selection.kind).toBe("ok");
    const keptResultRows = selection.text.split("\n").filter((line) => line.includes("{result #")).length;
    expect(selection.metrics!.toolResultNavKept).toBe(keptResultRows);
  });
});
