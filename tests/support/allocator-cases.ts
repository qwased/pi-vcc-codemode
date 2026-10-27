import type { ActivityClass } from "../../src/types";
import type { BriefCandidate } from "../../src/core/brief";

/**
 * Deterministic inputs for the allocator golden fixture. Every case is rebuilt
 * from this file, so the fixture only has to store outputs.
 */
export interface AllocatorCase {
  id: string;
  /** full: expected body is stored; hash: only sha256(text) is stored. */
  shape: "full" | "hash";
  maxChars: number;
  reservedChars: number;
  candidates: BriefCandidate[];
}

const SENTENCE =
  "the quick brown fox jumps over the lazy dog while reviewing src/core/alpha.ts behaviour ";

const body = (seed: number, length: number): string => {
  let out = "";
  let step = 0;
  while (out.length < length) {
    const cut = 24 + ((seed * 31 + step * 17) % 96);
    out += SENTENCE.slice(0, Math.min(SENTENCE.length, cut));
    if (out.length < length) out += " ";
    step++;
  }
  return out.slice(0, length);
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Draft {
  role: "user" | "assistant" | "tool";
  sourceText: string;
  sourceIndex?: number;
  bash?: boolean;
  score?: number;
  tool?: {
    name: string;
    shortNav: string;
    normalNav: string;
    resultIndex?: number;
    observedError: boolean;
    activity: ActivityClass;
  };
}

const materialize = (drafts: Draft[]): BriefCandidate[] =>
  drafts.map((draft, i) => ({
    key: `${i + 1}:${draft.role}`,
    order: i + 1,
    score: draft.score ?? 0,
    ...draft,
  })) as BriefCandidate[];

const tool = (name: string, nav: string, error = false, activity: ActivityClass = "mutation"): Draft => ({
  role: "tool",
  sourceText: "",
  tool: {
    name,
    shortNav: nav.slice(0, 24),
    normalNav: `normal: ${nav}`,
    observedError: error,
    activity,
    ...(error ? { resultIndex: 7 } : {}),
  },
});

const curated = (): AllocatorCase[] => {
  const cases: AllocatorCase[] = [
    { id: "empty", shape: "full", maxChars: 400, reservedChars: 0, candidates: [] },
    {
      id: "budget-too-small",
      shape: "full",
      maxChars: 20,
      reservedChars: 2,
      candidates: materialize([0, 1, 2, 3].map((i) => ({ role: "user", sourceText: body(i, 200), sourceIndex: i }))),
    },
    {
      id: "single-short",
      shape: "full",
      maxChars: 400,
      reservedChars: 0,
      candidates: materialize([{ role: "user", sourceText: body(1, 40), sourceIndex: 1 }]),
    },
    {
      id: "numeric-range-marker",
      shape: "full",
      maxChars: 300,
      reservedChars: 10,
      candidates: materialize([2, 4, 6, 8, 10, 12, 14, 16].map((ref) => ({
        role: "user",
        sourceText: body(ref, 240),
        sourceIndex: ref,
      }))),
    },
    {
      id: "undefined-refs-fold",
      shape: "full",
      maxChars: 300,
      reservedChars: 0,
      candidates: materialize([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ role: "user", sourceText: body(i, 200) }))),
    },
    {
      id: "partial-undefined-fold",
      shape: "full",
      maxChars: 300,
      reservedChars: 0,
      candidates: materialize([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        sourceText: body(i + 3, 200),
        ...(i % 2 === 0 ? { sourceIndex: 10 + i } : {}),
      }))),
    },
    {
      id: "long-excerpt-upgrade",
      shape: "full",
      maxChars: 1500,
      reservedChars: 40,
      candidates: materialize([0, 1, 2, 3, 4, 5].map((i) => ({
        role: "assistant",
        sourceText: body(i * 7, 1800 + i * 120),
        sourceIndex: 20 + i,
      }))),
    },
    {
      id: "unbreakable-wrap-retry",
      shape: "full",
      maxChars: 700,
      reservedChars: 60,
      candidates: materialize([0, 1, 2, 3].map((i) => ({
        role: "user",
        sourceText: "x".repeat(600 + i * 40),
        sourceIndex: 30 + i,
      }))),
    },
    {
      id: "tools-and-text-markers",
      shape: "full",
      maxChars: 500,
      reservedChars: 20,
      candidates: materialize([
        tool("Read", "src/core/alpha.ts", false, "readonly"),
        tool("Edit", "src/core/alpha.ts", true),
        tool("bash", "bun test tests/rank.test.ts", false),
        tool("Grep", "allocateBriefBudget", false, "readonly"),
        tool("Read", "src/core/beta.ts", false, "readonly"),
        tool("codemode", "// goal: measure the allocator", false),
        ...[0, 1, 2, 3, 4, 5].map((i) => ({ role: "user" as const, sourceText: body(i, 220), sourceIndex: 40 + i })),
      ]),
    },
    {
      id: "tools-only-upgrade",
      shape: "full",
      maxChars: 400,
      reservedChars: 0,
      candidates: materialize([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
        tool(i % 2 === 0 ? "Read" : "Edit", `src/core/file-${i}.ts`, i % 5 === 0, i % 3 === 0 ? "readonly" : "mutation"))),
    },
    {
      id: "oversized-single",
      shape: "full",
      maxChars: 1000,
      reservedChars: 100,
      candidates: materialize([{ role: "assistant", sourceText: body(9, 5000), sourceIndex: 9 }]),
    },
    {
      id: "bash-and-plain-mix",
      shape: "full",
      maxChars: 900,
      reservedChars: 30,
      candidates: materialize([0, 1, 2, 3, 4, 5].map((i) => ({
        role: i % 3 === 0 ? ("assistant" as const) : ("user" as const),
        sourceText: body(i + 11, 260),
        sourceIndex: 60 + i,
        ...(i % 3 !== 0 ? { bash: true } : {}),
      }))),
    },
  ];

  for (let seed = 1; seed <= 30; seed++) {
    const rand = mulberry32(seed);
    const count = 2 + Math.floor(rand() * 8);
    const drafts: Draft[] = [];
    for (let i = 0; i < count; i++) {
      drafts.push({
        role: rand() < 0.5 ? "user" : "assistant",
        sourceText: body(seed + i, Math.floor(rand() * 300)),
        ...(rand() < 0.7 ? { sourceIndex: seed * 10 + i } : {}),
        ...(rand() < 0.25 ? { bash: true } : {}),
      });
    }
    cases.push({
      id: `small-${seed}`,
      shape: "full",
      maxChars: 120 + Math.floor(rand() * 680),
      reservedChars: Math.floor(rand() * 60),
      candidates: materialize(drafts),
    });
  }

  return cases;
};

