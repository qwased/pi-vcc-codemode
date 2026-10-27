import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  decodeScanCursor,
  encodeScanCursor,
  fullViewOfMessage,
  graphemeStartAtOrBefore,
  readSavedRecord,
  readWindow,
  scanSavedFields,
  sessionIdentityOf,
  type ScanCursor,
} from "../src/core/recall-full";
import type { Message } from "@earendil-works/pi-ai";
import { registerRecallTool } from "../src/tools/recall";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const assistant = (content: any[]): Message => ({
  role: "assistant",
  content,
  api: "messages",
  provider: "test",
  model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "toolUse",
  timestamp: 0,
} as unknown as Message);

const user = (content: string | any[]): Message => ({ role: "user", content, timestamp: 0 } as Message);

const writeSession = (lines: any[], header?: any): string => {
  const dir = mkdtempSync(join(tmpdir(), "pi-vcc-full-"));
  dirs.push(dir);
  const file = join(dir, "session.jsonl");
  const all = [header ?? { type: "session", id: "sess-1" }, ...lines];
  writeFileSync(file, all.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  return file;
};

const messageEntry = (id: string, message: Message, parentId: string | null = null) => ({
  type: "message", id, parentId, timestamp: "", message,
});

const scan = (file: string, query: string, cursor?: string, extra: Record<string, unknown> = {}) =>
  scanSavedFields({
    sessionFile: file,
    query,
    scope: "all",
    cursor,
    branchEntryIds: new Set(),
    branchAnchor: "",
    ...extra,
  });

describe("full field view", () => {
  test("covers deep object/array arguments, scripts past 2000 chars, and nested payloads", () => {
    const code = `${"x".repeat(2500)}DEEP_SCRIPT_MARKER`;
    const msg = assistant([{
      type: "toolCall", id: "c1", name: "codemode",
      arguments: { code, payload: { level1: { level2: ["NESTED_MARKER", 7, true] } } },
    }]);
    const view = fullViewOfMessage(msg, 3);
    expect(view).toContain("#3 [assistant]");
    expect(view).toContain("DEEP_SCRIPT_MARKER");
    expect(view).toContain("NESTED_MARKER");
    expect(view).toContain("[content.0.arguments.payload.level1.level2.1]");
    expect(view).toContain("true");
    // Script text stays multi-line / not flattened.
    expect(view).toContain("x".repeat(100));
  });

  test("includes saved nested names, arguments, status and error", () => {
    const msg = {
      role: "toolResult", toolCallId: "c1", toolName: "codemode",
      content: [{ type: "text", text: "Script failed\nboom" }],
      nestedCalls: {
        complete: false,
        calls: [
          { id: "c1/1", name: "write", arguments: { path: "src/a.ts", content: "X".repeat(3000) + "NESTED_BODY" }, status: "ok" },
          { id: "c1/2", name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" },
          { id: "c1/3", name: "edit", argumentsBytes: 9000, status: "unfinished" },
        ],
      },
      isError: true, timestamp: 0,
    } as unknown as Message;
    const view = fullViewOfMessage(msg, 4);
    expect(view).toContain("[nestedCalls.complete]", "false");
    expect(view).toContain("NESTED_BODY");
    expect(view).toContain("[nestedCalls.calls.1.error]", "exit 1");
    expect(view).toContain("[arguments omitted by Pi; 9000 bytes]");
    expect(view).toContain("[isError]", "true");
  });

  test("excludes typed thinking/image content but keeps an argument key named thinking", () => {
    const msg = assistant([
      { type: "thinking", thinking: "HIDDEN_THOUGHT" },
      { type: "text", text: "visible text" },
      { type: "image", data: "BASE64DATA", mimeType: "image/png" },
      { type: "toolCall", id: "c1", name: "custom", arguments: { thinking: "ARGUMENT_THINKING" } },
    ]);
    const view = fullViewOfMessage(msg, 0);
    expect(view).not.toContain("HIDDEN_THOUGHT");
    expect(view).not.toContain("BASE64DATA");
    expect(view).toContain("visible text");
    expect(view).toContain("ARGUMENT_THINKING");
  });

  test("excludes system and the recall tool's own arguments/results", () => {
    expect(fullViewOfMessage({ role: "system", content: "sys" } as Message, 0)).toBe("");
    const call = assistant([{ type: "toolCall", id: "r1", name: "vcc_recall", arguments: { query: "SELF_QUERY" } }]);
    expect(fullViewOfMessage(call, 1)).toBe("");
    const result = {
      role: "toolResult", toolCallId: "r1", toolName: "vcc_recall",
      content: [{ type: "text", text: "SELF_RESULT" }], isError: false, timestamp: 0,
    } as unknown as Message;
    expect(fullViewOfMessage(result, 2)).toBe("");
  });
});

describe("scan", () => {
  test("enumerates more than 50 matches without a global cap and resumes to completion", () => {
    const lines = Array.from({ length: 60 }, (_, i) =>
      messageEntry(`m${i}`, user(`entry ${i} MATCH_ME`)));
    const file = writeSession(lines);
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const page = scan(file, "match_me", cursor);
      expect(page.ok).toBe(true);
      pages++;
      seen.push(...page.hits.map((h) => h.index));
      cursor = page.nextCursor;
      if (page.complete) break;
      expect(cursor).toBeTruthy();
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(59);
  });

  test("returns partial + cursor even when the page has no hits", () => {
    const file = writeSession([messageEntry("m1", user("nothing here"))]);
    const page = scan(file, "absent", undefined, { maxMs: -1 });
    expect(page.ok).toBe(true);
    expect(page.hits).toHaveLength(0);
    expect(page.complete).toBe(false);
    expect(page.nextCursor).toBeTruthy();
  });

  test("a fixed maxBytes excludes recall messages appended during the scan", () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      messageEntry(`m${i}`, user(`MATCH ${i}`)));
    const file = writeSession(lines);
    const first = scan(file, "match");
    expect(first.hits).toHaveLength(20);
    expect(first.complete).toBe(false);

    // Append a recall message that would match. It is after the fixed bound.
    writeFileSync(file, `${JSON.stringify(messageEntry("new", user("MATCH appended")))}\n`, { flag: "a" });

    const rest = scan(file, "match", first.nextCursor);
    expect(rest.ok).toBe(true);
    expect(rest.totalHits).toBe(25);
    expect(rest.hits.map((h) => h.index)).toEqual([20, 21, 22, 23, 24]);
    expect(rest.hits.some((h) => h.snippet.includes("appended"))).toBe(false);
    expect(rest.complete).toBe(true);
  });

  test("rejects cursors from another query, scope, session or branch", () => {
    const file = writeSession(Array.from({ length: 25 }, (_, i) =>
      messageEntry(`m${i}`, user(`MATCH ${i}`))));
    const first = scan(file, "match", undefined, { branchAnchor: "b1", branchEntryIds: new Set(["b1"]) });
    expect(first.nextCursor).toBeTruthy();

    expect(scan(file, "other", first.nextCursor).error).toContain("different scan query");
    expect(scan(file, "match", first.nextCursor, { scope: "lineage", allowedEntryIds: new Set() }).error).toContain("different scope");
    const otherFile = writeSession([], { type: "session", id: "sess-2" });
    expect(scan(otherFile, "match", first.nextCursor).error).toContain("different session");
    expect(scan(file, "match", first.nextCursor, { branchEntryIds: new Set(["elsewhere"]), branchAnchor: "elsewhere" }).error)
      .toContain("branch changed");
  });

  test("rejects malformed cursors instead of treating them as complete", () => {
    const file = writeSession([messageEntry("m1", user("MATCH"))]);
    expect(scan(file, "match", "not-base64-json").error).toContain("Invalid scan cursor");
    const badVersion = Buffer.from(JSON.stringify({ v: 99 }), "utf8").toString("base64url");
    expect(scan(file, "match", badVersion).error).toContain("unsupported cursor version");
  });

  test("marks coverage incomplete when a JSONL record is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-vcc-full-bad-"));
    dirs.push(dir);
    const file = join(dir, "session.jsonl");
    writeFileSync(file, [
      JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "MATCH" } }),
      "{not json",
      JSON.stringify({ type: "message", id: "m2", message: { role: "user", content: "MATCH" } }),
      "",
    ].join("\n"), "utf8");
    const page = scan(file, "match");
    expect(page.ok).toBe(true);
    expect(page.hits).toHaveLength(2);
    expect(page.malformed).toBe(1);
    expect(page.complete).toBe(true);
  });

  test("counts system entries in #N but never scans or renders them", () => {
    const lines = [
      messageEntry("s0", { role: "system", content: "SYSTEM_MATCH" } as Message),
      messageEntry("m1", user("MATCH")),
    ];
    const file = writeSession(lines);
    const page = scan(file, "system_match");
    expect(page.hits).toHaveLength(0);
    // Both records were examined; the system record just has no view to match.
    expect(page.scanned).toBe(2);
    const match = scan(file, "match");
    expect(match.hits.map((h) => h.index)).toEqual([1]);
  });

  test("lineage scope filters matches but keeps global indices", () => {
    const lines = [
      messageEntry("m1", user("MATCH one")),
      messageEntry("m2", user("MATCH two")),
    ];
    const file = writeSession(lines);
    const page = scan(file, "match", undefined, {
      scope: "lineage",
      allowedEntryIds: new Set(["m2"]),
    });
    expect(page.hits.map((h) => h.index)).toEqual([1]);
  });

  test("compaction and custom entries do not consume #N", () => {
    const file = writeSession([
      { type: "compaction", id: "c1", parentId: null, timestamp: "", summary: "old", firstKeptEntryId: "m1", tokensBefore: 10 },
      { type: "custom", id: "u1", parentId: "c1", timestamp: "", customType: "codemode-store", data: {} },
      messageEntry("m1", user("MATCH after compaction")),
    ]);
    const page = scan(file, "match");
    expect(page.hits.map((h) => h.index)).toEqual([0]);
  });
});

