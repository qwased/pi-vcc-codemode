import { describe, expect, test } from "bun:test";
import { briefBudgetChars } from "../src/hooks/before-compact";
import { buildBriefHistory, type BriefHistory } from "../src/core/brief-history";
import { filterNoise } from "../src/core/filter-noise";
import { normalize } from "../src/core/normalize";
import { compileRankedWithDetail } from "../src/core/summarize";
import { HISTORICAL_NOTE, LIMITED_HISTORY_NOTE, wrapLongLines } from "../src/core/format";
import { assistantText, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript } from "./codemode-fixtures";

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

// ── independent fence oracle (same rule as fences.test.ts) ───────────────
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const parseFence = (line: string): { char: string; length: number; info: string } | null => {
  const match = line.match(FENCE_RE);
  if (!match) return null;
  if (match[2][0] === "`" && match[3].includes("`")) return null;
  return { char: match[2][0], length: match[2].length, info: match[3].trim() };
};
const depthOf = (summary: string, snippet: string): number => {
  const lines = summary.split("\n");
  const at = lines.findIndex((line) => line.includes(snippet));
  expect(at).toBeGreaterThanOrEqual(0);
  let open: { char: string; length: number } | null = null;
  for (let i = 0; i < at; i++) {
    const fence = parseFence(lines[i]);
    if (!fence) continue;
    if (!open) open = fence;
    else if (fence.char === open.char && fence.length >= open.length && fence.info === "") open = null;
  }
  return open ? 1 : 0;
};
const balanced = (summary: string): boolean => {
  let open: { char: string; length: number } | null = null;
  for (const line of summary.split("\n")) {
    const fence = parseFence(line);
    if (!fence) continue;
    if (!open) open = fence;
    else if (fence.char === open.char && fence.length >= open.length && fence.info === "") open = null;
  }
  return !open;
};

// ── fixtures ────────────────────────────────────────────────────────────

const headerText = [
  "[Session Goal]",
  "- ship the synthetic budget matrix",
  "[Files And Changes]",
  "- Modified: src/core/rank.ts",
  "[Commits]",
  "- abc1234 synthetic",
].join("\n");

const makeHistory = (targetBlocks: number, limited = false): BriefHistory => {
  // One codemode call is one block and already opens the new-path gate; the
  // paired result is a second block, so a 1-block history ends after the call.
  const messages: any[] = [
    codemodeCall(codemodeScript("synthetic target for the budget matrix", "const a = 1;")),
  ];
  if (targetBlocks > 1) messages.push(codemodeResult());
  let i = 0;
  for (;;) {
    const blocks = filterNoise(normalize(messages, messages.map((_, k) => k)), { keepUserSourceIndex: true }).length;
    if (blocks >= targetBlocks) break;
    messages.push(i % 3 === 0 ? assistantText(text(140, i)) : userMsg(text(90, i)));
    i++;
  }
  const blocks = filterNoise(normalize(messages, messages.map((_, k) => k)), { keepUserSourceIndex: true }).length;
  expect(blocks).toBe(targetBlocks);
  return {
    messages,
    sourceIndices: messages.map((_, k) => k),
    hadCodemodeHistory: true,
    hasContextEdits: false,
    ...(limited ? { limitedReason: "edited-checkpoint" as const } : {}),
  };
};

const referenceIndices = (history: BriefHistory): Set<number> =>
  new Set(history.sourceIndices.filter((value): value is number => typeof value === "number"));

