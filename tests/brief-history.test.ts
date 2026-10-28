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
import { HEADER_NAMES, HISTORICAL_NOTE, LEGACY_HISTORICAL_NOTE, LIMITED_HISTORY_NOTE, RECALL_NOTE, wrapLongLines } from "../src/core/format";
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
    expect(summary).toContain("* codemode goal: read auth module (#1)");
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
    expect(summary).toContain("* codemode goal: new work (#5)");
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
    expect(plain).toContain("goal: write module");
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
    expect(summary).toContain("* codemode goal: round one write (#1)");
    expect(summary).toContain("ROUND_TWO_TASK (#4)");
    expect(summary).toContain("* codemode goal: round two write (#5)");
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
    expect(summary).toContain("* codemode goal: read auth (#2)");
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
    expect(summary).toContain("goal: old write");
    expect(summary).toContain("goal: new write");
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
    expect(summary).toContain("goal: work");
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

// ── details.headerNames: the rendered header titles only (P3) ────────────

describe("compileRankedWithDetail: headerNames (P3)", () => {
  /** Six known sections in a previous summary; fresh has its own session goal. */
  const previousAllSections = [
    "[Session Goal]",
    "- migrate billing",
    "- keep retry semantics",
    "[Files And Changes]",
    "- Modified: src/billing.ts",
    "[Commits]",
    "- abc1234 fix billing retry",
    "[Tracked Commands]",
    "- ssh: ssh prod-server",
    "[Outstanding Context]",
    "- legacy scheduler fails on retries",
    "[User Preferences]",
    "- prefers terse answers",
  ].join("\n");

  const tinyHistory = () => historyFor(chain([
    entry("u1", userMsg("x")),
    entry("c1", codemodeCall(codemodeScript("y", "await tools.bash({ command: 'true' });"))),
    entry("r1", codemodeResult({ calls: [nestedCall({ name: "bash", arguments: { command: "true" } })] })),
    entry("a1", assistantText("z")),
  ]));

  test("T09: only actual header titles are reported, never body tags", () => {
    const entries = chain([
      entry("u1", userMsg("Investigate authentication")),
      ...codemodeTurn("cm", "write auth module", "src/auth.ts"),
      entry("a1", assistantText("Auth written.")),
      entry("u2", userMsg("[Commits]\n- body line that looks like a section")),
    ]);
    const history = historyFor(entries);
    // The live window is what production summarizes; its blocks feed the
    // fresh header. The body is rebuilt from the effective history.
    const { summary, detail } = compileRankedWithDetail({
      messages: entries.map((e) => e.message),
      sourceIndices: [0, 1, 2, 3, 4],
      // The hook passes the nested file operations; they fill [Files And Changes].
      fileOps: { readFiles: [], modifiedFiles: ["src/auth.ts"] },
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    // Session Goal from the user text, Files And Changes from the nested write.
    expect(detail.headerNames).toEqual(["Session Goal", "Files And Changes"]);
    // The body's column-0 [Commits] line is text, not a section.
    expect(summary).toContain("[Commits]");
    expect(detail.headerNames).not.toContain("Commits");
    expect(detail.headerNames).not.toContain("user");
    expect(detail.headerNames).not.toContain("assistant");
    for (const name of detail.headerNames) expect(HEADER_NAMES).toContain(name as any);
  });

  test("T10: a trimmed header reports the surviving titles, not the pre-trim list", () => {
    const history = tinyHistory();
    const at = (budgetChars: number) => compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      previousSummary: previousAllSections,
      briefHistory: history,
      briefBudgetChars: budgetChars,
    });

    // 1,200 chars leaves 20% for the header: three titles fit, the rest are dropped.
    const partial = at(1200);
    expect(partial.detail.headerNames).toEqual(["Session Goal", "Files And Changes", "Commits"]);
    // The audit list (pre-trim) still knows about all five merged sections,
    // and Commits is title-only here: listed, but with no body lines.
    expect(partial.detail.headerSections.map((s) => s.name)).toEqual([
      "Session Goal", "Files And Changes", "Commits", "Tracked Commands", "User Preferences",
    ]);
    // Commits keeps its title but its item was trimmed: the body is gone.
    expect(partial.summary.slice(partial.summary.indexOf("[Commits]"))).toStartWith("[Commits]\n...(");

    // Too small for even the omission marker: nothing is rendered, nothing listed.
    const dropped = at(490);
    expect(dropped.detail.headerChars).toBe(0);
    expect(dropped.detail.headerNames).toEqual([]);
  });

  test("T10: a title clipped mid-string is not reported as a section", () => {
    const history = tinyHistory();
    const previous = [
      "[Session Goal]",
      ...Array.from({ length: 10 }, (_, i) => `- goal item ${i} keeps the legacy cron scheduler path intact`),
    ].join("\n");
    const at = (budgetChars: number) => compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      previousSummary: previous,
      briefHistory: history,
      briefBudgetChars: budgetChars,
    });

    const clipped = at(610);
    expect(clipped.detail.headerChars).toBeGreaterThan(0);
    // "[Session Go…" is not a complete title, so it is not a section name.
    expect(clipped.detail.headerNames).toEqual([]);

    const whole = at(620);
    expect(whole.detail.headerNames).toEqual(["Session Goal"]);
  });

  test("T11: a previous Commits section survives a merge with no fresh commits", () => {
    const { summary, detail } = compileRankedWithDetail({
      messages: [userMsg("next small task")],
      previousSummary: "[Commits]\n- deadbee keep this commit\n\n---\n\n[user]\nold",
    });
    expect(detail.kind).toBe("legacy");
    // The fresh window contributes its own goal; the old commits still merge.
    expect(detail.headerNames).toEqual(["Session Goal", "Commits"]);
    expect(summary).toContain("- deadbee keep this commit");
  });

  test("T12: no previous summary reports the fresh header titles", () => {
    const { summary, detail } = compileRankedWithDetail({
      messages: [userMsg("Fix login bug"), assistantWithToolCall("Read", { path: "auth.ts" })],
    });
    expect(detail.headerNames).toEqual(["Session Goal", "Files And Changes"]);
    expect(summary).toContain("auth.ts");
  });

  test("T12: a brief-only or empty input reports no header titles", () => {
    // A body-only summary: no header section is rendered, so nothing is named.
    const briefOnly = compileRankedWithDetail({ messages: [assistantText("ok")] });
    expect(briefOnly.summary).not.toBe("");
    expect(briefOnly.detail.headerNames).toEqual([]);

    const empty = compileRankedWithDetail({ messages: [] });
    expect(empty.summary).toBe("");
    expect(empty.detail.headerNames).toEqual([]);
  });

  test("T13: a budget that fits nothing returns no summary and no titles", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      ...codemodeTurn("cm", "work", "src/a.ts"),
    ]);
    const history = historyFor(entries);
    const { summary, detail } = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: 10,
    });
    expect(summary).toBe("");
    expect(detail.kind).toBe("budget-too-small");
    expect(detail.headerNames).toEqual([]);
  });
});