const randomCases = (): AllocatorCase[] => {
  const cases: AllocatorCase[] = [];
  const budgets = [120, 200, 400, 800, 1600, 3000, 6000];
  for (let seed = 1000; seed < 1200; seed++) {
    const rand = mulberry32(seed);
    const count = 1 + Math.floor(rand() * 40);
    const drafts: Draft[] = [];
    for (let i = 0; i < count; i++) {
      const roll = rand();
      if (roll < 0.35) {
        const nav = body(seed + i, Math.floor(rand() * 90)).replace(/\s+/g, " ").trim();
        drafts.push(tool(i % 2 === 0 ? "Read" : "Edit", nav, rand() < 0.2, rand() < 0.4 ? "readonly" : "mutation"));
        continue;
      }
      drafts.push({
        role: roll < 0.7 ? "user" : "assistant",
        sourceText: body(seed + i, Math.floor(rand() * 400)),
        ...(rand() < 0.7 ? { sourceIndex: 100 + i } : {}),
        ...(rand() < 0.2 ? { bash: true } : {}),
      });
    }
    const maxChars = budgets[Math.floor(rand() * budgets.length)];
    cases.push({
      id: `random-${seed}`,
      shape: "hash",
      maxChars,
      reservedChars: Math.floor(rand() * Math.min(200, maxChars / 3)),
      candidates: materialize(drafts),
    });
  }
  return cases;
};

export const buildAllocatorCases = (): AllocatorCase[] => [...curated(), ...randomCases()];
