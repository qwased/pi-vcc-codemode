import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  registerBeforeCompactHook,
  PI_VCC_COMPACT_INSTRUCTION,
  briefBudgetChars,
} from "../src/hooks/before-compact";
import { buildBriefHistory } from "../src/core/brief-history";
import { normalize } from "../src/core/normalize";
import { estimateMessageContentChars } from "../src/core/token-estimate";
import { codemodeCall, codemodeResult, codemodeScript } from "./codemode-fixtures";

let tmpDir: string;
let CONFIG_PATH: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-budget-"));
  CONFIG_PATH = join(tmpDir, "pi-vcc-config.json");
  process.env.PI_VCC_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.PI_VCC_CONFIG_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

function createMockPi() {
  let beforeHandler: ((event: any, ctx: any) => any) | undefined;
  const ctx = { hasUI: false, model: undefined as any, ui: { notify: () => {} } };
  return {
    pi: {
      on: (eventName: string, h: (e: any, c: any) => any) => {
        if (eventName === "session_before_compact") beforeHandler = h;
      },
      sendUserMessage: () => {},
      sendMessage: () => {},
    } as any,
    invokeBefore: (event: any) => beforeHandler!(event, ctx),
  };
}

const msg = (id: string, role: "user" | "assistant" | "toolResult", content = "x") => ({
  id,
  type: "message",
  message: { role, content },
});

const text = (length: number, seed = 0): string => {
  const unit = `synthetic budget text ${seed} `;
  let out = "";
  while (out.length < length) out += unit;
  return out.slice(0, length);
};

/** A branch with one codemode turn plus plain messages, padded to a char total divisible by 12. */
const buildBranch = (): any[] => {
  const entries: any[] = [
    msg("u1", "user", text(120, 1)),
    { id: "c1", type: "message", message: codemodeCall(codemodeScript("inspect the synthetic budget", "const a = 1;")) },
    { id: "r1", type: "message", message: codemodeResult() },
    msg("a1", "assistant", text(120, 2)),
    msg("u2", "user", text(120, 3)),
    msg("a2", "assistant", text(120, 4)),
  ];
  const chars = (list: any[]) => list.reduce((sum, e) => sum + estimateMessageContentChars(e.message.content), 0);
  const pad = (12 - (chars(entries) % 12)) % 12;
  if (pad > 0) entries.push(msg("pad", "user", "p".repeat(pad)));
  return entries;
};

const event = (branchEntries: any[], tokensBefore: number) => ({
  type: "session_before_compact",
  customInstructions: PI_VCC_COMPACT_INSTRUCTION + " keep:0",
  branchEntries,
  preparation: { previousSummary: undefined, fileOps: { read: [], written: [], edited: [] }, tokensBefore },
  signal: new AbortController().signal,
});

const compileOnce = (branchEntries: any[], charsPerToken: number) => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ debug: false, overrideDefaultCompaction: false }));
  const chars = branchEntries.reduce((sum, e) => sum + estimateMessageContentChars(e.message.content), 0);
  const { pi, invokeBefore } = createMockPi();
  registerBeforeCompactHook(pi);
  const result = invokeBefore(event(branchEntries, chars / charsPerToken));
  return { result, chars };
};

describe("briefBudget metadata (H5)", () => {
  for (const charsPerToken of [2, 4, 6]) {
    test(`records the real budget at ${charsPerToken} chars/token`, () => {
      const branch = buildBranch();
      const { result } = compileOnce(branch, charsPerToken);
      expect(result.compaction).toBeDefined();
      const details = result.compaction.details;
      expect(details.briefHistoryMessageCount).toBeGreaterThan(0);

      const budget = details.briefBudget;
      expect(budget).toBeDefined();
      expect(budget!.charsPerToken).toBe(charsPerToken);

      // Blocks are the normalize() count of the effective history, not messages.
      const history = buildBriefHistory({
        branchEntries: branch,
        firstKeptEntryId: result.compaction.firstKeptEntryId ?? "",
      });
      const blocks = normalize(history.messages as any, history.sourceIndices).length;
      expect(budget!.historyBlockCount).toBe(blocks);
      expect(budget!.maxChars).toBe(briefBudgetChars(blocks, charsPerToken));
      expect(budget!.usedChars + budget!.reservedChars).toBe(result.compaction.summary.length);
      // messageCount keeps its own meaning: messages, not blocks.
      expect(details.briefHistoryMessageCount).not.toBeUndefined();
    });
  }

  test("the budget formula is the documented one across the block matrix", () => {
    for (const blocks of [1, 73, 74, 133, 134, 1000]) {
      for (const cpt of [2, 4, 6]) {
        const tokens = Math.min(2000, Math.max(1100, 15 * blocks));
        expect(briefBudgetChars(blocks, cpt)).toBe(Math.round(tokens * cpt));
      }
    }
    // The floor and ceiling turning points.
    expect(briefBudgetChars(73, 4)).toBe(4400);
    expect(briefBudgetChars(74, 4)).toBe(4440);
    expect(briefBudgetChars(133, 4)).toBe(7980);
    expect(briefBudgetChars(134, 4)).toBe(8000);
  });

  test("a non-codemode session has no budget metadata", () => {
    const branch = [
      msg("u1", "user", text(120)),
      msg("a1", "assistant", text(120)),
      msg("u2", "user", text(120)),
      msg("a2", "assistant", text(120)),
    ];
    const { result } = compileOnce(branch, 4);
    const details = result.compaction.details;
    expect(details.compactor).toBe("pi-vcc");
    expect(details.briefHistoryMessageCount).toBeUndefined();
    expect(details.briefBudget).toBeUndefined();
  });

  test("the record is plain JSON", () => {
    const { result } = compileOnce(buildBranch(), 4);
    const details = result.compaction.details;
    expect(JSON.parse(JSON.stringify(details))).toEqual(details);
  });
});
