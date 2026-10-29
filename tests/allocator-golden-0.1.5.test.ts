import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allocateBriefBudget } from "../src/core/rank";
import { buildAllocatorCases } from "./support/allocator-cases";

interface Record015 {
  kind: string;
  usedChars: number;
  reservedChars: number;
  counts: string;
  text?: string;
  textSha256: string;
}

interface DiffRecord {
  id: string;
  hs: string[];
  stages: { H3: boolean; H1: boolean };
  baseline: Record015;
  next: Record015;
  textChanged: boolean;
  refs: { added: number[]; removed: number[] };
  folds: { user: number; assistant: number; tool: number };
  countDelta: Record<string, number>;
  reason: string;
}

const FROZEN_SHA256 = "a888b1be00e0426635b8e991ac0c6b50bbe8845cf69743f538b05da210999eb5";

const fixtureBytes = readFileSync(join(import.meta.dir, "fixtures", "allocator-golden.json"));
const frozen = JSON.parse(fixtureBytes.toString("utf8")) as { cases: any[] };
const registry = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "allocator-golden-0.1.5.json"), "utf8"),
) as {
  baselineSha256: string;
  cases: DiffRecord[];
};

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const countsKey = (counts: Record<string, number>): string =>
  JSON.stringify(Object.keys(counts).sort().map((key) => [key, counts[key]]));

const registered = new Map(registry.cases.map((record) => [record.id, record]));
const frozenById = new Map(frozen.cases.map((record) => [record.id, record]));
const cases = buildAllocatorCases();

describe("allocator golden 0.1.5", () => {
  it("keeps the 0.1.4 baseline fixture byte-identical", () => {
    expect(sha(fixtureBytes.toString("utf8"))).toBe(FROZEN_SHA256);
    expect(registry.baselineSha256).toBe(FROZEN_SHA256);
  });

  it("builds exactly the frozen case set", () => {
    expect(cases.map((testCase) => testCase.id).sort()).toEqual([...frozenById.keys()].sort());
    expect(cases).toHaveLength(242);
  });

  it("registers only reviewed records with a stage and a reason", () => {
    for (const record of registry.cases) {
      expect(frozenById.has(record.id)).toBe(true);
      expect(record.hs.length).toBeGreaterThan(0);
      expect(record.reason.length).toBeGreaterThan(0);
      expect(record.stages.H3 || record.stages.H1).toBe(true);
      expect(record.stages.H3).toBe(record.hs.includes("H3"));
      expect(record.stages.H1).toBe(record.hs.includes("H1"));
      expect(record.next.kind).toBeTruthy();
      expect(record.baseline.textSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(record.next.textSha256).toMatch(/^[0-9a-f]{64}$/);
      if (record.textChanged) expect(record.baseline.textSha256).not.toBe(record.next.textSha256);
    }
  });

  it("the registered set equals the set that actually changed", () => {
    const changed = new Set<string>();
    for (const testCase of cases) {
      const baseline = frozenById.get(testCase.id)!;
      const selection = allocateBriefBudget(testCase.candidates, {
        maxChars: testCase.maxChars,
        reservedChars: testCase.reservedChars,
      });
      const sameMetadata = baseline.kind === selection.kind
        && baseline.usedChars === selection.usedChars
        && baseline.reservedChars === selection.reservedChars
        && baseline.counts === countsKey(selection.counts as Record<string, number>);
      const sameText = baseline.shape === "full"
        ? baseline.text === selection.text
        : baseline.textSha256 === sha(selection.text);
      if (!sameMetadata || !sameText) changed.add(testCase.id);
    }
    // Neither a missing registration nor an extra one is allowed.
    expect([...changed].sort()).toEqual([...registered.keys()].sort());
  });

  for (const testCase of cases) {
    const record = registered.get(testCase.id);
    if (!record) continue;
    it(`reproduces the reviewed 0.1.5 values for ${testCase.id}`, () => {
      const selection = allocateBriefBudget(testCase.candidates, {
        maxChars: testCase.maxChars,
        reservedChars: testCase.reservedChars,
      });
      expect(selection.kind).toBe(record.next.kind);
      expect(selection.usedChars).toBe(record.next.usedChars);
      expect(selection.reservedChars).toBe(record.next.reservedChars);
      expect(countsKey(selection.counts as Record<string, number>)).toBe(record.next.counts);
      expect(sha(selection.text)).toBe(record.next.textSha256);
      if (record.next.text !== undefined) expect(selection.text).toBe(record.next.text);
      // Every changed record still fits its own budget.
      expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(testCase.maxChars);
    });
  }
});
