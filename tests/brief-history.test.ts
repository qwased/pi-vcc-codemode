import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import * as piCore from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBriefHistory, briefHistoryHasCodemode, type BriefHistory } from "../src/core/brief-history";
import { compile, compileRanked, compileRankedWithDetail } from "../src/core/summarize";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { normalize } from "../src/core/normalize";
import { registerBeforeCompactHook, PI_VCC_COMPACT_INSTRUCTION } from "../src/hooks/before-compact";
import { HISTORICAL_NOTE, LEGACY_HISTORICAL_NOTE, LIMITED_HISTORY_NOTE, RECALL_NOTE, wrapLongLines } from "../src/core/format";
import { assistantText, assistantWithToolCall, toolResult, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const WRAPPED_HISTORICAL_NOTE = wrapLongLines(HISTORICAL_NOTE);

// ── fixtures ──────────────────────────────────────────────────────────────

const entry = (id: string, message: unknown) => ({ id, type: "message", message });

/** Give synthetic entries a real parent chain (the host projection walks it). */
const chain = (entries: any[]) => {
  let parentId: string | undefined;
  return entries.map((item) => {
    const out = { ...item, parentId };
    parentId = item.id;
    return out;
  });
};

const codemodeTurn = (id: string, goal: string, path: string) => [
  entry(`${id}-call`, codemodeCall(codemodeScript(goal, `await tools.write({ path: '${path}', content: 'x' });`))),
  entry(`${id}-result`, codemodeResult({ calls: [nestedCall({ name: "write", arguments: { path } })] })),
];

const historyFor = (
  branchEntries: any[],
  firstKeptEntryId = "",
  extra: Partial<Parameters<typeof buildBriefHistory>[0]> = {},
): BriefHistory =>
  buildBriefHistory({
    branchEntries,
    firstKeptEntryId,
    globalIndexById: buildGlobalIndexById(branchEntries),
    ...extra,
  });

/** §7.1 budget at the default calibration (4 chars/token). */
const budgetFor = (history: BriefHistory): number =>
  Math.round(
    Math.min(2000, Math.max(1100, 15 * normalize(history.messages as any, history.sourceIndices).length)) * 4,
  );

const compileHistory = (history: BriefHistory, extra: Record<string, unknown> = {}): string =>
  compileRanked({
    messages: [],
    sourceIndices: [],
    briefHistory: history,
    briefBudgetChars: budgetFor(history),
    ...extra,
  });

const projectAvailable = typeof (piCore as any).buildSessionProjection === "function";

// ── buildBriefHistory ────────────────────────────────────────────────────

describe("buildBriefHistory: raw window and #N", () => {
  test("excludes system, non-message entries and the retained tail; #N stays global", () => {
    const entries = chain([
      entry("u1", userMsg("first task")),
      entry("s1", { role: "system", content: "SYSTEM_MARKER" } as any),
      { id: "custom1", type: "custom_message", customType: "ext.note", content: "CUSTOM_MARKER", display: false },
      { id: "comp1", type: "compaction", summary: "OLD_SUMMARY", firstKeptEntryId: "" },
      entry("a1", assistantWithToolCall("Read", { path: "src/a.ts" })),
      entry("r1", toolResult("Read", "body")),
      entry("u2", userMsg("retained tail task")),
      entry("a2", assistantText("retained tail answer")),
    ]);
    const history = historyFor(entries, "u2");
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
    // system still occupies #1 even though it is not part of the history.
    expect(history.sourceIndices).toEqual([0, 2, 3]);
    expect(JSON.stringify(history.messages)).not.toContain("SYSTEM_MARKER");
    expect(JSON.stringify(history.messages)).not.toContain("CUSTOM_MARKER");
    expect(JSON.stringify(history.messages)).not.toContain("retained tail");
  });

  test("compact all takes every message up to the branch end", () => {
    const entries = chain([
      entry("u1", userMsg("one")),
      entry("a1", assistantText("two")),
      entry("u2", userMsg("three")),
    ]);
    const history = historyFor(entries);
    expect(history.messages).toHaveLength(3);
    expect(history.sourceIndices).toEqual([0, 1, 2]);
  });

  test("a missing boundary entry fails closed with missing-history", () => {
    const entries = chain([entry("u1", userMsg("one")), entry("a1", assistantText("two"))]);
    const history = historyFor(entries, "ghost");
    expect(history.messages).toEqual([]);
    expect(history.limitedReason).toBe("missing-history");
  });

  test("no edits never depends on the host projection (Pi 1.0-compatible path)", () => {
    const entries = chain([entry("u1", userMsg("one")), entry("a1", assistantText("two"))]);
    const history = buildBriefHistory({
      branchEntries: entries,
      globalIndexById: buildGlobalIndexById(entries),
      project: () => {
        throw new Error("projection must not run without context edits");
      },
    });
    expect(history.messages).toHaveLength(2);
  });

  test("branch retry: only the active branch is rebuilt, refs stay session-global", () => {
    const fileOrder = [
      entry("r1", userMsg("active task")),
      entry("abandoned", assistantWithToolCall("Read", { path: "abandoned.ts" })),
      entry("active-edit", assistantWithToolCall("edit", { file_path: "active.ts" })),
    ];
    const branch = chain([fileOrder[0], fileOrder[2]]);
    const history = historyFor(branch, "", { globalIndexById: buildGlobalIndexById(fileOrder) });
    expect(JSON.stringify(history.messages)).not.toContain("abandoned.ts");
    expect(history.sourceIndices).toEqual([0, 2]);
  });
});

describe.skipIf(!projectAvailable)("buildBriefHistory: context edits", () => {
  test("applies the latest replacement and omit; the source index stays on the original", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      entry("a1", assistantText("ORIGINAL_RESPONSE")),
      entry("a2", assistantText("OMITTED_RESPONSE")),
      entry("u2", userMsg("Next")),
      { id: "e1", type: "context_edit", targetId: "a1", replacement: { content: "OLD_REPLACEMENT" } },
      { id: "e2", type: "context_edit", targetId: "a1", replacement: { content: "LATEST_REPLACEMENT" } },
      { id: "e3", type: "context_edit", targetId: "a2", replacement: null },
    ]);
    const history = historyFor(entries, "u2");
    const serialized = JSON.stringify(history.messages);
    expect(serialized).toContain("LATEST_REPLACEMENT");
    expect(serialized).not.toContain("ORIGINAL_RESPONSE");
    expect(serialized).not.toContain("OLD_REPLACEMENT");
    expect(serialized).not.toContain("OMITTED_RESPONSE");
    const replaced = history.messages.findIndex((m) => JSON.stringify(m).includes("LATEST_REPLACEMENT"));
    expect(history.sourceIndices[replaced]).toBe(1);
    expect(history.hasContextEdits).toBe(true);
  });

  test("an edit located in the tail still applies to the old message it targets", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      entry("a1", assistantText("ORIGINAL_RESPONSE")),
      entry("u2", userMsg("Next")),
      entry("a2", assistantText("Tail answer")),
      { id: "e1", type: "context_edit", targetId: "a1", replacement: { content: "TAIL_APPLIED_REPLACEMENT" } },
    ]);
    // Boundary at u2: the edit entry itself is in the tail region.
    const history = historyFor(entries, "u2");
    expect(JSON.stringify(history.messages)).toContain("TAIL_APPLIED_REPLACEMENT");
    expect(JSON.stringify(history.messages)).not.toContain("ORIGINAL_RESPONSE");
  });

  test("an edited checkpoint limits history to entries after it", () => {
    const entries = chain([
      entry("u1", userMsg("BEFORE_CHECKPOINT_TASK")),
      entry("a1", assistantText("Before checkpoint work.")),
      { id: "comp", type: "compaction", summary: "[user]\nOLD SUMMARY", firstKeptEntryId: "" },
      entry("u2", userMsg("AFTER_CHECKPOINT_TASK")),
      entry("a2", assistantText("After checkpoint work.")),
      { id: "e1", type: "context_edit", targetId: "comp", replacement: null },
    ]);
    const history = historyFor(entries);
    expect(history.limitedReason).toBe("edited-checkpoint");
    expect(JSON.stringify(history.messages)).toContain("AFTER_CHECKPOINT_TASK");
    expect(JSON.stringify(history.messages)).not.toContain("BEFORE_CHECKPOINT_TASK");
  });

  test("hadCodemodeHistory is read before edits and survives an effective zero", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      ...codemodeTurn("cm", "old work", "src/old.ts"),
      entry("a1", assistantText("Done.")),
      entry("u2", userMsg("Next")),
      { id: "e1", type: "context_edit", targetId: "cm-call", replacement: null },
      { id: "e2", type: "context_edit", targetId: "cm-result", replacement: null },
    ]);
    const history = historyFor(entries, "u2");
    expect(history.hadCodemodeHistory).toBe(true);
    expect(history.messages.some((m) => JSON.stringify(m).includes('"name":"codemode"'))).toBe(false);
    expect(briefHistoryHasCodemode(history)).toBe(true);
  });
});

