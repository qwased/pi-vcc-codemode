import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allocateBriefBudget } from "../src/core/rank";
import { buildAllocatorCases } from "./support/allocator-cases";

interface GoldenRecord {
  id: string;
  shape: "full" | "hash";
  kind: string;
  usedChars: number;
  reservedChars: number;
  counts: string;
  text?: string;
  textSha256?: string;
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "allocator-golden.json"), "utf8"),
) as { cases: GoldenRecord[] };

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const countsKey = (counts: Record<string, number>): string =>
  JSON.stringify(Object.keys(counts).sort().map((key) => [key, counts[key]]));

const expected = new Map(fixture.cases.map((record) => [record.id, record]));
const cases = buildAllocatorCases();

/**
 * Frozen from the allocator before the cost-meter / fold-scan change. Any
 * difference means the optimization changed the brief, not just its speed.
 */
describe("allocator golden", () => {
  it("rebuilds exactly the fixture's case set", () => {
    expect(cases.map((testCase) => testCase.id).sort()).toEqual([...expected.keys()].sort());
  });

  for (const testCase of cases) {
    it(`reproduces ${testCase.id}`, () => {
      const record = expected.get(testCase.id)!;
      const selection = allocateBriefBudget(testCase.candidates, {
        maxChars: testCase.maxChars,
        reservedChars: testCase.reservedChars,
      });

      expect(selection.kind).toBe(record.kind);
      expect(selection.usedChars).toBe(record.usedChars);
      expect(selection.reservedChars).toBe(record.reservedChars);
      expect(countsKey(selection.counts as Record<string, number>)).toBe(record.counts);

      if (record.shape === "full") {
        expect(selection.text).toBe(record.text!);
      } else {
        expect(sha(selection.text)).toBe(record.textSha256!);
      }
    });
  }
});
