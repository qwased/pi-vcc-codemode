import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildBriefCandidates, type BriefCandidate } from "../src/core/brief";
import { allocateBriefBudget } from "../src/core/rank";
import type { NormalizedBlock } from "../src/types";

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

const assistantBlocks = (lengths: number[]): NormalizedBlock[] =>
  lengths.map((len, i) => ({ kind: "assistant" as const, text: text(len, i), sourceIndex: i }));

/** Keep actually applied to one candidate, read back from the rendered brief. */
const keepOf = (selectionText: string, candidate: BriefCandidate, index: number): number => {
  const len = candidate.sourceText.length;
  const pattern = new RegExp(`\\[omitted (\\d+) of ${len} chars; recall #${index}\\]`);
  const match = selectionText.match(pattern);
  if (match) return len - Number(match[1]);
  // No marker for this row: either it was kept whole (it carries its ref) or it
  // was folded away (nothing of it is rendered).
  return selectionText.includes(`(#${index})`) ? len : 0;
};

/** The plan's §8.1 pool: 18 short notes, then two long reports (2,560 / 3,973). */
const reportPool = (): { candidates: BriefCandidate[]; lengths: number[] } => {
  const lengths = [...Array.from({ length: 18 }, (_, i) => 91 + (i % 2)), 2560, 3973];
  const candidates = buildBriefCandidates(assistantBlocks(lengths));
  return { candidates, lengths };
};

describe("H1: recent long assistant text", () => {
  test("§8.1: at maxChars 2000 both long reports get at least 128 units", () => {
    const { candidates } = reportPool();
    const selection = allocateBriefBudget(candidates, { maxChars: 2000, reservedChars: 0 });
    expect(selection.kind).toBe("ok");
    expect(selection.usedChars).toBeLessThanOrEqual(2000);
    expect(keepOf(selection.text, candidates[18], 18)).toBeGreaterThanOrEqual(128);
    expect(keepOf(selection.text, candidates[19], 19)).toBeGreaterThanOrEqual(128);
  });

  test("§8.1 matrix: depth is funded by folding older narration inside the same budget", () => {
    // Before 0.1.5 this pool kept 64/64 for the two reports at 1,900-2,200 and
    // folded 2/0/0/0 short rows (0.1.4 used 1,869/2,000/2,064/2,190 chars). The
    // numbers below are the measured 0.1.5 values: the design target of 256 is
    // reached, and the cost is 4-6 folded short rows, never extra budget.
    const { candidates } = reportPool();
    const expected = [
      { maxChars: 1900, usedChars: 1863, full: 12, folded: 6, long18: 256, long19: 256 },
      { maxChars: 2000, usedChars: 1961, full: 13, folded: 5, long18: 256, long19: 256 },
      { maxChars: 2100, usedChars: 2058, full: 14, folded: 4, long18: 256, long19: 256 },
      { maxChars: 2200, usedChars: 2156, full: 15, folded: 3, long18: 256, long19: 256 },
    ];
    for (const row of expected) {
      const selection = allocateBriefBudget(candidates, { maxChars: row.maxChars, reservedChars: 0 });
      expect(selection.kind).toBe("ok");
      expect(selection.usedChars).toBeLessThanOrEqual(row.maxChars);
      expect(selection.usedChars).toBe(row.usedChars);
      expect(selection.counts.assistantFull).toBe(row.full);
      expect(selection.counts.assistantFolded).toBe(row.folded);
      expect(keepOf(selection.text, candidates[18], 18)).toBe(row.long18);
      expect(keepOf(selection.text, candidates[19], 19)).toBe(row.long19);
    }
  });

  test("across the 1,900-2,400 band both reports stay at or above the 128 gate", () => {
    // Per-budget monotonicity is NOT a property of this allocator: the structure
    // retry and role borrowing make the effective body budget uneven at 50-char
    // steps (0.1.4 shows the same 64/64 vs 64/128 alternation at 1,900/1,950).
    // What the upgrade guarantees is the floor: every budget in this band keeps
    // both reports deeper than the old 64-unit excerpt, and the pair is never
    // shallower than 512 units total.
    const { candidates } = reportPool();
    for (let maxChars = 1900; maxChars <= 2400; maxChars += 50) {
      const selection = allocateBriefBudget(candidates, { maxChars, reservedChars: 0 });
      const first = keepOf(selection.text, candidates[18], 18);
      const second = keepOf(selection.text, candidates[19], 19);
      expect(first).toBeGreaterThanOrEqual(128);
      expect(second).toBeGreaterThanOrEqual(128);
      expect(first + second).toBeGreaterThanOrEqual(512);
    }
  });
});

