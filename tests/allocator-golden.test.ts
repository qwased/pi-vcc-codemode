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

/** The 0.1.4 fixture bytes; 0.1.5 must not touch them. */
const FROZEN_SHA256 = "a888b1be00e0426635b8e991ac0c6b50bbe8845cf69743f538b05da210999eb5";

const fixtureBytes = readFileSync(join(import.meta.dir, "fixtures", "allocator-golden.json"));
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as { cases: GoldenRecord[] };
const registry = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "allocator-golden-0.1.5.json"), "utf8"),
) as { cases: { id: string }[] };

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const countsKey = (counts: Record<string, number>): string =>
  JSON.stringify(Object.keys(counts).sort().map((key) => [key, counts[key]]));

const expected = new Map(fixture.cases.map((record) => [record.id, record]));
const changedIn015 = new Set(registry.cases.map((record) => record.id));
const cases = buildAllocatorCases();

/**
 * Frozen from the allocator before the cost-meter / fold-scan change. Any
 * difference means the optimization changed the brief, not just its speed.
 *
 * The fixture's `amended` note names the only records re-measured after 0.1.4
 * made attachRef skip the ref for text with no non-blank line. Those three cases
 * build an empty-text candidate directly, which buildBriefCandidates cannot
 * emit; every other record is byte-identical to the frozen run.
 *
 * 0.1.5: 87 records changed on purpose (direct-tool channel, recent long-text
 * depth). The document itself stays frozen; those records are asserted against
 * tests/fixtures/allocator-golden-0.1.5.json in allocator-golden-0.1.5.test.ts,
 * which also proves the reviewed set equals the set that actually changed.
 */
describe("allocator golden", () => {
  it("keeps the 0.1.4 fixture document frozen", () => {
    expect(sha(fixtureBytes.toString("utf8"))).toBe(FROZEN_SHA256);
  });

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

      if (changedIn015.has(testCase.id)) {
        // Reviewed 0.1.5 change: the original values are kept as the baseline
        // in the sibling fixture and the new values are asserted there.
        expect(registry.cases.some((item) => item.id === testCase.id)).toBe(true);
        return;
      }

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
