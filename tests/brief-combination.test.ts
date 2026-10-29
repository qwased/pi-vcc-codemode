import { describe, expect, test } from "bun:test";
import { compileRankedWithDetail } from "../src/core/summarize";
import { buildBriefHistory } from "../src/core/brief-history";
import { normalize } from "../src/core/normalize";
import { briefBudgetChars } from "../src/hooks/before-compact";
import { HEADER_CONTEXT_NOTE } from "../src/core/format";
import { assistantText, assistantWithToolCall, toolResult, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const WORDS = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau".split(" ");
const text = (len: number, seed: number): string => {
  let out = "";
  let i = seed;
  while (out.length < len) {
    out += (out ? " " : "") + WORDS[i % WORDS.length];
    i++;
  }
  return out.slice(0, len);
};

const headerText = [
  "[Session Goal]",
  "- ship the controlled combination session",
  "[Files And Changes]",
  "- Modified: src/core/rank.ts",
  "[Commits]",
  "- abc1234 synthetic",
].join("\n");

/**
 * One controlled long session: user constraints, codemode turns, two direct
 * tools (one with an observed error), saturated narration, then the two long
 * reports that must be readable afterwards.
 */
const buildSession = () => {
  const entries: any[] = [];
  let n = 0;
  const push = (message: unknown) => entries.push({ id: `e${n++}`, type: "message", message });
  for (let i = 0; i < 6; i++) {
    push(userMsg("constraint " + i + ": " + text(120, i)));
    push(assistantText(text(110, i + 100)));
    if (i % 2 === 0) {
      push(codemodeCall(codemodeScript("synthetic step " + i, "const step = " + i + ";")));
      push(codemodeResult({ calls: [nestedCall({ name: "read", arguments: { path: "src/f" + i + ".ts" } })] }));
    }
  }
  for (let i = 0; i < 10; i++) push(assistantText(text(100, i + 200)));
  for (let i = 0; i < 12; i++) push(assistantText(text(100, i + 300)));
  push(assistantWithToolCall("Read", { path: "src/recent-a.ts" }));
  push(toolResult("Read", "body a"));
  push(assistantWithToolCall("bash", { command: "bun test tests/combination.test.ts" }));
  push({ ...toolResult("bash", "exit 1"), isError: true });
  push(assistantText(text(2600, 7)));
  push(assistantText(text(3900, 8)));
  push(userMsg("final instruction: keep the synthetic constraint"));
  let parentId: string | undefined;
  return entries.map((entry) => {
    const out = { ...entry, parentId };
    parentId = entry.id;
    return out;
  });
};

const keepOf = (summary: string, length: number, index: number): number => {
  const match = summary.match(new RegExp(`\\[omitted (\\d+) of ${length} chars; recall #${index}\\]`));
  if (match) return length - Number(match[1]);
  return summary.includes(`(#${index})`) ? length : 0;
};

const run = () => {
  const entries = buildSession();
  const history = buildBriefHistory({
    branchEntries: entries,
    globalIndexById: new Map(entries.map((entry, i) => [entry.id, i])),
  });
  const blocks = normalize(history.messages as any, history.sourceIndices).length;
  const budget = briefBudgetChars(blocks, 4);
  const result = compileRankedWithDetail({
    messages: [],
    sourceIndices: [],
    previousSummary: headerText,
    briefHistory: history,
    briefBudgetChars: budget,
  });
  const longA = entries.length - 3;
  const longB = entries.length - 2;
  return {
    blocks,
    budget,
    ...result,
    longA: keepOf(result.summary, 2600, longA),
    longB: keepOf(result.summary, 3900, longB),
  };
};

/**
 * Frozen 0.1.4 numbers for this exact session (measured with the archived
 * build in research/.backup/0.1.5/build-0.1.4, not with the 0.1.5 code):
 *   long keeps 64 / 64; no {result #N} navigation; no provenance note;
 *   assistant folded 7, assistant kept chars 2228; user kept 7 (all full);
 *   usedChars 3754, summary length 4300, budget 4400.
 */
describe("R5: the full combination on one controlled session", () => {
  test("the recent reports are readable, the direct call is navigable, and the budget holds", () => {
    const outcome = run();
    expect(outcome.blocks).toBe(47);
    expect(outcome.budget).toBe(4400);
    expect(outcome.detail.kind).toBe("ok");

    // H1: both reports leave the 64-unit minimum (0.1.4: 64 / 64).
    expect(outcome.longA).toBe(256);
    expect(outcome.longB).toBe(256);

    // H2: the paired direct call carries neutral navigation (0.1.4: none).
    expect(outcome.summary).toMatch(/\(#\d+\) \{result #\d+\}/);
    // An observed error still reads as an error, with its saved result.
    expect(outcome.summary).toMatch(/\{error observed; result #\d+\}/);

    // H3: the recent direct rows are present (0.1.4: present too, scored by name).
    expect(outcome.summary).toContain('Read "src/recent-a.ts"');
    expect(outcome.summary).toContain("bun test tests/combination.test.ts");

    // H4: exactly one provenance line, and the reading note still once.
    expect(outcome.summary.split(HEADER_CONTEXT_NOTE).length - 1).toBe(1);
    expect(outcome.summary.split("Historical navigation, not current state or proof of success").length - 1).toBe(1);

    // The total budget is unchanged: deeper recent text is paid by breadth.
    expect(outcome.summary.length).toBeLessThanOrEqual(outcome.budget);
    expect(outcome.summary.length).toBe(outcome.detail.usedChars + outcome.detail.reservedChars);
  });

  test("the depth cost is bounded: user constraints stay, assistant breadth shrinks", () => {
    const outcome = run();
    // User constraints did not regress (0.1.4: 7 kept, 6 constraint rows).
    expect(outcome.detail.counts.userKept).toBe(7);
    expect(outcome.detail.counts.userFull).toBe(7);
    expect(outcome.detail.counts.userFolded).toBe(0);
    expect(outcome.summary.match(/constraint \d+:/g) ?? []).toHaveLength(6);

    // Breadth cost: 5 more assistant rows folded than 0.1.4 (7 -> 12), and the
    // kept assistant text drops by 116 units (2228 -> 2112). Both are bounded:
    // the trade must not silently turn into "fold everything".
    expect(outcome.detail.counts.assistantFolded).toBe(12);
    expect(outcome.detail.counts.assistantFolded).toBeLessThanOrEqual(15);
    expect(outcome.detail.counts.assistantKeptChars).toBe(2112);
    expect(outcome.detail.counts.assistantKeptChars).toBeGreaterThanOrEqual(1900);
    expect(outcome.detail.counts.toolKept).toBe(5);
    expect(outcome.detail.counts.toolOmitted).toBe(0);
  });

  test("the combination is deterministic", () => {
    const first = run();
    const second = run();
    expect(second.summary).toBe(first.summary);
    expect(second.detail.counts).toEqual(first.detail.counts);
    expect(second.detail.metrics).toEqual(first.detail.metrics);
  });
});
