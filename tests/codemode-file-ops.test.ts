import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PI_VCC_COMPACT_INSTRUCTION,
  registerBeforeCompactHook,
} from "../src/hooks/before-compact";
import { nestedFileOps } from "../src/codemode/file-ops";
import { assistantText, assistantWithToolCall, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

describe("nestedFileOps", () => {
  test("reads nested read/write/edit calls with a string path", () => {
    const ops = nestedFileOps([
      codemodeResult({
        calls: [
          nestedCall({ name: "read", arguments: { path: "src/read.ts" } }),
          nestedCall({ name: "write", arguments: { path: "src/written.ts", content: "x" } }),
          nestedCall({ name: "edit", arguments: { path: "src/edited.ts", oldText: "a", newText: "b" } }),
        ],
      }),
    ]);
    expect([...ops.read]).toEqual(["src/read.ts"]);
    expect([...ops.written]).toEqual(["src/written.ts"]);
    expect([...ops.edited]).toEqual(["src/edited.ts"]);
  });

  test("follows Pi's extractor: only read/write/edit and a string path", () => {
    const ops = nestedFileOps([
      codemodeResult({
        calls: [
          nestedCall({ name: "Read", arguments: { path: "src/upper.ts" } }),
          nestedCall({ name: "apply_patch", arguments: { path: "src/patch.ts" } }),
          nestedCall({ name: "write", arguments: { file_path: "src/other-key.ts" } }),
          nestedCall({ name: "bash", arguments: { command: "touch src/bash.ts" } }),
          nestedCall({ name: "vcc_recall", arguments: { query: "#1:src/a.ts" } }),
        ],
      }),
    ]);
    expect([...ops.read]).toEqual([]);
    expect([...ops.written]).toEqual([]);
    expect([...ops.edited]).toEqual([]);
  });

  test("skips calls whose arguments Pi dropped for size", () => {
    const ops = nestedFileOps([
      codemodeResult({
        calls: [nestedCall({ name: "write", argumentsBytes: 9000 })],
      }),
    ]);
    expect([...ops.written]).toEqual([]);
  });

  test("ignores messages without nested records", () => {
    const ops = nestedFileOps([
      assistantWithToolCall("write", { path: "src/direct.ts", content: "x" }) as any,
      assistantText("no calls") as any,
    ]);
    expect([...ops.read, ...ops.written, ...ops.edited]).toEqual([]);
  });
});

// ── hook integration ──────────────────────────────────────────────────────

let tmpDir: string;
let CONFIG_PATH: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-nested-ops-"));
  CONFIG_PATH = join(tmpDir, "pi-vcc-config.json");
  process.env.PI_VCC_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.PI_VCC_CONFIG_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

const entry = (id: string, message: unknown) => ({ id, type: "message", message });

const runCompaction = (branchEntries: unknown[], hostFileOps = { read: [], written: [], edited: [] }) => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ debug: false, overrideDefaultCompaction: false }));
  let handler: ((event: any, ctx: any) => any) | undefined;
  registerBeforeCompactHook({
    on: (name: string, h: any) => {
      if (name === "session_before_compact") handler = h;
    },
  } as any);
  const event = {
    type: "session_before_compact",
    customInstructions: PI_VCC_COMPACT_INSTRUCTION,
    branchEntries,
    preparation: { previousSummary: undefined, fileOps: hostFileOps, tokensBefore: 1000 },
    signal: new AbortController().signal,
  };
  return handler!(event, { ui: { notify: () => {} } });
};

const twoTurns = (summaryMessages: unknown[]) => [
  entry("u1", userMsg("write the file with codemode")),
  ...summaryMessages.map((m, i) => entry(`s${i}`, m)),
  entry("u2", userMsg("now continue")),
  entry("a2", assistantText("done")),
];

describe("compaction includes nested file operations from its own window", () => {
  test("a nested write inside the pi-vcc summary window appears even when host fileOps is empty", () => {
    const result = runCompaction(twoTurns([
      codemodeCall(codemodeScript("write the module", "await tools.write({ path: 'src/nested.ts', content: 'x' });")),
      codemodeResult({
        calls: [nestedCall({ name: "write", arguments: { path: "src/nested.ts", content: "x" } })],
      }),
    ]));
    expect(result.compaction.summary).toContain("- Modified: src/nested.ts");
  });

  test("nested reads land in Read without turning into Modified", () => {
    const result = runCompaction(twoTurns([
      codemodeCall(codemodeScript("read the module", "await tools.read({ path: 'src/only-read.ts' });")),
      codemodeResult({
        calls: [nestedCall({ name: "read", arguments: { path: "src/only-read.ts" } })],
      }),
    ]));
    expect(result.compaction.summary).toContain("- Read: src/only-read.ts");
    expect(result.compaction.summary).not.toContain("Modified: src/only-read.ts");
  });

  test("host file operations are preserved and deduplicated with nested ones", () => {
    const result = runCompaction(
      twoTurns([
        codemodeCall(codemodeScript("write both", "await tools.write({ path: 'src/both.ts', content: 'x' });")),
        codemodeResult({
          calls: [nestedCall({ name: "write", arguments: { path: "src/both.ts", content: "x" } })],
        }),
      ]),
      { read: ["src/host-read.ts"], written: ["src/both.ts"], edited: [] },
    );
    expect(result.compaction.summary).toContain("- Read: src/host-read.ts");
    expect(result.compaction.summary).toMatch(/- Modified: .*src\/both\.ts/);
    expect(result.compaction.summary.match(/src\/both\.ts/g)).toHaveLength(1);
  });

  test("nested writes in the kept tail are not pulled into the summary", () => {
    const result = runCompaction([
      entry("u1", userMsg("first task")),
      entry("a1", assistantText("first answer")),
      entry("u2", userMsg("next task")),
      entry("c2", codemodeCall(codemodeScript("tail write", "await tools.write({ path: 'src/tail.ts', content: 'x' });"))),
      entry("r2", codemodeResult({
        calls: [nestedCall({ name: "write", arguments: { path: "src/tail.ts", content: "x" } })],
      })),
      entry("a2", assistantText("done")),
    ]);
    expect(result.compaction.summary).not.toContain("src/tail.ts");
  });

  test("a session without nested records keeps the host file list as before", () => {
    const result = runCompaction(
      twoTurns([assistantText("no file tools here")]),
      { read: [], written: ["src/host.ts"], edited: [] },
    );
    expect(result.compaction.summary).toContain("- Modified: src/host.ts");
  });
});
