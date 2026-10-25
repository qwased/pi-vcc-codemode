import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { isCodemodeMessage } from "../src/codemode/active";
import { buildBriefSections } from "../src/core/brief";
import { normalize } from "../src/core/normalize";
import { renderMessage } from "../src/core/render-entries";
import { searchEntries } from "../src/core/search-entries";
import { assistantText, assistantWithToolCall, toolResult, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const briefOf = (messages: unknown[]): string =>
  buildBriefSections(normalize(messages as any))
    .flatMap((section) => section.lines)
    .join("\n");

describe("upstream golden: sessions without codemode records", () => {
  test("ordinary tool calls and results render exactly as before", () => {
    expect(renderMessage(assistantWithToolCall("Read", { path: "src/a.ts" }) as any, 0))
      .toEqual({ index: 0, role: "assistant", summary: "Read(path=src/a.ts)\n", files: ["src/a.ts"] });
    expect(renderMessage(toolResult("Read", "file contents") as any, 1))
      .toEqual({ index: 1, role: "tool_result", summary: "[Read] file contents" });
  });

  test("a code argument on a non-codemode tool keeps the upstream argument summary", () => {
    expect(renderMessage(assistantWithToolCall("other_tool", { code: "const x = 1;" }) as any, 0))
      .toEqual({ index: 0, role: "assistant", summary: "other_tool(code)\n" });
    expect(briefOf([assistantWithToolCall("other_tool", { code: "const x = 1;" })]))
      .toBe("* other_tool (#0)");
  });

  test("ordinary brief lines are unchanged and result bodies stay omitted", () => {
    expect(briefOf([
      assistantWithToolCall("Read", { path: "src/a.ts" }),
      toolResult("Read", "BODY_MARKER"),
      assistantWithToolCall("bash", { command: "git status" }),
    ])).toBe('* Read "src/a.ts" (#0)\n* bash "git status" (#2)');
  });

  test("search over ordinary messages is unchanged", () => {
    const messages = [
      userMsg("Find AUTH_MARKER"),
      assistantWithToolCall("Read", { path: "src/AUTH_MARKER.ts" }),
      toolResult("Read", "AUTH_MARKER contents"),
    ];
    const entries = messages.map((message, index) => renderMessage(message, index, true));
    expect(searchEntries(entries, messages as Message[], "AUTH_MARKER").map((hit) => hit.index).sort())
      .toEqual([0, 1, 2]);
  });

  test("a tool-only message keeps the upstream search text shape", () => {
    const messages = [assistantWithToolCall("Read", { path: "src/NO_TEXT_MARKER.ts" })];
    const entries = messages.map((message, index) => renderMessage(message, index, true));
    const hits = searchEntries(entries, messages as Message[], "NO_TEXT_MARKER");
    expect(hits).toHaveLength(1);
    // Upstream always inserts the text/args separator when arguments exist,
    // even with empty text. Keeping it preserves BM25 document lengths.
    expect(hits[0].snippet).toBe("\nsrc/NO_TEXT_MARKER.ts");
  });
});

describe("mode on: direct tools keep the upstream path", () => {
  test("a direct call next to a codemode call is unchanged", () => {
    const messages = [
      assistantWithToolCall("Read", { path: "src/a.ts" }),
      codemodeCall(codemodeScript("调查日志", "await tools.bash({ command: 'rg err' });")),
    ];

    expect(renderMessage(messages[0] as any, 0))
      .toEqual({ index: 0, role: "assistant", summary: "Read(path=src/a.ts)\n", files: ["src/a.ts"] });

    const brief = briefOf(messages);
    expect(brief).toContain('* Read "src/a.ts"');
    expect(brief).toContain("* codemode -> bash | goal: 调查日志");
  });
});

describe("historical codemode content is read by message content", () => {
  test("scripts and nested records stay readable without an active-tool context", () => {
    // No ExtensionAPI or active-tool list is involved in these calls.
    const call = renderMessage(
      codemodeCall(codemodeScript("排查构建失败", "await tools.bash({ command: 'npm run build' });")) as any,
      0,
    );
    expect(call.summary).toContain("codemode(code=");
    expect(call.summary).toContain("排查构建失败");

    const result = renderMessage(codemodeResult({
      calls: [nestedCall({ name: "bash", arguments: { command: "npm run build" }, status: "error", error: "exit 1" })],
    }) as any, 1, true);
    expect(result.summary).toContain("nested: bash(command=npm run build) error exit 1");

    expect(briefOf([
      codemodeCall(codemodeScript("排查构建失败", "await tools.bash({ command: 'npm run build' });")),
    ])).toContain("* codemode -> bash | goal: 排查构建失败");
  });

  test("nested records are rendered by content, not by the outer tool name", () => {
    const result = {
      role: "toolResult",
      toolCallId: "tc_other",
      toolName: "some_runner",
      content: [{ type: "text", text: "done" }],
      nestedCalls: {
        calls: [nestedCall({ name: "read", arguments: { path: "src/a.ts" } })],
        complete: true,
      },
      isError: false,
      timestamp: 0,
    } as unknown as Message;
    expect(renderMessage(result, 0, true).summary)
      .toContain("nested: read(path=src/a.ts)");
  });
});

describe("isCodemodeMessage", () => {
  test("detects codemode calls and nested results only", () => {
    expect(isCodemodeMessage(codemodeCall("text('ok');") as any)).toBe(true);
    expect(isCodemodeMessage(assistantWithToolCall("read", { path: "a" }) as any)).toBe(false);
    expect(isCodemodeMessage(codemodeResult({ calls: [nestedCall({ name: "read" })] }) as any)).toBe(true);
    expect(isCodemodeMessage(toolResult("read", "x") as any)).toBe(false);
    expect(isCodemodeMessage(assistantText("no calls") as any)).toBe(false);
  });
});