describe("H1: target selection is positional only", () => {
  test("255 units is not a target, 256 is", () => {
    const short = buildBriefCandidates(assistantBlocks([91, 91, 91, 91, 91, 255]));
    const shortSel = allocateBriefBudget(short, { maxChars: 2000, reservedChars: 0 });
    expect(shortSel.metrics!.assistantTargetCount).toBe(0);

    const long = buildBriefCandidates(assistantBlocks([91, 91, 91, 91, 91, 256]));
    const longSel = allocateBriefBudget(long, { maxChars: 2000, reservedChars: 0 });
    expect(longSel.metrics!.assistantTargetCount).toBe(1);
    expect(longSel.metrics!.assistantTargetKeptChars).toBeGreaterThan(64);
  });

  test("only the last six assistant texts are depth candidates", () => {
    // A long text 7 rows from the end is outside the window.
    const outside = buildBriefCandidates(assistantBlocks([2000, 91, 92, 91, 92, 91, 92]));
    expect(allocateBriefBudget(outside, { maxChars: 2000, reservedChars: 0 }).metrics!.assistantTargetCount).toBe(0);
    // The same long text as the 4th-from-end row is inside it.
    const inside = buildBriefCandidates(assistantBlocks([91, 92, 91, 2000, 92, 91, 92]));
    const insideSel = allocateBriefBudget(inside, { maxChars: 2000, reservedChars: 0 });
    expect(insideSel.metrics!.assistantTargetCount).toBe(1);
    expect(insideSel.targets!.map((target) => target.sourceIndex)).toEqual([3]);
  });

  test("at most the newest two long texts are targets", () => {
    const pool = buildBriefCandidates(assistantBlocks([2000, 2000, 2000, 91, 92]));
    const selection = allocateBriefBudget(pool, { maxChars: 2000, reservedChars: 0 });
    expect(selection.metrics!.assistantTargetCount).toBe(2);
    // Newest first in the record.
    expect(selection.targets!.map((target) => target.sourceIndex)).toEqual([2, 1]);
  });

  test("no wording weight: a report claiming completion gets no extra depth", () => {
    const plain = buildBriefCandidates(assistantBlocks([91, 91, 91, 91, 91, 900]));
    const plainSel = allocateBriefBudget(plain, { maxChars: 2000, reservedChars: 0 });
    // Same length, same position: only the wording differs.
    const claimed = buildBriefCandidates(
      assistantBlocks([91, 91, 91, 91, 91, 900]).map((block, i) =>
        i === 5
          ? { ...block, text: ("final report: tests passed, verified complete. " + (block as any).text).slice(0, 900) }
          : block),
    );
    const claimedSel = allocateBriefBudget(claimed, { maxChars: 2000, reservedChars: 0 });
    const claimedKeep = keepOf(claimedSel.text, claimed[5], 5);
    expect(claimedKeep).toBe(keepOf(plainSel.text, plain[5], 5));
    expect(claimedSel.metrics!.assistantTargetCount).toBe(plainSel.metrics!.assistantTargetCount);
  });
});

