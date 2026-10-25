import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBriefSections } from "../src/core/brief";
import { buildGlobalIndexById, loadGlobalIndexById } from "../src/core/global-indices";
import { normalize } from "../src/core/normalize";
import { renderMessage } from "../src/core/render-entries";
import { summarizeToolArgs } from "../src/core/tool-args";
import {
  CODE_FULL_CHARS,
  CODE_PREVIEW_CHARS,
  summarizeCodemodeToolArgs,
} from "../src/codemode/summary";
import { assistantText, userMsg } from "./fixtures";
import {
  codemodeCall,
  codemodeResult,
  codemodeScript,
  codemodeStore,
  longCodemodeCode,
  nestedCall,
} from "./codemode-fixtures";

const briefOf = (messages: unknown[]): string =>
  buildBriefSections(normalize(messages as any))
    .flatMap((section) => section.lines)
    .join("\n");

describe("codemode fixtures", () => {
  test("@options stays first and // goal: sits on the executable line", () => {
    const code = codemodeScript("验证长脚本可按页取回", "text('ok');");
    expect(code.split("\n")[0]).toBe('// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}');
    expect(code.split("\n")[1]).toBe("// goal: 验证长脚本可按页取回");

    const withoutOptions = codemodeScript("无 options 的目标", "text('ok');", false);
    expect(withoutOptions.split("\n")[0]).toBe("// goal: 无 options 的目标");
  });
});

describe("codemode script previews", () => {
  test("list preview is bounded and expand shows more of a medium script", () => {
    const medium = codemodeScript(
      "检查中等脚本",
      `const a = 1;\n${"x".repeat(400)}\ntext("MEDIUM_TAIL");`,
      false,
    );

    const list = summarizeCodemodeToolArgs({ code: medium }, false);
    const full = summarizeCodemodeToolArgs({ code: medium }, true);
    expect(list).toContain("检查中等脚本");
    expect(list).not.toContain("MEDIUM_TAIL");
    expect(full).toContain("MEDIUM_TAIL");
    expect(list.length).toBeLessThan(full.length);
    expect(full.length).toBeLessThanOrEqual(medium.length + "code=".length);
  });

  test("a long script keeps its head in list and expand; the tail stays a known P3 gap", () => {
    const code = longCodemodeCode("验证长脚本可按页取回", "TAIL_MARKER_42");
    const list = summarizeCodemodeToolArgs({ code }, false);
    const full = summarizeCodemodeToolArgs({ code }, true);

    expect(list).toContain("验证长脚本可按页取回");
    expect(list).not.toContain("TAIL_MARKER_42");
    expect(list).toMatch(/\[\d+ lines, \d+ chars total\]$/);
    expect(full).toContain("验证长脚本可按页取回");
    // P1 does not paginate scripts yet; P3 owns reaching the tail.
    expect(full).not.toContain("TAIL_MARKER_42");

    const rendered = renderMessage(codemodeCall(code) as any, 0, false);
    expect(rendered.summary).toContain("codemode(code=");
    expect(rendered.summary).toContain("验证长脚本可按页取回");
    expect(rendered.summary).not.toContain("TAIL_MARKER_42");
  });

  test("the upstream summarizeToolArgs output for a code argument is unchanged", () => {
    // Only the codemode branch reads the body; the shared helper stays upstream.
    expect(summarizeToolArgs({ code: "const x = 1;" })).toBe("code");
  });

  test("preview and full caps are the documented values", () => {
    expect(CODE_PREVIEW_CHARS).toBe(300);
    expect(CODE_FULL_CHARS).toBe(1500);
  });
});