describe("read", () => {
  test("multi-page reads concatenate to the full canonical view", () => {
    const code = `${"y".repeat(2600)}TAIL_MARKER`;
    const msg = assistant([{ type: "toolCall", id: "c1", name: "codemode", arguments: { code } }]);
    const file = writeSession([messageEntry("m1", msg)]);
    const full = fullViewOfMessage(msg, 0);

    let offset = 0;
    let joined = "";
    for (let i = 0; i < 100; i++) {
      const outcome = readSavedRecord({ sessionFile: file, index: 0, offset, length: 700 });
      expect(outcome.ok).toBe(true);
      const window = outcome.window!;
      if (window.kind === "eof") break;
      expect(window.kind).toBe("ok");
      if (window.kind !== "ok") break;
      expect(window.actualStart).toBe(offset);
      joined += window.text;
      offset = window.actualEnd;
      if (window.remaining === 0) break;
    }
    expect(joined).toBe(full);
    expect(offset).toBe(full.length);
  });

  test("keeps grapheme clusters intact and reports the minimum length", () => {
    const msg = user("A👍🏽B");
    const file = writeSession([messageEntry("m1", msg)]);
    const full = fullViewOfMessage(msg, 0);
    const emojiStart = full.indexOf("👍");

    const outcome = readSavedRecord({ sessionFile: file, index: 0, offset: emojiStart + 1, length: 1 });
    expect(outcome.ok).toBe(true);
    expect(outcome.window!.kind).toBe("length-too-small");
    if (outcome.window?.kind === "length-too-small") {
      expect(outcome.window.actualStart).toBe(emojiStart);
      expect(outcome.window.required).toBe(4);
    }

    const safe = readSavedRecord({ sessionFile: file, index: 0, offset: emojiStart + 1, length: 4 });
    expect(safe.window!.kind).toBe("ok");
    if (safe.window?.kind === "ok") {
      expect(safe.window.actualStart).toBe(emojiStart);
      expect(safe.window.text).toBe("👍🏽");
    }
  });

  test("reports EOF and out-of-range offsets", () => {
    const msg = user("short");
    const file = writeSession([messageEntry("m1", msg)]);
    const total = fullViewOfMessage(msg, 0).length;
    expect(readSavedRecord({ sessionFile: file, index: 0, offset: total, length: 10 }).window!.kind).toBe("eof");
    expect(readSavedRecord({ sessionFile: file, index: 0, offset: total + 1, length: 10 }).window!.kind).toBe("out-of-range");
  });

  test("refuses a single pathological grapheme above the hard limit", () => {
    const msg = user(`a${"\u0301".repeat(13000)}`);
    const file = writeSession([messageEntry("m1", msg)]);
    const full = fullViewOfMessage(msg, 0);
    const start = full.indexOf("a");
    const outcome = readSavedRecord({ sessionFile: file, index: 0, offset: start, length: 4000 });
    expect(outcome.window!.kind).toBe("grapheme-too-large");
    if (outcome.window?.kind === "grapheme-too-large") {
      expect(outcome.window.required).toBeGreaterThan(12000);
    }
  });

  test("pairs a tool call with its verified results and a result with its call", () => {
    const lines = [
      messageEntry("m1", assistant([
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
        { type: "toolCall", id: "c2", name: "read", arguments: { path: "b" } },
      ])),
      messageEntry("m2", { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "one" }], isError: false, timestamp: 0 } as Message),
      messageEntry("m3", { role: "toolResult", toolCallId: "c2", toolName: "read", content: [{ type: "text", text: "two" }], isError: false, timestamp: 0 } as Message),
      messageEntry("m4", assistant([{ type: "text", text: "done" }])),
    ];
    const file = writeSession(lines);
    const call = readSavedRecord({ sessionFile: file, index: 0, offset: 0, length: 4000 });
    expect(call.pairedResultIndices).toEqual([1, 2]);

    const result = readSavedRecord({ sessionFile: file, index: 1, offset: 0, length: 4000 });
    expect(result.pairedCallIndex).toBe(0);
  });

  test("marks off-path records but still reads them", () => {
    const file = writeSession([messageEntry("m1", user("off path text"))]);
    const outcome = readSavedRecord({ sessionFile: file, index: 0, offset: 0, length: 4000, allowedEntryIds: new Set() });
    expect(outcome.ok).toBe(true);
    expect(outcome.offPath).toBe(true);
    expect(outcome.window!.kind).toBe("ok");
  });

  test("excluded records return an empty view (EOF) instead of fabricated fields", () => {
    const lines = [
      messageEntry("m1", assistant([{ type: "toolCall", id: "r1", name: "vcc_recall", arguments: { query: "x" } }])),
      messageEntry("m2", { role: "toolResult", toolCallId: "r1", toolName: "vcc_recall", content: [{ type: "text", text: "matches" }], isError: false, timestamp: 0 } as Message),
      messageEntry("m3", { role: "system", content: "sys" } as Message),
    ];
    const file = writeSession(lines);
    for (const index of [0, 1, 2]) {
      const outcome = readSavedRecord({ sessionFile: file, index, offset: 0, length: 100 });
      expect(outcome.ok).toBe(true);
      expect(outcome.window).toEqual({ kind: "eof", total: 0 });
    }
  });

  test("reports a missing index with the last available number", () => {
    const file = writeSession([messageEntry("m1", user("only"))]);
    const outcome = readSavedRecord({ sessionFile: file, index: 9, offset: 0, length: 100 });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Entry #9 not found");
    expect(outcome.error).toContain("#0");
  });
});