describe("H1: bounded degradation", () => {
  test("a user-only pool at a tight budget keeps the 0.1.4 allocation", () => {
    // Frozen from the archived 0.1.4 build (research/.backup/0.1.5/build-0.1.4):
    // usedChars 958, sha 543b0506..., userKept 6 / userFull 2 / userExcerpted 4,
    // userKeptChars 756, userSourceChars 5300. A long recent USER text is not a
    // depth target: only assistant text is.
    const lengths = [2000, 1500, 900, 400, 300, 200];
    const blocks: NormalizedBlock[] = lengths.map((len, i) => ({ kind: "user" as const, text: text(len, i), sourceIndex: i }));
    const candidates = buildBriefCandidates(blocks);
    const selection = allocateBriefBudget(candidates, { maxChars: 1000, reservedChars: 0 });
    expect(selection.kind).toBe("ok");
    expect(selection.usedChars).toBe(958);
    expect(createHash("sha256").update(selection.text).digest("hex"))
      .toBe("543b05066a2d9c2001b770fd400d101e14121ffea44c0f4ca50fbb4810fb90e3");
    expect(selection.counts).toMatchObject({
      userKept: 6, userFull: 2, userExcerpted: 4, userFolded: 0,
      userKeptChars: 756, userSourceChars: 5300,
    });
  });

  test("no long assistant text means no targets and no reserved allowance", () => {
    const pool = buildBriefCandidates(assistantBlocks([91, 92, 90, 91]));
    const selection = allocateBriefBudget(pool, { maxChars: 400, reservedChars: 0 });
    expect(selection.kind).toBe("ok");
    expect(selection.metrics!.assistantTargetCount).toBe(0);
    expect(selection.metrics!.assistantTargetKeptChars).toBe(0);
    // No targets: the optional record is absent, not an empty array.
    expect(selection.targets).toBeUndefined();
  });

  test("a very narrow budget still degrades honestly", () => {
    const { candidates } = reportPool();
    for (const maxChars of [120, 220, 320]) {
      const selection = allocateBriefBudget(candidates, { maxChars, reservedChars: 0 });
      if (selection.kind === "ok") {
        expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(maxChars);
      } else {
        expect(selection.text).toBe("");
        expect(selection.usedChars).toBe(0);
      }
    }
  });
});

describe("H1: target records and metrics", () => {
  test("records report per-report depth with head/tail split", () => {
    const { candidates } = reportPool();
    const selection = allocateBriefBudget(candidates, { maxChars: 2000, reservedChars: 0 });
    const records = selection.targets!;
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.sourceIndex)).toEqual([19, 18]);
    for (const record of records) {
      expect(record.folded).toBe(false);
      expect(record.headChars).toBe(Math.ceil(record.keepChars / 2));
      expect(record.tailChars).toBe(Math.floor(record.keepChars / 2));
      expect(record.sourceChars).toBe([2560, 3973][records.indexOf(record) === 0 ? 1 : 0]);
    }
    expect(selection.metrics!.assistantTargetKeptChars)
      .toBe(records.reduce((sum, record) => sum + record.keepChars, 0));
    expect(selection.metrics!.assistantTargetDeep128).toBe(2);
    expect(selection.metrics!.assistantTargetSourceChars).toBe(2560 + 3973);
  });

  test("a folded target is reported with zero keep, not dropped from the list", () => {
    const pool = buildBriefCandidates(assistantBlocks([2560, 3973]));
    const selection = allocateBriefBudget(pool, { maxChars: 200, reservedChars: 0 });
    expect(selection.kind).toBe("ok");
    const records = selection.targets!;
    expect(records).toHaveLength(2);
    const folded = records.filter((record) => record.folded);
    expect(folded).toHaveLength(1);
    expect(folded[0].keepChars).toBe(0);
    expect(folded[0].headChars).toBe(0);
    expect(folded[0].tailChars).toBe(0);
    expect(selection.metrics!.assistantTargetFolded).toBe(1);
  });
});
