import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBriefSections } from "../src/core/brief";
import { buildGlobalIndexById, loadGlobalIndexById } from "../src/core/global-indices";
import { normalize } from "../src/core/normalize";
import { renderMessage } from "../src/core/render-entries";
import { summarizeToolArgs } from "../src/core/tool-args";
import { assistantText, userMsg } from "./fixtures";
import {
  codemodeCall,
  codemodeResult,
  codemodeScript,
  codemodeStore,
  longCodemodeCode,
  nestedCall,
} from "./codemode-fixtures";

// These tests pin the pre-P1 baseline: codemode scripts and nested calls are
// present in the session but invisible to recall and the compact brief. P1 will
// change these expectations; keeping them explicit makes that change reviewable.
describe("codemode fixtures: baseline before P1", () => {
  test("@options and Chinese target comments sit on executable lines", () => {
    const code = codemodeScript("验证长脚本可按页取回", "const r = await tools.bash({ command: \"echo ok\" });");
    const lines = code.split("\n");
    expect(lines[0]).toBe('// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}');
    expect(lines[1]).toBe("// 目标：验证长脚本可按页取回");

    const withoutOptions = codemodeScript("无 options 的目标", "text('ok');", false);
    expect(withoutOptions.split("\n")[0]).toBe("// 目标：无 options 的目标");
  });

  test("upstream rendering hides long script bodies and nested records", () => {
    const code = longCodemodeCode("长脚本", "TAIL_MARKER_42");
    const call = codemodeCall(code);
    const result = codemodeResult({
      text: "Script completed\nwrote file",
      calls: [nestedCall({ name: "write", arguments: { path: "src/a.ts" } })],
    });

    expect(summarizeToolArgs({ code })).toBe("code");
    const list = renderMessage(call as any, 0, false);
    const full = renderMessage(call as any, 0, true);
    expect(list.summary).not.toContain("TAIL_MARKER_42");
    expect(full.summary).not.toContain("TAIL_MARKER_42");

    const resultEntry = renderMessage(result as any, 1, true);
    expect(resultEntry.summary).toContain("[codemode]");
    expect(resultEntry.summary).not.toContain("nested:");
    expect(resultEntry.summary).not.toContain("src/a.ts");
  });

  test("40 nested calls are preserved by the fixture but not rendered upstream", () => {
    const calls = Array.from({ length: 40 }, (_, i) =>
      nestedCall({
        name: i % 2 === 0 ? "read" : "write",
        arguments: { path: `src/file-${i}.ts` },
      }),
    );
    const result = codemodeResult({ calls, complete: true });
    expect((result as any).nestedCalls.calls).toHaveLength(40);

    const entry = renderMessage(result as any, 2, true);
    expect(entry.summary).not.toContain("nested:");
    expect(entry.summary).not.toContain("file-39.ts");
  });

  test("a failed script keeps its successful side effect in the fixture", () => {
    const result = codemodeResult({
      text: "Script failed\nError: boom",
      isError: true,
      calls: [
        nestedCall({ name: "write", arguments: { path: "src/written.ts" }, status: "ok" }),
        nestedCall({ name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" }),
      ],
    });
    const calls = (result as any).nestedCalls.calls;
    expect(calls[0]).toMatchObject({ name: "write", status: "ok" });
    expect(calls[1]).toMatchObject({ name: "bash", status: "error" });

    const entry = renderMessage(result as any, 3, true);
    expect(entry.summary).toContain("Script failed");
    expect(entry.summary).not.toContain("src/written.ts");
  });

  test("the compact brief still omits codemode result bodies and nested records", () => {
    const messages = [
      assistantText("work"),
      codemodeCall(codemodeScript("简报目标", "await tools.read({ path: 'src/a.ts' });")),
      codemodeResult({
        text: "Script completed\nRESULT_BODY_MARKER",
        calls: [nestedCall({ name: "read", arguments: { path: "src/a.ts" } })],
      }),
    ];
    const brief = buildBriefSections(normalize(messages as any))
      .flatMap((section) => section.lines)
      .join("\n");
    expect(brief).toContain("* codemode");
    expect(brief).not.toContain("RESULT_BODY_MARKER");
    expect(brief).not.toContain("src/a.ts");
  });

  test("codemode-store entries do not occupy #N (array and streaming paths)", () => {
    const entries = [
      { id: "m1", type: "message", message: userMsg("task") },
      {
        id: "s1",
        type: "custom",
        customType: "codemode-store",
        data: codemodeStore({ "pi-vcc.current-task": { version: 1, goal: "g" } }),
      },
      { id: "m2", type: "message", message: assistantText("done") },
    ];

    const map = buildGlobalIndexById(entries);
    expect(map.get("m1")).toBe(0);
    expect(map.get("m2")).toBe(1);
    expect(map.has("s1")).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "pi-vcc-codemode-"));
    try {
      const file = join(dir, "session.jsonl");
      writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
      const streamed = loadGlobalIndexById(file);
      expect(streamed).toBeDefined();
      expect(streamed!.get("m1")).toBe(0);
      expect(streamed!.get("m2")).toBe(1);
      expect(streamed!.has("s1")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