describe("grapheme helpers", () => {
  test("floor to the cluster start", () => {
    expect(graphemeStartAtOrBefore("e\u0301x", 1)).toBe(0);
    expect(graphemeStartAtOrBefore("e\u0301x", 2)).toBe(2);
    expect(graphemeStartAtOrBefore("abc", 99)).toBe(3);
  });

  test("readWindow never returns half a surrogate pair", () => {
    const window = readWindow("ab👍🏽cd", 2, 2);
    expect(window.kind).toBe("length-too-small");
    const ok = readWindow("ab👍🏽cd", 2, 4);
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.text).toBe("👍🏽");
  });
});

describe("vcc_recall scan/read end-to-end", () => {
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

  test("scans past the query's 2000-char indexing cap and pages to completion", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const long = `${"A".repeat(3000)} NEEDLE_IN_SCRIPT ${"B".repeat(3000)}`;
    const lines = ids.map((id, i) => messageEntry(id, user(i === 0 ? long : `MATCH_ME ${i}`)));
    const file = writeSession(lines);
    const tool = register();

    const first = await invoke(tool, file, ids, { query: "MATCH_ME", scan: true });
    expect(first).toContain("This page: 20 new matches");
    expect(first).toContain("Continue scan");
    const cursor = first.match(/cursor: ("(?:[^"\\]|\\.)*")/)?.[1];
    expect(cursor).toBeTruthy();

    const rest = await invoke(tool, file, ids, { query: "MATCH_ME", scan: true, cursor: JSON.parse(cursor!) });
    expect(rest).toContain("24 matches total");
    expect(rest).toContain("Scan complete.");

    const deep = await invoke(tool, file, ids, { query: "NEEDLE_IN_SCRIPT", scan: true });
    expect(deep).toContain("NEEDLE_IN_SCRIPT");
    expect(deep).toContain("#0 [user]");
  });

  test("pages one record through read with the returned offset", async () => {
    const text = "C".repeat(6000);
    const file = writeSession([messageEntry("m1", user(text))]);
    const tool = register();

    const first = await invoke(tool, file, ["m1"], { read: { index: 0, offset: 0, length: 1000 } });
    expect(first).toContain("read 0-1000 of");
    const nextOffset = Number(first.match(/offset: (\d+), length/)?.[1]);
    expect(nextOffset).toBe(1000);

    const second = await invoke(tool, file, ["m1"], { read: { index: 0, offset: nextOffset, length: 1000 } });
    expect(second).toContain("read 1000-2000 of");
  });

  test("reports an invalid cursor as an error, not a false empty result", async () => {
    const file = writeSession([messageEntry("m1", user("MATCH"))]);
    const output = await invoke(register(), file, ["m1"], { query: "MATCH", scan: true, cursor: "garbage" });
    expect(output).toContain("Invalid scan cursor");
  });
});

describe("scan cursors", () => {  test("round-trip and reject bad bounds", () => {
    const cursor: ScanCursor = {
      v: 1, nextByte: 10, nextIndex: 2, maxBytes: 100, scope: "all",
      query: "q", session: "s", branch: "b", totalHits: 1, scanned: 3, malformed: 0,
    };
    const round = decodeScanCursor(encodeScanCursor(cursor));
    expect(round.ok).toBe(true);
    if (round.ok) expect(round.cursor).toEqual(cursor);

    const bad = Buffer.from(JSON.stringify({ ...cursor, nextByte: 200 }), "utf8").toString("base64url");
    expect(decodeScanCursor(bad).ok).toBe(false);
  });

  test("session identity falls back to the file name without a header", () => {
    const file = writeSession([messageEntry("m1", user("x"))], { type: "message", id: "x", message: { role: "user", content: "" } });
    expect(sessionIdentityOf(file)).toContain("session.jsonl");
  });
});