// ── compileRanked: gating and rendering ─────────────────────────────────

describe("compileRanked: codemode history gating", () => {
  test("T02: historical codemode keeps the new brief even when this window is plain", () => {
    const entries = chain([
      entry("u1", userMsg("Investigate the auth flow")),
      ...codemodeTurn("c1", "read auth module", "src/auth.ts"),
      entry("a1", assistantText("Auth read.")),
      { id: "comp1", type: "compaction", summary: "[user]\nOLD SUMMARY", firstKeptEntryId: "" },
      entry("u2", userMsg("Plain follow-up")),
      entry("a2", assistantText("Plain answer.")),
      entry("u3", userMsg("Latest plain task")),
    ]);
    const history = historyFor(entries, "u3");
    // This round's live window holds only plain messages.
    const liveMessages = [entries.find((e) => e.id === "u2")!.message, entries.find((e) => e.id === "a2")!.message];
    const summary = compileRanked({
      messages: liveMessages as any,
      sourceIndices: [5, 6],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain(WRAPPED_HISTORICAL_NOTE);
    expect(summary).toContain("* codemode intent: read auth module (#1)");
    expect(summary).not.toContain("Do not redo work already completed.");
  });

  test("no codemode anywhere: output is byte-identical with and without briefHistory", () => {
    const entries = chain([
      entry("u1", userMsg("Plain task")),
      entry("a1", assistantText("Plain answer")),
      entry("u2", userMsg("Next plain task")),
      entry("a2", assistantText("Next answer")),
    ]);
    const history = historyFor(entries, "u2");
    const liveMessages = [entries[0].message, entries[1].message];
    const previousSummary = "[Session Goal]\n- Plain task\n\n---\n\n[user]\nPlain task";
    const withHistory = compileRanked({
      messages: liveMessages as any,
      sourceIndices: [0, 1],
      previousSummary,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    const legacy = compileRanked({
      messages: liveMessages as any,
      sourceIndices: [0, 1],
      previousSummary,
    });
    expect(withHistory).toBe(legacy);
  });

  test("a missing budget keeps the legacy path (no silent new behavior)", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    const legacy = compileRanked({ messages: [], sourceIndices: [] });
    expect(compileRanked({ messages: [], sourceIndices: [], briefHistory: history })).toBe(legacy);
  });
});

describe.skipIf(!projectAvailable)("compileRanked: edited history", () => {
  test("T26: codemode removed by edits never falls back to the old merge", () => {
    const entries = chain([
      entry("u1", userMsg("Investigate the auth flow")),
      ...codemodeTurn("cm", "read auth module", "src/auth.ts"),
      entry("a1", assistantText("Auth read.")),
      entry("u2", userMsg("Latest task")),
      { id: "e1", type: "context_edit", targetId: "cm-call", replacement: null },
      { id: "e2", type: "context_edit", targetId: "cm-result", replacement: null },
    ]);
    const history = historyFor(entries, "u2");
    const previousSummary = [
      "[Session Goal]",
      "- Investigate the auth flow",
      "",
      "[Files And Changes]",
      "- Modified: src/auth.ts",
      "",
      "---",
      "",
      "[user]",
      "OLD_BRIEF_MARKER",
    ].join("\n");
    const summary = compileRanked({
      messages: [entries[0].message, entries[2].message] as any,
      sourceIndices: [0, 3],
      previousSummary,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(history.limitedReason).toBeUndefined();
    expect(summary).toContain(WRAPPED_HISTORICAL_NOTE);
    expect(summary).toContain("Investigate the auth flow (#0)");
    expect(summary).toContain("Auth read. (#3)");
    expect(summary).not.toContain("OLD_BRIEF_MARKER");
    // The old header files must not be inherited by an edited replay.
    expect(summary).not.toContain("src/auth.ts");
    expect(summary).not.toMatch(/^\* codemode/m);
  });

  test("T16: an edited checkpoint adds the limited hint and drops inherited headers", () => {
    const entries = chain([
      entry("u1", userMsg("BEFORE_CHECKPOINT_TASK")),
      ...codemodeTurn("c1", "old work", "src/old.ts"),
      entry("a1", assistantText("Old done.")),
      { id: "comp", type: "compaction", summary: "[user]\nOLD SUMMARY", firstKeptEntryId: "" },
      entry("u2", userMsg("New task")),
      ...codemodeTurn("c2", "new work", "src/new.ts"),
      entry("a2", assistantText("New done.")),
      { id: "e1", type: "context_edit", targetId: "comp", replacement: null },
    ]);
    const history = historyFor(entries);
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary: "[Session Goal]\n- BEFORE_CHECKPOINT_TASK\n\n[Files And Changes]\n- Modified: src/old.ts",
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain(LIMITED_HISTORY_NOTE);
    expect(summary.split(LIMITED_HISTORY_NOTE)).toHaveLength(2); // exactly once
    expect(summary).toContain("New task (#4)");
    expect(summary).toContain("* codemode intent: new work (#5)");
    expect(summary).not.toContain("BEFORE_CHECKPOINT_TASK");
    expect(summary).not.toContain("src/old.ts");
  });

  test("T15: an omitted message stays out of body and headers; refs remain original", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      ...codemodeTurn("cm", "work", "src/a.ts"),
      entry("a1", assistantText("OMITTED_HEADER_FACT")),
      entry("a2", assistantText("KEPT_FACT")),
      entry("u2", userMsg("Next")),
      { id: "e1", type: "context_edit", targetId: "a1", replacement: null },
    ]);
    const history = historyFor(entries, "u2");
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary: "[Session Goal]\n- something",
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain("KEPT_FACT (#4)");
    expect(summary).not.toContain("OMITTED_HEADER_FACT");
  });
});

describe("compileRanked: history selection and budgets", () => {
  test("T14: inserting a compaction node does not change the rebuilt brief", () => {
    const messages = [
      entry("u1", userMsg("Long task")),
      ...codemodeTurn("c1", "write module", "src/module.ts"),
      entry("a1", assistantText("Module written.")),
      entry("u2", userMsg("Tail task")),
    ];
    const withoutCompaction = chain(messages);
    const withCompaction = chain([
      messages[0],
      { id: "comp", type: "compaction", summary: "OLD", firstKeptEntryId: "" },
      ...messages.slice(1),
    ]);
    const budget = budgetFor(historyFor(withoutCompaction, "u2"));
    const plain = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: historyFor(withoutCompaction, "u2"),
      briefBudgetChars: budget,
    });
    const withNode = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: historyFor(withCompaction, "u2"),
      briefBudgetChars: budget,
    });
    expect(withNode).toBe(plain);
    expect(plain).toContain("intent: write module");
  });

  test("T14: earlier rounds keep their own #N and are not replaced by newer rounds", () => {
    const firstRound = [
      entry("u1", userMsg("ROUND_ONE_TASK")),
      ...codemodeTurn("c1", "round one write", "src/one.ts"),
      entry("a1", assistantText("Round one done.")),
    ];
    const later = [
      ...firstRound,
      { id: "comp1", type: "compaction", summary: "OLD", firstKeptEntryId: "" },
      entry("u2", userMsg("ROUND_TWO_TASK")),
      ...codemodeTurn("c2", "round two write", "src/two.ts"),
      entry("a2", assistantText("Round two done.")),
      entry("u3", userMsg("Tail")),
    ];
    const branch = chain(later);
    const history = historyFor(branch, "u3");
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain("ROUND_ONE_TASK (#0)");
    expect(summary).toContain("* codemode intent: round one write (#1)");
    expect(summary).toContain("ROUND_TWO_TASK (#4)");
    expect(summary).toContain("* codemode intent: round two write (#5)");
  });

  test("T17: system and custom entries render no fake refs", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      entry("s1", { role: "system", content: "SYSTEM_MARKER" } as any),
      { id: "custom1", type: "custom_message", customType: "ext.note", content: "CUSTOM_MARKER", display: false },
      ...codemodeTurn("cm", "read auth", "src/auth.ts"),
    ]);
    const history = historyFor(entries);
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain("Task (#0)");
    expect(summary).toContain("* codemode intent: read auth (#2)");
    expect(summary).not.toContain("SYSTEM_MARKER");
    expect(summary).not.toContain("CUSTOM_MARKER");
  });

  test("T17: without a global index the new path emits no refs at all", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "read auth", "src/auth.ts")]);
    const history = buildBriefHistory({ branchEntries: entries });
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).not.toContain("(#");
  });

  test("T24: compact all keeps the whole history with no assumed tail", () => {
    const entries = chain([
      entry("u1", userMsg("OLD_TASK")),
      ...codemodeTurn("c1", "old write", "src/old.ts"),
      entry("a1", assistantText("OLD_DONE")),
      entry("u2", userMsg("NEW_TASK")),
      ...codemodeTurn("c2", "new write", "src/new.ts"),
      entry("a2", assistantText("NEW_DONE")),
    ]);
    const history = historyFor(entries);
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).toContain("OLD_DONE (#3)");
    expect(summary).toContain("NEW_DONE (#7)");
    expect(summary).toContain("intent: old write");
    expect(summary).toContain("intent: new write");
  });

  test("the reading note appears exactly once and the legacy note is gone", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    const previousSummary = `[Session Goal]\n- Task\n\n---\n\n[user]\nTask\n\n---\n\n${wrapLongLines(RECALL_NOTE)}`;
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary.split("Historical navigation, not current state").length).toBe(2);
    expect(summary).not.toContain("Do not redo work already");
  });

  test("total chars never exceed the whole-brief budget, even with trimmed headers", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    const budget = budgetFor(history);
    const longGoals = Array.from({ length: 8 }, (_, i) =>
      `- keep the billing pipeline retry semantics identical for invoices batch ${i} and the legacy cron scheduler path`
    ).join("\n");
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary: `[Session Goal]\n${longGoals}`,
      briefHistory: history,
      briefBudgetChars: budget,
    });
    expect(summary.length).toBeLessThanOrEqual(budget);
    // The header is capped at 20% of the remaining budget and says what it dropped.
    expect(summary).toContain("header line");
    expect(summary).toContain("intent: work");
  });

  test("a budget that cannot fit a single candidate returns an explicit empty result", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    expect(compileRanked({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: 10,
    })).toBe("");
  });

  test("old-path compiles strip both HISTORICAL_NOTE variants instead of stacking them", () => {
    for (const note of [HISTORICAL_NOTE, LEGACY_HISTORICAL_NOTE]) {
      const previousSummary = [
        "[Session Goal]\n- Task",
        "---",
        "[user]\nTask",
        "---",
        wrapLongLines(note),
      ].join("\n\n");
      const summary = compile({
        messages: [userMsg("next"), assistantText("ok")],
        previousSummary,
      });
      expect(summary).not.toContain("Historical navigation");
      expect(summary.split("Do not redo work already").length).toBe(2);
    }
  });
});

