import { describe, expect, it } from "bun:test";
import { compile, compileRanked } from "../src/core/summarize";
import { allocateBriefBudget, rankBriefBlocks, selectRankedBriefBlocks } from "../src/core/rank";
import { buildBriefCandidates, compileBrief } from "../src/core/brief";
import { buildSections } from "../src/core/build-sections";
import { formatSummary, HISTORICAL_NOTE, wrapLongLines } from "../src/core/format";
import type { NormalizedBlock } from "../src/types";
import { assistantText, assistantWithToolCall, userMsg } from "./fixtures";

const briefPart = (summary: string): string => summary.split("\n\n---\n\n")[1] ?? "";

describe("section-aware brief ranking prototype", () => {
  it("scores structural edit/test events above read-only exploration", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "src/auth.ts" } },
      { kind: "tool_call", name: "Edit", args: { file_path: "src/auth.ts" } },
      { kind: "tool_call", name: "bash", args: { command: "bun test tests/auth.test.ts" } },
    ];

    const ranked = rankBriefBlocks(blocks);
    const read = ranked.find((r) => r.block.kind === "tool_call" && r.block.name === "Read")!;
    const edit = ranked.find((r) => r.block.kind === "tool_call" && r.block.name === "Edit")!;
    const test = ranked.find((r) => r.block.kind === "tool_call" && r.block.name === "bash")!;

    expect(edit.score).toBeGreaterThan(read.score);
    expect(test.score).toBeGreaterThan(read.score);
    expect(edit.reasons).toContain("edit-tool");
    expect(test.reasons).toContain("test-command");
  });

  it("penalizes scaffolding-only bash so it ranks below substantive commands", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "set -euo pipefail\ncd /tmp/proj\nls -la", exitCode: 0 },
      { kind: "bash", command: "set -euo pipefail\ngit commit -m \"fix\"\ngit push", exitCode: 0 },
    ];
    const ranked = rankBriefBlocks(blocks);
    const scaffold = ranked[0];
    const work = ranked[1];
    expect(scaffold.reasons).toContain("trivial-bash");
    expect(work.reasons).not.toContain("trivial-bash");
    expect(work.score).toBeGreaterThan(scaffold.score);
  });

  it("does not penalize a real command hidden after a stray '<<' with no terminator", () => {
    const blocks: NormalizedBlock[] = [
      // `<<NOTE` has no closing `NOTE` line, so it must not be treated as a
      // heredoc opener that swallows the git commit below into a skipped body.
      { kind: "bash", command: "echo \"see <<NOTE for details\"\ngit commit -m fix", exitCode: 0 },
    ];
    const ranked = rankBriefBlocks(blocks);
    expect(ranked[0].reasons).not.toContain("trivial-bash");
  });

  it("does not penalize a scaffolding command that failed (nonzero exit is a real fact)", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "cd /tmp/missing", exitCode: 1 },
    ];
    const ranked = rankBriefBlocks(blocks);
    expect(ranked[0].reasons).not.toContain("trivial-bash");
    expect(ranked[0].reasons).toContain("nonzero-exit");
  });

  it("selects ranked blocks chronologically after scoring", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "Read", args: { file_path: "noise-a.ts" } },
      { kind: "tool_call", name: "Read", args: { file_path: "noise-b.ts" } },
      { kind: "user", text: "Fix auth bug" },
      { kind: "assistant", text: "Root cause is stale token refresh." },
      { kind: "tool_call", name: "Edit", args: { file_path: "src/auth.ts" } },
      { kind: "tool_call", name: "bash", args: { command: "bun test tests/auth.test.ts" } },
    ];

    const selected = selectRankedBriefBlocks(blocks, { maxBlocks: 4, preserveRecentBlocks: 1 });

    expect(selected).toEqual([
      blocks[2],
      blocks[3],
      blocks[4],
      blocks[5],
    ]);
  });

  it("boosts non-trivial assistant turns that close a user segment", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix auth bug" },
      { kind: "assistant", text: "I'll inspect this now." },
      { kind: "tool_call", name: "Read", args: { file_path: "noise-a.ts" } },
      { kind: "tool_call", name: "Edit", args: { file_path: "src/auth.ts" } },
      { kind: "tool_call", name: "bash", args: { command: "bun test tests/auth.test.ts" } },
      {
        kind: "assistant",
        text: "Implemented the auth fix, verified the focused auth test, confirmed the changed file is limited to src/auth.ts, and no follow-up blockers remain for this task.",
      },
      { kind: "user", text: "ok next" },
    ];
    const ranked = rankBriefBlocks(blocks);
    const report = ranked.find((r) => r.block === blocks[5])!;
    const chatter = ranked.find((r) => r.block === blocks[1])!;

    expect(report.reasons).toContain("segment-closing-assistant");
    expect(chatter.reasons).not.toContain("segment-closing-assistant");
    expect(report.score).toBeGreaterThan(chatter.score);
  });

  it("does not spend ranked selection budget on tool results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix auth bug" },
      { kind: "assistant", text: "Root cause is stale token refresh." },
      { kind: "tool_call", name: "Edit", args: { file_path: "src/auth.ts" } },
      { kind: "tool_result", name: "Edit", text: "large hidden tool output".repeat(200) },
      { kind: "tool_result", name: "bash", text: "more hidden output".repeat(200) },
    ];

    const selected = selectRankedBriefBlocks(blocks, { maxBlocks: 4, preserveRecentBlocks: 2 });

    expect(selected).toContain(blocks[0]);
    expect(selected).toContain(blocks[1]);
    expect(selected).toContain(blocks[2]);
    expect(selected).not.toContain(blocks[3]);
    expect(selected).not.toContain(blocks[4]);
  });

  it("deduplicates repeated gh PR polling commands", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Merge PR 123 when green" },
      { kind: "tool_call", name: "bash", args: { command: "gh pr view 123 --json mergeStateStatus" } },
      { kind: "tool_call", name: "bash", args: { command: "gh pr checks 123 --watch" } },
      { kind: "tool_call", name: "bash", args: { command: "gh pr merge 123 --squash --delete-branch" } },
    ];
    const selected = selectRankedBriefBlocks(blocks, { maxBlocks: 3, preserveRecentBlocks: 0 });
    const pollCount = selected.filter((block) =>
      block.kind === "tool_call"
        && /^bash$/i.test(block.name)
        && typeof block.args.command === "string"
        && /gh pr (?:view|checks) 123/.test(block.args.command),
    ).length;

    expect(pollCount).toBeLessThanOrEqual(1);
    expect(selected).toContain(blocks[3]);
  });

  it("compileRanked reduces brief noise while keeping semantic sections from all blocks", () => {
    const exploration = Array.from({ length: 15 }, (_, i) => [
      userMsg(`look around ${i}`),
      assistantWithToolCall("Read", { file_path: `noise${i}.ts` }),
    ]).flat();
    const critical = [
      userMsg("Fix auth bug"),
      assistantText("Root cause is stale token refresh."),
      assistantWithToolCall("Edit", { file_path: "src/auth.ts" }),
      assistantWithToolCall("bash", { command: "bun test tests/auth.test.ts" }),
      assistantText("Fixed auth bug and tests passed."),
    ];

    const baseline = compile({ messages: [...exploration, ...critical] });
    const ranked = compileRanked({
      messages: [...exploration, ...critical],
      ranking: { maxBlocks: 10, preserveRecentBlocks: 4 },
    });

    expect(ranked.length).toBeLessThan(baseline.length);
    expect(ranked).toContain("[Session Goal]");
    expect(ranked).toContain("Fix auth bug");
    expect(ranked).toContain('* Edit "src/auth.ts"');
    expect(ranked).toContain('* bash "bun test tests/auth.test.ts"');
    expect(briefPart(ranked)).not.toContain('Read "noise0.ts"');
  });

  it("keeps fresh ranked brief and gives previous brief the remaining budget", () => {
    const previousBrief = Array.from({ length: 200 }, (_, i) => `[user]\nold context ${i}`).join("\n\n");
    const previousSummary = `[Session Goal]\n- Original goal\n\n---\n\n${previousBrief}`;
    const ranked = compileRanked({
      previousSummary,
      messages: [
        userMsg("Fix fresh ranked bug"),
        assistantText("Fresh ranked root cause should survive merge."),
        assistantWithToolCall("Edit", { file_path: "src/fresh.ts" }),
        assistantWithToolCall("bash", { command: "bun test tests/fresh.test.ts" }),
        assistantText("Fresh ranked fix passed tests."),
      ],
      ranking: { maxBlocks: 5, preserveRecentBlocks: 2 },
    });

    expect(ranked).toContain("Fresh ranked root cause should survive merge.");
    expect(ranked).toContain('* Edit "src/fresh.ts"');
    expect(ranked).toContain('* bash "bun test tests/fresh.test.ts"');
    expect(ranked).toContain("Fresh ranked fix passed tests.");
    expect(ranked).toContain("old context 199");
    expect(ranked).not.toContain("old context 0");
  });

  it("charges preserve-recent blocks against the char budget so large recent runs cannot blow past it", () => {
    // Regression: on very long transcripts the newest blocks alone could exceed
    // maxBriefChars because preserve-recent was added unconditionally. They must
    // now be charged against the budget (iterating newest-first) and skipped once full.
    const blocks: NormalizedBlock[] = Array.from({ length: 8 }, (_, i) => ({
      kind: "assistant" as const,
      text: `recent block ${i} ` + "x".repeat(1200),
    }));
    const maxBriefChars = 3000;

    const selected = selectRankedBriefBlocks(blocks, {
      maxBlocks: 80,
      preserveRecentBlocks: 8, // ask to preserve every block
      maxBriefChars,
    });
    const rendered = compileBrief(selected);

    // Budget is a true ceiling even though all candidates are "recent" blocks.
    expect(rendered.length).toBeLessThanOrEqual(maxBriefChars);
    // Newest block is always kept (recency preserved).
    expect(selected).toContain(blocks[7]);
    // ...but not everything fits, so oldest recent blocks are dropped.
    expect(selected).not.toContain(blocks[0]);
    expect(selected.length).toBeLessThan(blocks.length);
  });

  it("keeps the ranked brief within the char budget even when recent turns are huge", () => {
    const huge = Array.from({ length: 10 }, (_, i) =>
      assistantText(`huge recent turn ${i} ` + "y".repeat(900)),
    );
    const maxBriefChars = 3000;

    const ranked = compileRanked({
      messages: [userMsg("start a big task"), ...huge],
      ranking: { maxBlocks: 80, preserveRecentBlocks: 10, maxBriefChars },
    });
    const brief = briefPart(ranked);

    // Without the fix this brief would be ~9000+ chars; the budget caps it.
    // Small slack covers the "...omitted" marker and line-wrap newlines.
    expect(brief.length).toBeLessThanOrEqual(maxBriefChars + 400);
    expect(brief.length).toBeGreaterThan(0);
  });

  it("scales the char budget with transcript length between floor and ceiling", () => {
    // Size-relative budget: clamp(briefCharsPerBlock * blockCount, floor, ceiling).
    const mkBlocks = (n: number): NormalizedBlock[] =>
      Array.from({ length: n }, (_, i) => ({ kind: "assistant" as const, text: `block ${i} ` + "x".repeat(300) }));
    const opts = { maxBlocks: 500, preserveRecentBlocks: 0, maxBriefChars: 4400, maxBriefCharsCeiling: 8000, briefCharsPerBlock: 60 };

    // Small transcript (10 blocks -> 600 < floor): pinned at the floor.
    const small = compileBrief(selectRankedBriefBlocks(mkBlocks(10), opts));
    expect(small.length).toBeLessThanOrEqual(4400);

    // Mid transcript (100 blocks -> 6000, between floor and ceiling): exceeds the floor.
    const mid = compileBrief(selectRankedBriefBlocks(mkBlocks(100), opts));
    expect(mid.length).toBeGreaterThan(4400);
    expect(mid.length).toBeLessThanOrEqual(6000);

    // Huge transcript (400 blocks -> 24000, clamped): never exceeds the ceiling.
    const huge = compileBrief(selectRankedBriefBlocks(mkBlocks(400), opts));
    expect(huge.length).toBeLessThanOrEqual(8000);
    expect(huge.length).toBeGreaterThan(mid.length);
  });

  it("ignores the size-relative ceiling unless slope and floor are both set", () => {
    // Ceiling alone must not change behavior: falls back to the flat maxBriefChars.
    const blocks: NormalizedBlock[] = Array.from({ length: 200 }, (_, i) => ({
      kind: "assistant" as const,
      text: `block ${i} ` + "x".repeat(300),
    }));
    const flat = compileBrief(selectRankedBriefBlocks(blocks, { maxBlocks: 500, preserveRecentBlocks: 0, maxBriefChars: 4400 }));
    const ceilOnly = compileBrief(
      selectRankedBriefBlocks(blocks, { maxBlocks: 500, preserveRecentBlocks: 0, maxBriefChars: 4400, maxBriefCharsCeiling: 8000 }),
    );
    expect(ceilOnly.length).toBe(flat.length);
    expect(flat.length).toBeLessThanOrEqual(4400);
  });
});