describe("F9: section lookup stops at the header region", () => {
  const bodySectionLine = "[Commits]\n- body line pretending to be a section";

  test("T21: a [Commits] line in the previous brief body is not merged as a header", () => {
    const previousSummary = [
      "[Session Goal]",
      "- old goal",
      "",
      "---",
      "",
      "[user]",
      "old brief line",
      "",
      bodySectionLine,
    ].join("\n");
    const { summary, detail } = compileRankedWithDetail({
      messages: [userMsg("next task"), assistantText("ok")],
      previousSummary,
    });
    expect(detail.headerNames).toEqual(["Session Goal"]);
    // The line stays where it was written, and no second copy enters the header.
    expect(summary.match(/\[Commits\]/g)).toHaveLength(1);
    expect(summary).toContain("- body line pretending to be a section");
  });

  test("T21: a [Commits] line inside the fresh brief body is not read as a section", () => {
    const { summary, detail } = compileRankedWithDetail({
      messages: [userMsg(bodySectionLine), assistantText("ok")],
      previousSummary: "[Session Goal]\n- old goal",
    });
    expect(detail.headerNames).toEqual(["Session Goal"]);
    expect(summary.match(/\[Commits\]/g)).toHaveLength(1);
  });

  test("T21: the new path never inherits a body line as a header title", () => {
    const entries = chain([
      entry("u1", userMsg("Investigate the auth flow")),
      ...codemodeTurn("cm", "read auth module", "src/auth.ts"),
      entry("u2", userMsg("Latest task")),
    ]);
    const history = historyFor(entries, "u2");
    const previousSummary = [
      "[Session Goal]",
      "- old goal",
      "",
      "---",
      "",
      "[user]",
      "old brief line",
      "",
      bodySectionLine,
    ].join("\n");
    const { summary, detail } = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      previousSummary,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(detail.headerNames).toEqual(["Session Goal"]);
    expect(summary).not.toContain("[Commits]");
  });
});

