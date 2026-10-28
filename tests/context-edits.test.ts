import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as piCore from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyTailBudget, buildOwnCut, registerBeforeCompactHook } from "../src/hooks/before-compact";
import { compile } from "../src/core/summarize";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { HISTORICAL_NOTE, LIMITED_HISTORY_NOTE, wrapLongLines } from "../src/core/format";
import { assistantText, userMsg } from "./fixtures";
import {
  codemodeCall,
  codemodeResult,
  codemodeScript,
  codemodeStore,
  nestedCall,
} from "./codemode-fixtures";

// Context edits/projection are host features; older supported Pi versions still
// exercise the unchanged legacy collector in the rest of the suite.
describe.skipIf(typeof (piCore as any).buildSessionProjection !== "function")("context-edited compaction", () => {
  let dir: string;
  let previousConfig: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-vcc-edits-"));
    previousConfig = process.env.PI_VCC_CONFIG_PATH;
    process.env.PI_VCC_CONFIG_PATH = join(dir, "config.json");
    writeFileSync(process.env.PI_VCC_CONFIG_PATH, JSON.stringify({ overrideDefaultCompaction: true }));
  });

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.PI_VCC_CONFIG_PATH;
    else process.env.PI_VCC_CONFIG_PATH = previousConfig;
    rmSync(dir, { recursive: true, force: true });
  });

  const assistant = (text: string) => ({
    role: "assistant", content: [{ type: "text", text }], timestamp: 0,
    api: "openai-completions", provider: "test", model: "test", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  } as any);

  function compact(session: any, keep = 0, reason = "manual", previousSummary?: string) {
    let handler: any;
    registerBeforeCompactHook({ on(name: string, fn: any) {
      if (name === "session_before_compact") handler = fn;
    } } as any);
    const entries = session.getBranch();
    return handler({
      type: "session_before_compact", branchEntries: entries,
      customInstructions: `__pi_vcc__ keep:${keep}`, reason, willRetry: reason === "overflow",
      preparation: { tokensBefore: 1000, fileOps: { read: [], written: [], edited: [] },
        previousSummary: previousSummary ?? entries.filter((e: any) => e.type === "compaction").at(-1)?.summary },
      signal: new AbortController().signal,
    }, { sessionManager: session, ui: { notify() {} } })?.compaction;
  }

  test("an omitted recovery response never re-enters the compaction summary", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Investigate authentication" }], timestamp: 0 });
    const failed = session.appendMessage(assistant("OMITTED_RECOVERY_RESPONSE"));
    session.appendContextEdit(failed, null);
    session.appendMessage(assistant("Verified the current configuration."));
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Continue the real task" }], timestamp: 0 });
    const result = compact(session, 0, "overflow");
    expect(result).toBeDefined();
    expect(result.summary).not.toContain("OMITTED_RECOVERY_RESPONSE");
    expect(result.summary).toContain("Verified the current configuration.");
  });

  test("the latest replacement is summarized with the original recall index", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Inspect authentication" }], timestamp: 0 });
    const response = session.appendMessage(assistant("ORIGINAL_RESPONSE"));
    session.appendContextEdit(response, { content: "SUPERSEDED_REPLACEMENT" });
    session.appendContextEdit(response, { content: "Current replacement response." });
    session.appendMessage(assistant("Verified the configuration."));
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Continue the real task" }], timestamp: 0 });
    const result = compact(session);
    expect(result.summary).not.toContain("ORIGINAL_RESPONSE");
    expect(result.summary).not.toContain("SUPERSEDED_REPLACEMENT");
    expect(result.summary).toContain("Current replacement response. (#1)");
  });

  test("omitted user anchors and custom content do not affect the kept cut", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Original task" }], timestamp: 0 });
    session.appendMessage(assistant("Initial work."));
    const custom = session.appendCustomMessageEntry("guidance", "OMITTED_GUIDANCE", false);
    session.appendContextEdit(custom, null);
    const kept = session.appendMessage({ role: "user", content: [{ type: "text", text: "Actual latest task" }], timestamp: 0 });
    session.appendMessage(assistant("Kept work."));
    const omitted = session.appendMessage({ role: "user", content: [{ type: "text", text: "OMITTED_USER" }], timestamp: 0 });
    session.appendContextEdit(omitted, null);
    const result = compact(session, 1);
    expect(result.firstKeptEntryId).toBe(kept);
    expect(result.summary).not.toContain("OMITTED_GUIDANCE");
    expect(result.summary).not.toContain("OMITTED_USER");
  });

  test("repeated compact-all excludes edits already outside the projected window", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "First task" }], timestamp: 0 });
    const omitted = session.appendMessage(assistant("OLD_OMITTED_RESPONSE"));
    session.appendContextEdit(omitted, null);
    session.appendMessage(assistant("First retained fact."));
    session.appendMessage(assistant("Second retained fact."));
    const first = compact(session);
    session.appendCompaction(first.summary, first.firstKeptEntryId, first.tokensBefore, first.details, true);
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Next task" }], timestamp: 0 });
    session.appendMessage(assistant("New retained fact."));
    session.appendMessage(assistant("Final retained fact."));
    const second = compact(session);
    expect(second.summary).not.toContain("OLD_OMITTED_RESPONSE");
    expect(second.summary).toContain("First retained fact.");
    expect(second.summary).toContain("New retained fact.");
  });

  test("codemode-store entries stay out of #N and a context-edited replay rebuilds history without old headers", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    const user = (text: string) => ({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: 0,
    } as any);
    const codemodeTurn = (code: string, id: string) => ({
      ...assistant(""),
      content: [{ type: "toolCall", id, name: "codemode", arguments: { code } }],
    } as any);

    session.appendMessage(user("Investigate authentication"));
    session.appendMessage(codemodeTurn(
      codemodeScript("验证 store 回放", "await tools.write({ path: 'src/a.ts', content: 'x' });"),
      "call_1",
    ));
    session.appendMessage(codemodeResult({
      toolCallId: "call_1",
      text: "Script completed\nwrote src/a.ts",
      calls: [nestedCall({ id: "call_1/1", name: "write", arguments: { path: "src/a.ts" }, status: "ok" })],
    }) as any);
    session.appendCustomEntry("codemode-store", codemodeStore({
      "pi-vcc.current-task": { version: 1, goal: "验证 store 回放", next: "continue" },
    }));
    session.appendMessage(assistant("First retained fact."));

    const first = compact(session);
    expect(first).toBeDefined();
    const firstCompactionId = session.appendCompaction(
      first.summary,
      first.firstKeptEntryId,
      first.tokensBefore,
      first.details,
      true,
    );

    session.appendMessage(user("Next task"));
    session.appendMessage(codemodeTurn(
      codemodeScript("失败脚本", "await tools.bash({ command: 'false' });", false),
      "call_2",
    ));
    session.appendMessage(codemodeResult({
      toolCallId: "call_2",
      text: "Script failed\nError: boom",
      isError: true,
      calls: [
        nestedCall({ id: "call_2/1", name: "write", arguments: { path: "src/side-effect.ts" }, status: "ok" }),
        nestedCall({ id: "call_2/2", name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" }),
      ],
    }) as any);
    session.appendCustomEntry("codemode-store", codemodeStore({}, ["pi-vcc.current-task"]));
    const omitted = session.appendMessage(assistant("OMITTED_CODEMODE_REPLAY"));
    session.appendContextEdit(omitted, null);
    session.appendMessage(user("Continue"));
    session.appendMessage(assistant("Second retained fact."));

    const second = compact(session, 1);
    expect(second).toBeDefined();
    // Edits make the old header inheritance unsafe; the raw history is the
    // only rebuilt source (§8.1), so the previous summary is not reused.
    expect(second.details.previousSummaryUsed).toBe(false);
    expect(second.details.briefHistoryMessageCount).toBeGreaterThan(0);
    expect(second.details.sourceMessageCount).toBeGreaterThan(0);
    expect(second.firstKeptEntryId).toBeTruthy();
    expect(second.summary).toContain("First retained fact.");
    expect(second.summary).not.toContain("OMITTED_CODEMODE_REPLAY");
    expect(second.summary).not.toContain("Script failed");
    // The failed script's write ran before the failure and is inside this
    // summary's window; nested file operations are summarized by design.
    expect(second.summary).toContain("src/side-effect.ts");
    expect(second.summary).not.toContain("pi-vcc.current-task");

    const entries = session.getBranch();
    const indexMap = buildGlobalIndexById(entries);
    const messageEntries = entries.filter((entry: any) => entry.type === "message" && entry.message);
    const storeEntries = entries.filter((entry: any) => entry.type === "custom" && entry.customType === "codemode-store");
    expect(storeEntries).toHaveLength(2);
    for (const store of storeEntries) expect(indexMap.has(store.id)).toBe(false);
    expect(indexMap.has(firstCompactionId)).toBe(false);
    expect(indexMap.has(second.firstKeptEntryId)).toBe(true);
    expect(indexMap.get(messageEntries.at(-1)!.id)).toBe(messageEntries.length - 1);

    const refs = [...second.summary.matchAll(/\(#(\d+)\)/g)].map((match) => Number(match[1]));
    const indexed = new Set(indexMap.values());
    for (const ref of refs) expect(indexed.has(ref)).toBe(true);
  });

  test("a context-edited nested result does not resurrect its file operation", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "First task" }], timestamp: 0 });
    session.appendMessage({
      ...assistant(""),
      content: [{
        type: "toolCall",
        id: "call_omitted",
        name: "codemode",
        arguments: { code: codemodeScript("omitted side effect", "await tools.write({ path: 'src/omitted-side-effect.ts', content: 'x' });") },
      }],
    } as any);
    const omittedResult = session.appendMessage(codemodeResult({
      toolCallId: "call_omitted",
      calls: [nestedCall({
        id: "call_omitted/1",
        name: "write",
        arguments: { path: "src/omitted-side-effect.ts", content: "x" },
        status: "ok",
      })],
    }) as any);
    session.appendContextEdit(omittedResult, null);
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Next task" }], timestamp: 0 });
    session.appendMessage(assistant("Kept fact."));

    const result = compact(session, 1);
    expect(result).toBeDefined();
    expect(result.summary).toContain("First task");
    expect(result.summary).not.toContain("omitted-side-effect.ts");
  });

  test("budget cuts use replacement sizes and never start at a tool result", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Original task" }], timestamp: 0 });
    session.appendMessage(assistant("Original work."));
    session.appendMessage({ role: "user", content: [{ type: "text", text: "Recent task" }], timestamp: 0 });
    const replaced = session.appendMessage(assistant("x".repeat(1000)));
    session.appendContextEdit(replaced, { content: "small replacement" });
    session.appendMessage({ role: "toolResult", content: [{ type: "text", text: "r".repeat(500) }], toolCallId: "tool", toolName: "read", isError: false, timestamp: 0 });
    const safeBoundary = session.appendMessage(assistant("Latest safe boundary."));
    const entries = session.getBranch();
    const cut = buildOwnCut(entries, 1);
    expect(cut.ok).toBe(true);
    const result = applyTailBudget(entries, cut, { maxTokens: 50, oversizedFactor: 1, charsPerToken: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.firstKeptEntryId).toBe(safeBoundary);
    expect(JSON.stringify(result.messages)).toContain("small replacement");
    expect(JSON.stringify(result.messages)).not.toContain("x".repeat(1000));
  });

  // ── new codemode brief over edited history (S4) ──────────────────────────

  test("T15: a replacement enters the rebuilt brief with the saved original #N", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage(userMsg("Inspect authentication"));
    const response = session.appendMessage(assistant("ORIGINAL_RESPONSE"));
    session.appendMessage(codemodeCall(codemodeScript("read auth", "await tools.read({ path: 'src/auth.ts' });")) as any);
    session.appendMessage(codemodeResult({ calls: [nestedCall({ name: "read", arguments: { path: "src/auth.ts" } })] }) as any);
    session.appendContextEdit(response, { content: "Current replacement response." });
    session.appendMessage(userMsg("Continue the real task"));
    session.appendMessage(assistantText("Kept fact."));

    const result = compact(session, 1);
    expect(result.summary).toContain("Current replacement response. (#1)");
    expect(result.summary).not.toContain("ORIGINAL_RESPONSE");
    expect(result.summary).toContain(wrapLongLines(HISTORICAL_NOTE));
    expect(result.details.previousSummaryUsed).toBe(false);
  });

  test("T16: an edited checkpoint limits history and says so", () => {
    // The in-memory API refuses to edit a compaction entry, so the branch is a
    // synthetic path: a context_edit targeting a checkpoint is still a shape a
    // saved session can hold, and the new brief must degrade conservatively.
    let parentId: string | undefined;
    const link = (items: any[]) =>
      items.map((item) => {
        const out = { ...item, parentId };
        parentId = item.id;
        return out;
      });
    const branch = link([
      { id: "u1", type: "message", message: userMsg("BEFORE_CHECKPOINT_TASK") },
      { id: "a1", type: "message", message: assistant("Before checkpoint work.") },
      {
        id: "comp",
        type: "compaction",
        summary: "[Session Goal]\n- BEFORE_CHECKPOINT_TASK",
        firstKeptEntryId: "",
        tokensBefore: 1000,
      },
      { id: "u2", type: "message", message: userMsg("AFTER_CHECKPOINT_TASK") },
      { id: "c2", type: "message", message: codemodeCall(codemodeScript("after write", "await tools.write({ path: 'src/after.ts', content: 'x' });")) },
      { id: "r2", type: "message", message: codemodeResult({ calls: [nestedCall({ name: "write", arguments: { path: "src/after.ts" } })] }) },
      { id: "a2", type: "message", message: assistant("After checkpoint work.") },
      { id: "e1", type: "context_edit", targetId: "comp", replacement: null },
    ]);

    let handler: any;
    registerBeforeCompactHook({ on(name: string, fn: any) {
      if (name === "session_before_compact") handler = fn;
    } } as any);
    const result = handler({
      type: "session_before_compact",
      branchEntries: branch,
      customInstructions: "__pi_vcc__ keep:0",
      reason: "manual",
      willRetry: false,
      preparation: {
        tokensBefore: 1000,
        fileOps: { read: [], written: [], edited: [] },
        previousSummary: "[Session Goal]\n- BEFORE_CHECKPOINT_TASK",
      },
      signal: new AbortController().signal,
    }, { sessionManager: { getEntries: () => branch }, ui: { notify() {} } })?.compaction;

    expect(result.details.briefHistoryLimited).toBe("edited-checkpoint");
    expect(result.details.previousSummaryUsed).toBe(false);
    expect(result.details.briefHistoryMessageCount).toBe(4);
    expect(result.summary).toContain(wrapLongLines(`${HISTORICAL_NOTE}\n${LIMITED_HISTORY_NOTE}`));
    expect(result.summary).toContain("AFTER_CHECKPOINT_TASK (#2)");
    expect(result.summary).toContain("goal: after write (#3)");
    expect(result.summary).not.toContain("BEFORE_CHECKPOINT_TASK");
    // Files come from the effective history, never from the edited prefix.
    expect(result.summary).toContain("src/after.ts");
    expect(result.summary).not.toContain("Before checkpoint work.");

    // T22: reusing this limited summary on the old path must not keep the note.
    const reused = compile({
      messages: [userMsg("plain next"), assistantText("plain answer")],
      previousSummary: result.summary,
    });
    expect(reused).not.toContain("history limited by edited checkpoint");
    expect(reused.split("Historical navigation, not current state")).toHaveLength(1);
  });

  test("T26: codemode removed by edits never falls back to the old merge", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage(userMsg("Investigate authentication"));
    const call = session.appendMessage(codemodeCall(codemodeScript("read auth", "await tools.read({ path: 'src/auth.ts' });")) as any);
    const resultEntry = session.appendMessage(codemodeResult({ calls: [nestedCall({ name: "read", arguments: { path: "src/auth.ts" } })] }) as any);
    session.appendMessage(assistant("Auth read."));
    session.appendMessage(userMsg("Latest task"));
    session.appendMessage(assistant("Latest answer."));
    session.appendContextEdit(call, null);
    session.appendContextEdit(resultEntry, null);

    const previousSummary = [
      "[Files And Changes]",
      "- Modified: src/auth.ts",
      "",
      "---",
      "",
      "[user]",
      "OLD_BRIEF_MARKER",
    ].join("\n");
    const result = compact(session, 1, "manual", previousSummary);
    expect(result.summary).toContain(wrapLongLines(HISTORICAL_NOTE));
    expect(result.summary).toContain("Investigate authentication (#0)");
    expect(result.summary).toContain("Auth read. (#3)");
    expect(result.summary).not.toContain("OLD_BRIEF_MARKER");
    expect(result.summary).not.toContain("src/auth.ts");
    expect(result.summary).not.toMatch(/^\* codemode/m);
    expect(result.details.previousSummaryUsed).toBe(false);
  });

  test("T24: no user anchor compacts all and rebuilds the whole history", () => {
    const session = piCore.SessionManager.inMemory(dir) as any;
    session.appendMessage(assistant("FIRST_ASSISTANT_FACT"));
    session.appendMessage(codemodeCall(codemodeScript("inspect", "await tools.read({ path: 'src/a.ts' });")) as any);
    session.appendMessage(codemodeResult({ calls: [nestedCall({ name: "read", arguments: { path: "src/a.ts" } })] }) as any);
    session.appendMessage(assistant("LATEST_ASSISTANT_FACT"));

    const result = compact(session);
    expect(result.firstKeptEntryId).toBe("");
    expect(result.summary).toContain("FIRST_ASSISTANT_FACT (#0)");
    expect(result.summary).toContain("LATEST_ASSISTANT_FACT (#3)");
    expect(result.summary).toContain("goal: inspect");
  });
});