// ── hook: repeated compactions ────────────────────────────────────────────

describe("hook: repeated compactions rebuild from raw history", () => {
  let dir: string;
  let previousConfig: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-vcc-history-"));
    previousConfig = process.env.PI_VCC_CONFIG_PATH;
    process.env.PI_VCC_CONFIG_PATH = join(dir, "config.json");
    writeFileSync(process.env.PI_VCC_CONFIG_PATH, JSON.stringify({ overrideDefaultCompaction: false }));
  });

  afterAll(() => {
    if (previousConfig === undefined) delete process.env.PI_VCC_CONFIG_PATH;
    else process.env.PI_VCC_CONFIG_PATH = previousConfig;
    rmSync(dir, { recursive: true, force: true });
  });

  const runHook = (branchEntries: any[], previousSummary?: string) => {
    let handler: any;
    registerBeforeCompactHook({ on(name: string, fn: any) {
      if (name === "session_before_compact") handler = fn;
    } } as any);
    return handler({
      type: "session_before_compact",
      branchEntries,
      customInstructions: `${PI_VCC_COMPACT_INSTRUCTION} keep:0`,
      reason: "manual",
      willRetry: false,
      preparation: { tokensBefore: 1000, fileOps: { read: [], written: [], edited: [] }, previousSummary },
      signal: new AbortController().signal,
    }, { sessionManager: { getEntries: () => branchEntries }, ui: { notify() {} } }).compaction;
  };

  test("three rounds keep round one's task and intent at their original #N", () => {
    const entries: any[] = [];
    let parentId: string | undefined;
    const push = (id: string, message: unknown) => {
      entries.push({ id, type: "message", message, parentId });
      parentId = id;
    };
    push("u1", userMsg("ROUND_ONE_TASK"));
    push("c1-call", codemodeCall(codemodeScript("round one write", "await tools.write({ path: 'src/one.ts', content: 'x' });")));
    push("c1-result", codemodeResult({ calls: [nestedCall({ name: "write", arguments: { path: "src/one.ts" } })] }));
    push("a1", assistantText("Round one done."));

    let previousSummary: string | undefined;
    const summaries: string[] = [];
    for (let round = 1; round <= 3; round++) {
      const result = runHook(entries, previousSummary);
      summaries.push(result.summary);
      const compId = `comp${round}`;
      entries.push({ id: compId, type: "compaction", summary: result.summary, firstKeptEntryId: result.firstKeptEntryId, parentId });
      parentId = compId;
      push(`u${round + 1}`, userMsg(`ROUND_${round + 1}_TASK`));
      push(`c${round + 1}-call`, codemodeCall(codemodeScript(
        `round ${round + 1} write`,
        `await tools.write({ path: 'src/r${round + 1}.ts', content: 'x' });`,
      )));
      push(`c${round + 1}-result`, codemodeResult({ calls: [nestedCall({ name: "write", arguments: { path: `src/r${round + 1}.ts` } })] }));
      push(`a${round + 1}`, assistantText(`Round ${round + 1} done.`));
      previousSummary = result.summary;
    }

    for (const summary of summaries) {
      expect(summary).toContain("ROUND_ONE_TASK (#0)");
      expect(summary).toContain("intent: round one write (#1)");
      // Rebuilt, not re-merged: each round holds exactly one copy.
      expect(summary.split("ROUND_ONE_TASK (#0)")).toHaveLength(2);
      expect(summary).toContain(WRAPPED_HISTORICAL_NOTE);
    }
    expect(summaries[2]).toContain("ROUND_3_TASK");
  });
});

