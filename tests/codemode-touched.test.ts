import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerRecallTool } from "../src/tools/recall";
import { nestedCall, type NestedCallFixture } from "./codemode-fixtures";

const assistantCodemode = (id: string) => ({
  type: "message",
  id,
  message: {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "tc_codemode",
      name: "codemode",
      arguments: { code: "// goal: work\nawait tools.write({ path: 'src/x.ts', content: 'x' });" },
    }],
  },
});

const resultEntry = (id: string, calls: NestedCallFixture[], complete = true) => ({
  type: "message",
  id,
  message: {
    role: "toolResult",
    toolCallId: "tc_codemode",
    toolName: "codemode",
    content: [{ type: "text", text: "Script completed" }],
    nestedCalls: { calls, complete },
    isError: false,
    timestamp: 0,
  },
});

let dirCount = 0;
const dirs: string[] = [];
const makeSession = (entries: any[]) => {
  const dir = mkdtempSync(join(tmpdir(), `pi-vcc-nested-touched-${dirCount++}-`));
  dirs.push(dir);
  const file = join(dir, "session.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return { file, ids: entries.filter((e) => e.type === "message").map((e) => e.id) };
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const register = () => {
  let tool: any;
  registerRecallTool({ registerTool: (t: any) => { tool = t; } } as any);
  return tool;
};

const invoke = async (tool: any, file: string, ids: string[], params: Record<string, unknown>) => {
  const result = await tool.execute("tool-call", params, undefined, undefined, {
    sessionManager: {
      getSessionFile: () => file,
      getBranch: () => ids.map((id) => ({ id })),
      getEntries: () => ids.map((id) => ({ id })),
    },
  });
  return result.content[0].text as string;
};

describe("mode:touched reads nested codemode file calls", () => {
  it("names the size-loss blind spot in the mode description", () => {
    const tool = register();
    expect((tool.parameters as any).properties.mode.description)
      .toContain("nested writes whose arguments Pi dropped for size");
  });
  it("lists nested writes and edits at the tool result's own entry", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [
        nestedCall({ name: "write", arguments: { path: "src/nested.ts", content: "hello" } }),
        nestedCall({ name: "edit", arguments: { path: "src/edited.ts", oldText: "a", newText: "b" } }),
      ]),
    ]);
    const out = await invoke(register(), file, ids, { mode: "touched" });
    expect(out).toContain("src/nested.ts");
    expect(out).toContain("#1 (write)");
    expect(out).toContain("src/edited.ts");
    expect(out).toContain("#1 (edit)");
  });

  it("drills from the touched entry into nested content", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [
        nestedCall({
          name: "write",
          arguments: { path: "src/nested.ts", content: "NESTED_BODY_MARKER\nline two" },
        }),
      ]),
    ]);
    const tool = register();
    const touched = await invoke(tool, file, ids, { mode: "touched" });
    expect(touched).toContain("query:'#1:nested.ts'");

    const drill = await invoke(tool, file, ids, { query: "#1:src/nested.ts" });
    expect(drill).toContain("File: src/nested.ts");
    expect(drill).toContain("NESTED_BODY_MARKER");
  });

  it("keeps the shape rule: a path-only nested read is not a file touch", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [nestedCall({ name: "read", arguments: { path: "src/read-only.ts" } })]),
    ]);
    const out = await invoke(register(), file, ids, { mode: "touched" });
    expect(out).toContain("No file operations found in session history.");
    expect(out).not.toContain("src/read-only.ts");
  });

  it("reports writes whose arguments Pi dropped for size", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [nestedCall({ name: "write", argumentsBytes: 9000 })]),
    ]);
    const tool = register();
    const out = await invoke(tool, file, ids, { mode: "touched" });
    expect(out).toContain("No listable file operations found in session history.");
    expect(out).toContain("1 nested write/edit call not listed");
    expect(out).toContain("script calls #0");
    expect(out).toContain("expand:[0]");
    expect(out).not.toContain("#1 (write)");

    // The script source survives even though the nested arguments do not.
    const expanded = await invoke(tool, file, ids, { expand: [0] });
    expect(expanded).toContain("tools.write");
  });

  it("marks a failed nested write and does not offer a drill-down for it", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [
        nestedCall({
          name: "write",
          arguments: { path: "src/failed.ts", content: "x" },
          status: "error",
          error: "EACCES",
        }),
      ]),
    ]);
    const out = await invoke(register(), file, ids, { mode: "touched" });
    expect(out).toContain("#1 (write, error)");
    expect(out).not.toContain("File content at an entry");
  });

  it("merges repeated operations on one path into a numbered sequence", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [
        nestedCall({ name: "write", arguments: { path: "src/multi.ts", content: lines } }),
        nestedCall({
          name: "edit",
          arguments: { path: "src/multi.ts", oldText: "line 39", newText: "line 39 changed" },
        }),
      ]),
    ]);
    const tool = register();
    const preview = await invoke(tool, file, ids, { query: "#1:src/multi.ts" });
    expect(preview).toContain("Tool: write + edit");
    expect(preview).toContain("--- 1/2: write ---");
    // The preview keeps the existing first-30-line rule, so the second
    // operation appears on a later page or in :full.
    expect(preview).not.toContain("line 39 changed");
    expect(preview).toContain("more lines");

    const full = await invoke(tool, file, ids, { query: "#1:src/multi.ts:full" });
    expect(full).toContain("--- 1/2: write ---");
    expect(full).toContain("--- 2/2: edit ---");
    expect(full).toContain("line 39 changed");
  });

  it("still asks for a more specific path when distinct files match", async () => {
    const { file, ids } = makeSession([
      assistantCodemode("a0"),
      resultEntry("r1", [
        nestedCall({ name: "write", arguments: { path: "src/first.ts", content: "a" } }),
        nestedCall({ name: "write", arguments: { path: "src/second.ts", content: "b" } }),
      ]),
    ]);
    const out = await invoke(register(), file, ids, { query: "#1:src/" });
    expect(out).toContain("2 file operations matching");
    expect(out).toContain("src/first.ts");
    expect(out).toContain("src/second.ts");
    expect(out).toContain("more-specific-path");
  });

  it("keeps upstream's ambiguity output for direct tool calls", async () => {
    const { file, ids } = makeSession([{
      type: "message",
      id: "a0",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "write", arguments: { path: "src/first.ts", content: "a" } },
          { type: "toolCall", id: "t2", name: "write", arguments: { path: "src/second.ts", content: "b" } },
        ],
      },
    }]);
    const out = await invoke(register(), file, ids, { query: "#0:src/" });
    expect(out).toBe(`Entry #0 has 2 file operations matching "src/":
  [#0:src/first.ts] write(src/first.ts)
  [#0:src/second.ts] write(src/second.ts)

Use #0:<more-specific-path> to drill into a specific file.`);
  });
});
