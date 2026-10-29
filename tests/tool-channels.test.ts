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
import { userMsg } from "./fixtures";

// ── candidate helpers ────────────────────────────────────────────────────

const toolCandidate = (
  order: number,
  overrides: Partial<BriefToolView> & { score?: number; name?: string } = {},
): BriefCandidate => {
  const { score = 30, name = "Read", ...tool } = overrides;
  return {
    key: `${order}:tool`,
    order,
    role: "tool",
    sourceIndex: order,
    sourceText: "",
    score,
    evidence: { category: "readonly", observedError: Boolean(tool.observedError), incomplete: false },
    tool: {
      name,
      shortNav: `"src/f${order}.ts"`,
      normalNav: `"src/files/f${order}.ts"`,
      observedError: false,
      activity: "readonly",
      ...tool,
    },
  };
};

const codemode = (order: number, score = 60): BriefCandidate =>
  toolCandidate(order, {
    name: "codemode",
    score,
    shortNav: `goal: synthetic step ${order}`,
    normalNav: `goal: synthetic step ${order} with a longer description`,
    activity: "mutation",
  });

const shortCost = (candidate: BriefCandidate): number =>
  wrapLongLines(renderToolCandidate(candidate, "short")).length + 1;
const normalCost = (candidate: BriefCandidate): number =>
  wrapLongLines(renderToolCandidate(candidate, "normal")).length + 1;

const lines = (text: string): string[] => text.split("\n");
const toolRows = (text: string): string[] => lines(text).filter((line) => line.startsWith("* ") && !line.includes("omitted"));

// ── T08: a limited direct-tool channel ───────────────────────────────────

describe("H3: direct-tool channel", () => {
  test("recent direct calls survive a codemode-dominated pool", () => {
    const directRead = toolCandidate(20, { resultIndex: 100, score: 22 });
    const directBash = toolCandidate(21, {
      name: "bash",
      shortNav: '"bun test tests/tool-channels.test.ts"',
      normalNav: '"bun test tests/tool-channels.test.ts"',
      resultIndex: 101,
      score: 21,
    });
    const candidates = [
      ...Array.from({ length: 20 }, (_, i) => codemode(i)),
      directRead,
      directBash,
      ...Array.from({ length: 10 }, (_, i) => codemode(22 + i)),
    ];
    // The direct channel is 20% of the tool quota, so two rows need a quota of
    // at least 5x their combined cost. Below that only one can enter, by design.
    const budget = (shortCost(directRead) + shortCost(directBash)) * 5
      + shortCost(codemode(31)) * 2 + 200;
    const selection = allocateBriefBudget(candidates, { maxChars: budget });
    expect(selection.kind).toBe("ok");
    expect(selection.text).toContain(renderToolCandidate(directRead, "short"));
    expect(selection.text).toContain(renderToolCandidate(directBash, "short"));
    expect(selection.metrics!.toolDirectTotal).toBe(2);
    expect(selection.metrics!.toolDirectKept).toBe(2);
    expect(selection.metrics!.toolChannelDirectSelected).toBe(2);
    expect(selection.metrics!.toolChannelDirectFinal).toBe(2);
    // Rows outside the channel are still dropped when the budget is tight.
    expect(selection.counts.toolOmitted).toBeGreaterThan(0);
  });

  test("unused channel allowance returns to the generic pool", () => {
    const only = toolCandidate(0);
    const filler = Array.from({ length: 6 }, (_, i) => codemode(i + 1));
    const candidates = [only, ...filler];
    // Fits exactly one direct row plus a generous remainder for codemode rows.
    const selection = allocateBriefBudget(candidates, { maxChars: shortCost(only) + 400 });
    expect(selection.kind).toBe("ok");
    expect(selection.counts.toolKept).toBeGreaterThan(2);
    expect(selection.metrics!.toolChannelDirectSelected).toBe(1);
  });

  test("the direct channel is bounded at two recent calls", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) => toolCandidate(i, { score: 10 + i })),
      ...Array.from({ length: 4 }, (_, i) => codemode(10 + i, 70)),
    ];
    const selection = allocateBriefBudget(candidates, { maxChars: 600 });
    expect(selection.kind).toBe("ok");
    expect(selection.metrics!.toolChannelDirectSelected).toBeLessThanOrEqual(2);
    expect(selection.metrics!.toolChannelDirectSelected).toBe(2);
  });
});

// ── T09: an error row keeps its error identity, charged once ─────────────

describe("H3: direct and error channels never double-charge", () => {
  test("the newest direct call that failed stays a single error row", () => {
    const failed = toolCandidate(9, { observedError: true, resultIndex: 90, score: 20 });
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) => codemode(i, 60)),
      failed,
    ];
    const selection = allocateBriefBudget(candidates, { maxChars: 500 });
    expect(selection.kind).toBe("ok");
    const rows = lines(selection.text).filter((line) => line.includes("#9"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("{error observed; result #90}");
    expect(selection.metrics!.toolChannelErrorSelected).toBe(1);
    expect(selection.metrics!.toolChannelErrorFinal).toBe(1);
    // Not counted again as a direct-channel addition.
    expect(selection.metrics!.toolChannelDirectSelected).toBe(0);
    expect(selection.metrics!.toolChannelDirectFinal).toBe(0);
  });
});

// ── T10: contraction downgrades before deleting, then layer order ───────