const alloc = (blocks: NormalizedBlock[], maxChars: number, reservedChars = 0) =>
  allocateBriefBudget(buildBriefCandidates(blocks), { maxChars, reservedChars });

describe("new codemode brief allocation", () => {
  it("keeps all short user/assistant text in original order within the budget", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "u1", sourceIndex: 0 },
      { kind: "assistant", text: "a1", sourceIndex: 1 },
      { kind: "user", text: "u2", sourceIndex: 2 },
      { kind: "assistant", text: "a2", sourceIndex: 3 },
    ];
    const selection = alloc(blocks, 2000);
    expect(selection.kind).toBe("ok");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(2000);
    expect(selection.text).toContain("[user]\nu1 (#0)");
    expect(selection.text).toContain("[assistant]\na1 (#1)");
    expect(selection.text).toContain("u2 (#2)");
    expect(selection.text.indexOf("u1 (#0)")).toBeLessThan(selection.text.indexOf("a1 (#1)"));
    expect(selection.text.indexOf("a1 (#1)")).toBeLessThan(selection.text.indexOf("u2 (#2)"));
  });

  it("excerpts a long message with head, omitted count and source", () => {
    const long = `${"x".repeat(500)}TAIL_MARKER`;
    const selection = alloc([{ kind: "user", text: long, sourceIndex: 4 }], 300);
    expect(selection.kind).toBe("ok");
    expect(selection.text).toContain("(#4)");
    expect(selection.text).toMatch(/\[omitted \d+ of 511 chars; recall #4\]/);
    expect(selection.text).toContain("TAIL_MARKER");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(300);
  });

  it("does not use a fixed count limit when the budget is sufficient (T05)", () => {
    const blocks: NormalizedBlock[] = [];
    for (let i = 0; i < 18; i++) {
      blocks.push({ kind: "user", text: `user ${i}`, sourceIndex: i * 5 });
      blocks.push({ kind: "assistant", text: `assistant ${i}`, sourceIndex: i * 5 + 1 });
      for (let j = 0; j < 3; j++) {
        blocks.push({ kind: "tool_call", name: "Read", args: { path: `f-${i}-${j}.ts` }, sourceIndex: i * 5 + 2 + j });
      }
      blocks.push({ kind: "tool_result", name: "Read", text: "body", isError: false, sourceIndex: i * 5 + 4 });
    }
    expect(blocks.length).toBeGreaterThan(81);
    const selection = alloc(blocks, 20000);
    expect(selection.kind).toBe("ok");
    for (let i = 0; i < 18; i++) expect(selection.text).toContain(`user ${i} (#${i * 5})`);
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(20000);
  });

  it("folds the oldest continuous text range when even minimum excerpts do not fit (T06)", () => {
    const blocks: NormalizedBlock[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "user" as const, text: `u${i} ` + "x".repeat(500), sourceIndex: i,
    }));
    const selection = alloc(blocks, 500);
    expect(selection.kind).toBe("ok");
    expect(selection.text).toMatch(/\[\d+ older user messages omitted; scan saved history #\d+..#\d+\]/);
    expect(selection.text).toContain("u9");
    expect(selection.text).not.toContain("u0 ");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(500);
  });

  it("keeps the observed-error activity under a tight tool budget (T12)", () => {
    const blocks: NormalizedBlock[] = [];
    blocks.push({ kind: "tool_call", name: "Read", args: { path: "failed.ts" }, toolCallId: "c0", sourceIndex: 0 });
    blocks.push({ kind: "tool_result", name: "Read", text: "boom", toolCallId: "c0", isError: true, sourceIndex: 1 });
    for (let i = 0; i < 5; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { path: `old-${i}.ts` }, toolCallId: `c${i + 1}`, sourceIndex: 2 + i * 2 });
      blocks.push({ kind: "tool_result", name: "Read", text: "ok", toolCallId: `c${i + 1}`, isError: false, sourceIndex: 3 + i * 2 });
    }
    const selection = alloc(blocks, 160);
    expect(selection.kind).toBe("ok");
    expect(selection.text).toContain("failed.ts");
    expect(selection.text).toContain("{error observed; result #1}");
    expect(selection.counts.toolOmitted).toBeGreaterThan(0);
    expect(selection.text).toContain("tool-call entries omitted");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(160);
  });

  it("preserves the original order of interleaved assistant text and tools (T07)", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "before", sourceIndex: 0 },
      { kind: "tool_call", name: "Read", args: { path: "a.ts" }, toolCallId: "c1", sourceIndex: 0 },
      { kind: "tool_result", name: "Read", text: "ok", toolCallId: "c1", isError: false, sourceIndex: 1 },
      { kind: "assistant", text: "after", sourceIndex: 2 },
    ];
    const selection = alloc(blocks, 2000);
    expect(selection.text).toContain("[assistant]\nbefore (#0)");
    expect(selection.text.indexOf("before (#0)")).toBeLessThan(selection.text.indexOf("* Read \"a.ts\" (#0)"));
    expect(selection.text.indexOf("* Read \"a.ts\" (#0)")).toBeLessThan(selection.text.indexOf("after (#2)"));
  });

  it("counts reserved note/header cost and keeps wrap idempotent (T13)", () => {
    expect(HISTORICAL_NOTE).toBe(
      "Historical navigation, not current state or proof of success. User/assistant text and intent are past statements; " +
      "tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, " +
      "which may differ. Session Goal is a condensed excerpt; recall the original for constraints. " +
      "Use vcc_recall: scan searches saved fields; read pages through long records.",
    );
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "fix the bug", sourceIndex: 0 },
      { kind: "assistant", text: "looking into it", sourceIndex: 1 },
    ];
    const data = buildSections({ blocks, briefText: "" });
    const headerText = formatSummary({ ...data, briefTranscript: "" }).length;
    const reserved = headerText + HISTORICAL_NOTE.length + 16;
    const selection = alloc(blocks, 1200, reserved);
    expect(selection.kind).toBe("ok");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(1200);
    expect(wrapLongLines(selection.text)).toBe(selection.text);

    const final = formatSummary(
      { ...buildSections({ blocks, briefText: selection.text }), briefTranscript: selection.text },
      { capBriefTranscript: false },
    );
    expect(final.split(HISTORICAL_NOTE).length - 1).toBe(0); // note is added by the caller once, not here
    expect(final).toContain("fix the bug");
  });

  it("returns an explicit budget-too-small result instead of a fake empty summary", () => {
    const selection = alloc([{ kind: "user", text: "x".repeat(500), sourceIndex: 0 }], 20);
    expect(selection.kind).toBe("budget-too-small");
    expect(selection.text).toBe("");
  });

  it("does not starve user minima to fund tools", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "important user requirement", sourceIndex: 0 },
      { kind: "user", text: "second requirement", sourceIndex: 1 },
    ];
    for (let i = 0; i < 20; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { path: `f${i}.ts` }, sourceIndex: 2 + i });
    }
    const selection = alloc(blocks, 500);
    expect(selection.kind).toBe("ok");
    expect(selection.text).toContain("important user requirement");
    expect(selection.text).toContain("second requirement");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(500);
  });

  it("keeps 100 short user messages when they fit (no fixed count cap)", () => {
    const blocks: NormalizedBlock[] = Array.from({ length: 100 }, (_, i) => ({
      kind: "user" as const, text: `u${i}`, sourceIndex: i,
    }));
    const selection = alloc(blocks, 3000);
    expect(selection.kind).toBe("ok");
    expect(selection.text).toContain("u0 (#0)");
    expect(selection.text).toContain("u99 (#99)");
    expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(3000);
  });

  it("does not split long unpunctuated Chinese or combining clusters", () => {
    const zh = "这是一个没有标点的很长的中文任务描述".repeat(40);
    const zhSelection = alloc([{ kind: "user", text: zh, sourceIndex: 0 }], 300);
    expect(zhSelection.kind).toBe("ok");
    expect(zhSelection.text).toContain("(#0)");
    expect(zhSelection.text).toMatch(/\[omitted \d+ of \d+ chars; recall #0\]/);

    const combining = "e\u0301".repeat(300);
    const combiningSelection = alloc([{ kind: "user", text: combining, sourceIndex: 1 }], 300);
    expect(combiningSelection.kind).toBe("ok");
    // A combining mark may never begin a line after the excerpt boundary.
    expect(combiningSelection.text).not.toMatch(/(^|\n)\u0301/);
  });
  it("does not stall on narrow sticky budget bands (T05/T06 retry convergence)", () => {
    const blocks: NormalizedBlock[] = [];
    let index = 0;
    blocks.push({ kind: "user", text: "u0", sourceIndex: index++ });
    blocks.push({ kind: "user", text: "u1", sourceIndex: index++ });
    for (let i = 0; i < 6; i++) {
      blocks.push({ kind: "assistant", text: "a".repeat(100), sourceIndex: index++ });
    }
    blocks.push({ kind: "assistant", text: "x".repeat(1200), sourceIndex: index++ });
    for (let i = 0; i < 30; i++) {
      blocks.push({ kind: "tool_call", name: "Read", args: { path: "src/f" + i + ".ts" }, sourceIndex: index++ });
    }
    // These exact budgets returned budget-too-small before the retry estimate
    // accumulated overshoot against the current body budget instead of the total.
    for (const budget of [2050, 2051, 2076, 2077]) {
      const selection = alloc(blocks, budget, 400);
      expect(selection.kind).toBe("ok");
      expect(selection.usedChars + selection.reservedChars).toBeLessThanOrEqual(budget);
    }
  });
});