describe("codemode nested records in recall rendering", () => {
  test("list shows the last 12 calls and expand shows the last 32", () => {
    const calls = Array.from({ length: 40 }, (_, i) =>
      nestedCall({
        name: i % 2 === 0 ? "read" : "write",
        arguments: { path: `src/file-${i}.ts` },
      }),
    );
    const result = codemodeResult({ calls, complete: true });
    expect((result as any).nestedCalls.calls).toHaveLength(40);

    const list = renderMessage(result as any, 1, false).summary;
    const listNested = list.split("\n").at(-1)!;
    expect(listNested).toContain("nested x40 (last 12, expand for more):");
    expect(listNested).toContain("file-39.ts");
    expect(listNested).not.toContain("file-0.ts");

    const full = renderMessage(result as any, 1, true).summary;
    const fullNested = full.split("\n").at(-1)!;
    expect(fullNested).toContain("nested x40 (last 32):");
    expect(fullNested).toContain("file-8.ts");
    expect(fullNested).toContain("file-39.ts");
    expect(fullNested).not.toContain("file-0.ts");
  });

  test("status, error, duration and multi-line commands stay on one physical line", () => {
    const result = codemodeResult({
      text: "Script failed\nError: boom",
      isError: true,
      calls: [
        nestedCall({ name: "write", arguments: { path: "src/written.ts" }, status: "ok", durationMs: 12 }),
        nestedCall({
          name: "bash",
          arguments: { command: "echo one\necho two" },
          status: "error",
          error: "exit 1",
          durationMs: 5,
        }),
        nestedCall({ name: "read", arguments: { path: "src/pending.ts" }, status: "unfinished" }),
      ],
    });

    const summary = renderMessage(result as any, 2, true).summary;
    expect(summary).toContain("Script failed");
    const nested = summary.split("\n").at(-1)!;
    expect(nested).toContain("write(path=src/written.ts) 12ms");
    expect(nested).toContain("bash(command=echo one echo two) error exit 1 5ms");
    expect(nested).toContain("read(path=src/pending.ts) unfinished");
  });

  test("generic nested arguments use key=value without changing ordinary tools", () => {
    const result = codemodeResult({
      calls: [
        nestedCall({
          name: "mcp__docs__search",
          arguments: {
            url: "https://example.test",
            flags: ["a", "b", "c", "d"],
            options: { deep: true },
          },
        }),
        nestedCall({ name: "write", arguments: { path: "src/a.ts" } }),
      ],
    });

    const summary = renderMessage(result as any, 3, true).summary;
    expect(summary).toContain(
      "mcp__docs__search(url=https://example.test, flags=a | b | c +1, options)",
    );
    expect(summary).toContain("write(path=src/a.ts)");
  });

  test("an incomplete record is marked instead of pretending to be whole", () => {
    const result = codemodeResult({
      calls: [nestedCall({ name: "read", arguments: { path: "src/a.ts" } })],
      complete: false,
    });
    expect(renderMessage(result as any, 4, true).summary).toContain("[record incomplete]");
  });

  test("a failed script keeps its successful side effect visible", () => {
    const result = codemodeResult({
      text: "Script failed\nError: boom",
      isError: true,
      calls: [
        nestedCall({ name: "write", arguments: { path: "src/written.ts" }, status: "ok" }),
        nestedCall({ name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" }),
      ],
    });
    const summary = renderMessage(result as any, 5, true).summary;
    expect(summary).toContain("Script failed");
    expect(summary).toContain("write(path=src/written.ts)");
    expect(summary).toContain("bash(command=false) error exit 1");
  });
});

describe("codemode in the compact brief", () => {
  test("declared intent and static tool names replace the code-head cost", () => {
    const messages = [
      assistantText("work"),
      codemodeCall(
        codemodeScript(
          "验证登录流程",
          "await tools.read({ path: 'src/a.ts' }); await tools.read({ path: 'src/b.ts' }); await tools.bash({ command: 'npm test' });",
        ),
      ),
      codemodeResult({
        text: "Script completed\nRESULT_BODY_MARKER",
        calls: [nestedCall({ name: "read", arguments: { path: "src/a.ts" } })],
      }),
    ];

    const brief = briefOf(messages);
    expect(brief).toContain("* codemode -> read, bash | goal: 验证登录流程");
    expect(brief).not.toContain("read×2");
    expect(brief).not.toContain("RESULT_BODY_MARKER");
    expect(brief).not.toContain("src/a.ts");
  });

  test("repeated tool names appear once, ordered by call-site count", () => {
    const brief = briefOf([
      codemodeCall(
        codemodeScript(
          "统计调用位置",
          "await tools.bash({ command: 'one' });\nawait tools.read({ path: 'a' });\nawait tools.bash({ command: 'two' });",
        ),
      ),
    ]);
    expect(brief).toContain("* codemode -> bash, read | goal: 统计调用位置");
  });

  test("missing intent falls back to the 80-char code head", () => {
    const brief = briefOf([
      codemodeCall("await tools.read({ path: 'a' });"),
    ]);
    expect(brief).toBe("* codemode -> read | code: await tools.read({ path: 'a' }); (#0)");
  });

  test("a script without tools shows only the goal or code head", () => {
    expect(briefOf([codemodeCall(codemodeScript("检查配置", "text('ok');", false))]))
      .toBe("* codemode goal: 检查配置 (#0)");
    expect(briefOf([codemodeCall("const x = 1;")]))
      .toBe("* codemode code: const x = 1; (#0)");
  });

  test("an invalid or misplaced marker falls back to the code head", () => {
    const brief = briefOf([
      codemodeCall("// note\n// goal: not on an accepted line\nawait tools.read({});"),
    ]);
    expect(brief).toMatch(/^\* codemode -> read \| code: \/\/ note \/\/ goal:/);
    expect(brief).not.toContain("* codemode goal:");
  });

  test("tool names beyond the first six are counted, not silently dropped", () => {
    const code = ["a", "b", "c", "d", "e", "f", "g"]
      .map((name) => `await tools.${name}({});`)
      .join("\n");
    const brief = briefOf([codemodeCall(code)]);
    expect(brief).toContain("-> a, b, c, d, e, f +1 more | code:");
  });

  test("a very long intent is bounded instead of dominating the brief", () => {
    const brief = briefOf([codemodeCall(codemodeScript("x".repeat(300), "text('ok');", false))]);
    expect(brief).toContain(`goal: ${"x".repeat(199)}…`);
    expect(brief).not.toContain("x".repeat(200));
  });
});

describe("codemode store entries", () => {
  test("do not occupy #N (array and streaming paths)", () => {
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