describe("T22: the limited-history note is stripped with the other notes", () => {
  const limitedTail = "[Session Goal]\n- Task\n\n---\n\n[user]\nTask\n\n---\n\n" + wrapLongLines(HISTORICAL_NOTE) + "\n" + LIMITED_HISTORY_NOTE;

  test("a new-path compile drops a stored limited note instead of stacking it", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary: limitedTail,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    // This history is not limited, so the suffix must be gone entirely.
    expect(summary).not.toContain("history limited by edited checkpoint");
    expect(summary.split("Historical navigation, not current state")).toHaveLength(2);
  });

  test("the limited note with no historical note is stripped too", () => {
    const entries = chain([entry("u1", userMsg("Task")), ...codemodeTurn("cm", "work", "src/a.ts")]);
    const history = historyFor(entries);
    const previousSummary = "[Session Goal]\n- Task\n\n---\n\n[user]\nTask\n\n---\n\n" + LIMITED_HISTORY_NOTE;
    const summary = compileRanked({
      messages: [],
      sourceIndices: [],
      previousSummary,
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    expect(summary).not.toContain("history limited by edited checkpoint");
  });

  test("an old-path compile does not keep the limited note in the brief", () => {
    const summary = compile({
      messages: [userMsg("next"), assistantText("ok")],
      previousSummary: limitedTail,
    });
    expect(summary).not.toContain("history limited by edited checkpoint");
    expect(summary.split("Use `vcc_recall` to search")).toHaveLength(2);
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
      expect(summary).toContain("goal: round one write (#1)");
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
describe("T14 and the budget release gate", () => {
  test("T14: a missing boundary fails closed without the limited note", () => {
    const entries = chain([
      entry("u1", userMsg("Task")),
      ...codemodeTurn("cm", "work", "src/a.ts"),
    ]);
    const history = historyFor(entries, "ghost");
    expect(history.limitedReason).toBe("missing-history");
    const { summary, detail } = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budgetFor(history),
    });
    // Fail-closed: nothing is rebuilt and no limited note is claimed.
    expect(summary).toBe("");
    expect(detail.limited).toBe(false);
    expect(detail.headerNames).toEqual([]);
  });

  test("a successful non-empty compile fits its budget at 2, 4 and 6 chars per token", () => {
    const entries = chain([
      entry("u0", userMsg("Ship the billing retry fix. I prefer terse answers.")),
      entry("c1", codemodeCall(codemodeScript("write the queue worker", "await tools.write({ path: 'src/queue.ts', content: 'x' });"))),
      entry("r1", codemodeResult({ calls: [nestedCall({ name: "write", arguments: { path: "src/queue.ts" } })] })),
      entry("w1", { role: "assistant", content: [{ type: "text", text: "\n  \t" }] }),
      // No goal: this call must render through the code preview.
      entry("n1", codemodeCall("await tools.read({ path: 'src/queue.ts' });")),
      entry("e1", codemodeCall(codemodeScript("verify the queue worker", "await tools.bash({ command: 'false' });"))),
      entry("e2", codemodeResult({ text: "Script failed", isError: true, calls: [nestedCall({ name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" })] })),
      entry("a1", assistantText("The worker is written; the failure is recorded.")),
    ]);
    const history = historyFor(entries);
    const blocks = normalize(history.messages as any, history.sourceIndices).length;
    for (const charsPerToken of [2, 4, 6]) {
      const budget = Math.round(Math.min(2000, Math.max(1100, 15 * blocks)) * charsPerToken);
      const { summary, detail } = compileRankedWithDetail({
        messages: [],
        sourceIndices: [],
        briefHistory: history,
        briefBudgetChars: budget,
      });
      expect(detail.kind).toBe("ok");
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(budget);
      // The assembled summary charges exactly the body plus the reserved cost.
      expect(detail.usedChars + detail.reservedChars).toBe(summary.length);
      expect(detail.usedChars + detail.reservedChars).toBeLessThanOrEqual(budget);
      // The goal label and the code fallback both survive the budget path.
      expect(summary).toContain("goal: write the queue worker");
      expect(summary).toContain("* codemode code: ");
    }
  });
});