const assertInvariants = (result: ReturnType<typeof compileRankedWithDetail>, budget: number, allowed: Set<number>) => {
  const { summary, detail } = result;
  expect(detail.budgetChars).toBe(budget);
  if (detail.kind !== "ok") {
    expect(detail.kind).toBe("budget-too-small");
    expect(summary).toBe("");
    return;
  }
  if (summary === "") {
    // An empty ok summary carries no header titles (nothing rendered).
    expect(detail.headerNames).toEqual([]);
    return;
  }
  expect(summary.length).toBeLessThanOrEqual(budget);
  expect(summary.length).toBe(detail.usedChars + detail.reservedChars);
  expect(detail.headerChars).toBeLessThanOrEqual(
    Math.max(0, Math.floor((budget - detail.noteChars - 7) * 0.2)),
  );
  // Every generated ref belongs to a saved entry of this effective history.
  for (const match of summary.matchAll(/#(\d+)/g)) {
    expect(allowed.has(Number(match[1]))).toBe(true);
  }
  // Structural lines never sit inside a code fence.
  expect(balanced(summary)).toBe(true);
  for (const snippet of ["[user]", "[assistant]"]) {
    if (summary.includes(snippet)) expect(depthOf(summary, snippet)).toBe(0);
  }
  if (summary.includes("* codemode")) expect(depthOf(summary, "* codemode")).toBe(0);
  expect(depthOf(summary, "Historical navigation")).toBe(0);
};

describe("brief invariants: budget matrix", () => {
  const blockCounts = [1, 73, 74, 133, 134, 1000];
  const ratios = [2, 4, 6];

  for (const blocks of blockCounts) {
    for (const cpt of ratios) {
      for (const withHeader of [false, true]) {
        for (const limited of [false, true]) {
          const label = `blocks=${blocks} cpt=${cpt} header=${withHeader ? "yes" : "no"} limited=${limited ? "yes" : "no"}`;
          test(label, () => {
            const history = makeHistory(blocks, limited);
            const budget = briefBudgetChars(blocks, cpt);
            const result = compileRankedWithDetail({
              messages: [],
              sourceIndices: [],
              previousSummary: withHeader ? headerText : undefined,
              briefHistory: history,
              briefBudgetChars: budget,
            });
            assertInvariants(result, budget, referenceIndices(history));
            expect(result.detail.limited).toBe(limited);
            if (result.summary !== "") {
              expect(HISTORICAL_NOTE.length).toBe(395);
              expect(wrapLongLines(HISTORICAL_NOTE).length).toBe(395);
              if (limited) expect(result.summary).toContain(LIMITED_HISTORY_NOTE);
              else expect(result.summary).not.toContain(LIMITED_HISTORY_NOTE);
            }
          });
        }
      }
    }
  }
});

describe("brief invariants: single-char sweeps", () => {
  test("around the floor/ceiling turning points and the excerpt threshold", () => {
    const history = makeHistory(14);
    const allowed = referenceIndices(history);
    const centre = briefBudgetChars(14, 4);
    for (let budget = centre - 20; budget <= centre + 20; budget++) {
      const result = compileRankedWithDetail({
        messages: [],
        sourceIndices: [],
        previousSummary: headerText,
        briefHistory: history,
        briefBudgetChars: budget,
      });
      assertInvariants(result, budget, allowed);
    }
  });

  test("a wide sweep crosses excerpt, marker and row thresholds", () => {
    const history = makeHistory(10);
    const allowed = referenceIndices(history);
    for (let budget = 380; budget <= 620; budget++) {
      const result = compileRankedWithDetail({
        messages: [],
        sourceIndices: [],
        previousSummary: headerText,
        briefHistory: history,
        briefBudgetChars: budget,
      });
      assertInvariants(result, budget, allowed);
    }
  });
});

describe("brief invariants: tool call/result refs are independently correct", () => {
  test("a result ref belongs to the call it was paired with", () => {
    const history = makeHistory(8);
    const result = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: briefBudgetChars(8, 6),
    });
    expect(result.detail.kind).toBe("ok");
    const toolLines = result.summary.split("\n").filter((line) => line.startsWith("* ") && line.includes("(#"));
    expect(toolLines.length).toBeGreaterThan(0);
    for (const line of toolLines) {
      const callRef = line.match(/\(#(\d+)\)/)?.[1];
      const resultRef = line.match(/\{result #(\d+)\}/)?.[1];
      if (resultRef === undefined) continue;
      // The synthetic history puts each result immediately after its call.
      expect(Number(resultRef)).toBe(Number(callRef) + 1);
    }
  });
});