describe("H3: contraction", () => {
  const pool = (): BriefCandidate[] => {
    const error = toolCandidate(0, { observedError: true, resultIndex: 80, score: 90 });
    const direct = [toolCandidate(1, { score: 20 }), toolCandidate(2, { score: 21 })];
    const normal = Array.from({ length: 8 }, (_, i) => toolCandidate(3 + i, { score: 50 - i }));
    return [error, ...direct, ...normal];
  };

  test("across the budget sweep, rows are downgraded before any normal row is deleted", () => {
    const candidates = pool();
    let sawNormalDropped = false;
    let sawNormalKept = false;
    for (let budget = 120; budget <= 1200; budget += 5) {
      const selection = allocateBriefBudget(candidates, { maxChars: budget });
      expect(selection.kind).toBe("ok");
      expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(budget);
      const metrics = selection.metrics!;
      if (metrics.toolChannelNormalDropped > 0) {
        sawNormalDropped = true;
        // A generic row that survived contraction is always short: the
        // downgrade pass runs before any deletion.
        expect(selection.counts.toolNormal).toBe(0);
        if (metrics.toolChannelNormalFinal > 0) sawNormalKept = true;
      }
    }
    expect(sawNormalDropped).toBe(true);
    expect(sawNormalKept).toBe(true);
  });

  test("across the budget sweep, deletion order is normal, then direct, then error", () => {
    // The layer rule is an invariant. Note what the sweep can and cannot reach:
    // the omission marker (<= ~80 chars) is the only cost that is charged after
    // selection, and the two channel reserves are 20% each, so a row that got
    // into a channel is never the row that has to go — measured 0 channel
    // deletions across 277 (no-ref) / 497 (ref'd) budget points in
    // research/tmp-h3-reach.ts. Channel deletion stays in the code as a safety
    // net, and this test pins the ordering, not a claim that it fires often.
    const candidates = pool();
    for (let budget = 120; budget <= 1200; budget += 5) {
      const selection = allocateBriefBudget(candidates, { maxChars: budget });
      const metrics = selection.metrics!;
      if (metrics.toolChannelDirectDropped > 0) {
        expect(metrics.toolChannelNormalFinal).toBe(0);
      }
      if (metrics.toolChannelErrorDropped > 0) {
        expect(metrics.toolChannelDirectFinal).toBe(0);
        expect(metrics.toolChannelNormalFinal).toBe(0);
      }
      expect(metrics.toolChannelDirectDropped).toBe(0);
      expect(metrics.toolChannelErrorDropped).toBe(0);
    }
  });

  test("at a feasible budget the error row and the newest direct row both survive", () => {
    const candidates = pool();
    const error = candidates[0];
    const direct = [candidates[1], candidates[2]];
    // 20% error channel and 20% direct channel both have room here.
    const budget = Math.max(shortCost(error), shortCost(direct[0]) + shortCost(direct[1])) * 5 + 200;
    const selection = allocateBriefBudget(candidates, { maxChars: budget });
    expect(selection.kind).toBe("ok");
    const rows = toolRows(selection.text);
    expect(rows.some((row) => row.includes("(#0)") && row.includes("error observed"))).toBe(true);
    expect(rows.some((row) => row.includes("(#2)")) || rows.some((row) => row.includes("(#1)"))).toBe(true);
    // The error row is rendered exactly once, never duplicated by the channel.
    expect(rows.filter((row) => row.includes("(#0)")).length).toBe(1);
  });

  test("when even the channels and the marker cannot coexist, degrade honestly", () => {
    const error = toolCandidate(0, { observedError: true, resultIndex: 80, score: 90 });
    const candidates = [error, ...Array.from({ length: 12 }, (_, i) => codemode(i + 1))];
    for (const budget of [90, 120, 150, 200, 260]) {
      const selection = allocateBriefBudget(candidates, { maxChars: budget });
      if (selection.kind === "ok") {
        expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(budget);
        const marker = lines(selection.text).find((line) => line.includes("tool-call entries omitted"));
        if (marker) expect(selection.counts.toolOmitted).toBeGreaterThan(0);
        expect(selection.text).not.toContain("recall range:[99, 1]");
      } else {
        expect(selection.text).toBe("");
        expect(selection.usedChars).toBe(0);
      }
    }
  });
});

// ── T12: bashExecution is a user row, a bash toolCall is a tool row ──────

describe("H3: bash execution vs bash tool call", () => {
  test("only the tool call consumes the tool channel; metrics keep them apart", () => {
    const blocks = normalize([
      userMsg("Task"),
      // A bashExecution block (the user's own \`$ cmd\`) is a user row.
      { role: "bashExecution", command: "git status --short", output: "", exitCode: 0, timestamp: 0, excludeFromContext: false } as any,
    ]);
    const candidates = buildCandidatesWithTools(blocks);
    const selection = allocateBriefBudget(candidates, { maxChars: 900 });
    expect(selection.kind).toBe("ok");
    expect(selection.metrics!.toolBashExecutionKept).toBe(1);
    expect(selection.metrics!.toolDirectTotal).toBe(1);
    expect(selection.metrics!.toolDirectKept).toBe(1);
    expect(selection.text).toContain("$ git status --short");
  });
});

function buildCandidatesWithTools(blocks: ReturnType<typeof normalize>): BriefCandidate[] {
  // The bashExecution block is a user candidate; add one direct bash tool call
  // with a paired result so the tool channel has exactly one candidate.
  const call: any = { kind: "tool_call", name: "bash", args: { command: "bun test" }, toolCallId: "t1", sourceIndex: 2 };
  const result: any = { kind: "tool_result", name: "bash", text: "ok", toolCallId: "t1", isError: false, sourceIndex: 3 };
  return buildBriefCandidates([...blocks, call, result]);
}