// ── allocator: wrapped-cost accounting ───────────────────────────────────

describe("new-path budget accounting", () => {
  test("long lines are costed after wrapping; the floor budget still yields an ok brief", () => {
    const entries: any[] = [];
    let parentId: string | undefined;
    const push = (id: string, message: unknown) => {
      entries.push({ id, type: "message", message, parentId });
      parentId = id;
    };
    for (let i = 0; i < 40; i++) {
      push(`u${i}`, userMsg(`user ${i} ${"x".repeat(150)}`));
      push(`c${i}`, codemodeCall(codemodeScript(
        `step ${i}`,
        `await tools.bash({ command: "echo ${i}" });`,
      )));
      push(`r${i}`, codemodeResult({ calls: [nestedCall({ name: "bash", arguments: { command: `echo ${i}` } })] }));
      push(`a${i}`, assistantText(`assistant ${i} ${"y".repeat(150)}`));
    }
    const history = historyFor(entries);
    const budget = budgetFor(history); // 160 blocks -> 8000 chars at 4 chars/token
    const { summary, detail } = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budget,
    });
    // Pre-wrap cost accounting used to return "budget-too-small" here.
    expect(detail.kind).toBe("ok");
    expect(detail.usedChars + detail.reservedChars).toBeLessThanOrEqual(budget);
    expect(summary.length).toBeLessThanOrEqual(budget);
    expect(summary.split("Historical navigation, not current state")).toHaveLength(2);
  });
});
