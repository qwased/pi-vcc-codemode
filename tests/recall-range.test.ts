import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerRecallTool } from "../src/tools/recall";
import { buildGlobalIndexById } from "../src/core/global-indices";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const writeSession = (entries: any[]) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-vcc-range-"));
  dirs.push(dir);
  const file = join(dir, "session.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return file;
};

const msg = (id: string, role: string, content: unknown, extra: Record<string, unknown> = {}) =>
  ({ type: "message", id, message: { role, content, ...extra } });

const recall = async (file: string, params: Record<string, unknown>, branch?: string[]) => {
  let tool: any;
  registerRecallTool({ registerTool: (t: any) => { tool = t; } } as any);
  const ids = branch ?? [];
  const result = await tool.execute("call", params, undefined, undefined, {
    sessionManager: {
      getSessionFile: () => file,
      getBranch: () => ids.map((id) => ({ id })),
      getEntries: () => ids.map((id) => ({ id })),
    },
  });
  return result.content[0].text as string;
};

const linear = (n: number) => Array.from({ length: n }, (_, i) => msg(`m${i}`, i % 2 ? "assistant" : "user", `entry ${i} body`));

describe("vcc_recall range", () => {
  it("returns the inclusive range in order", async () => {
    const entries = linear(10);
    const file = writeSession(entries);
    const out = await recall(file, { range: [3, 5] }, entries.map((e) => e.id));
    expect(out.startsWith("Range #3..#5 (3 messages):")).toBe(true);
    expect(out.indexOf("#3 [assistant] entry 3")).toBeLessThan(out.indexOf("#4 [user] entry 4"));
    expect(out).toContain("#5 [assistant] entry 5");
    expect(out).not.toContain("entry 2 body");
    expect(out).not.toContain("entry 6 body");
    expect(out).not.toContain("undefined");
  });

  // #28: summaries emit session-global #N; a ref copied from a summary must
  // land on the same message even with non-message entries, system messages
  // and an abandoned branch before it.
  it("uses the same #N space as summary refs", async () => {
    const entries = [
      { type: "session", id: "hdr" },
      msg("u1", "user", "first question"),
      { type: "compaction", id: "c1", firstKeptEntryId: "u1" },
      { type: "custom_message", id: "x1", customType: "ext.note", content: "not counted" },
      msg("s1", "system", "tool loadout"),
      msg("old", "assistant", "abandoned branch answer"),
      msg("a1", "assistant", "target answer on the live branch"),
    ];
    const file = writeSession(entries);
    const n = buildGlobalIndexById(entries).get("a1")!;
    const out = await recall(file, { range: [n, n] }, ["hdr", "u1", "c1", "x1", "s1", "a1"]);
    expect(out).toContain(`#${n} [assistant] target answer on the live branch`);
    expect(out).not.toContain("abandoned");
    expect(out).not.toContain("tool loadout");
  });

  it("honors scope: off-lineage entries only through the labelled fallback or scope:'all'", async () => {
    const entries = [msg("m0", "user", "live"), msg("m1", "assistant", "edited away"), msg("m2", "assistant", "live reply")];
    const file = writeSession(entries);
    const branch = ["m0", "m2"];

    const lineage = await recall(file, { range: [0, 2] }, branch);
    expect(lineage).toContain("2 messages");
    expect(lineage).not.toContain("edited away");

    const onlyOff = await recall(file, { range: [1, 1] }, branch);
    expect(onlyOff.startsWith("Nothing on the current conversation path")).toBe(true);
    expect(onlyOff).toContain("#1 [assistant] edited away");

    const all = await recall(file, { range: [1, 1], scope: "all" }, branch);
    expect(all).toContain("#1 [assistant] edited away");
    expect(all).toContain("scope: all");
  });

  it("pages 20 at a time with an exact count and a ready next call", async () => {
    const entries = linear(45);
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);

    const p1 = await recall(file, { range: [0, 44] }, ids);
    expect(p1.startsWith("Range #0..#44, page 1/3 (45 messages):")).toBe(true);
    expect(p1).toContain("#19 ");
    expect(p1).not.toContain("#20 ");
    expect(p1).toContain("Use range:[0, 44] page:2");

    const p3 = await recall(file, { range: [0, 44], page: 3 }, ids);
    expect(p3).toContain("#40 ");
    expect(p3).toContain("#44 ");
    expect(p3).not.toContain("Use range");

    const p4 = await recall(file, { range: [0, 44], page: 4 }, ids);
    expect(p4).toContain("Page 4 is outside the available range 1-3");
  });

  it("rejects malformed ranges and reports the last index for empty ones", async () => {
    const entries = linear(3);
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);
    for (const range of [[5, 2], [1], [1.5, 3], [-1, 2], ["1", "2"]]) {
      expect(await recall(file, { range }, ids)).toContain("Invalid range");
    }
    expect(await recall(file, { range: [10, 20] }, ids)).toBe("No messages #10..#20 in session history (last entry is #2).");
  });

  it("reads a range past the end up to the last entry and says so", async () => {
    const entries = linear(5);
    const file = writeSession(entries);
    const out = await recall(file, { range: [3, 100] }, entries.map((e) => e.id));
    expect(out.startsWith("Range #3..#4 (2 messages, #4 is the last entry):")).toBe(true);
  });

  // f6c270e: entries without content (bashExecution) used to crash recall.
  it("renders entries without content", async () => {
    const entries = [msg("m0", "user", "run it"), { type: "message", id: "b1", message: { role: "bashExecution", command: "ls", output: "a.txt" } }, msg("m2", "assistant", undefined)];
    const file = writeSession(entries);
    const out = await recall(file, { range: [0, 2] }, ["m0", "b1", "m2"]);
    expect(out).toContain("#1 [bash] $ ls");
    expect(out).toContain("#2 [assistant]");
  });

  it("keeps expand ahead of range, and range ahead of query", async () => {
    const entries = linear(5);
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);
    const expanded = await recall(file, { range: [0, 4], expand: [2] }, ids);
    expect(expanded).toContain("#2 [user] entry 2 body");
    expect(expanded).not.toContain("Range");
    const ranged = await recall(file, { range: [0, 1], query: "entry" }, ids);
    expect(ranged.startsWith("Ignored: query (range runs alone")).toBe(true);
    expect(ranged).toContain("; action: entry range.");
    expect(ranged).toContain("Range #0..#1 (2 messages):");
  });
});

const call = (id: string, callId: string, cmd: string) =>
  msg(id, "assistant", [{ type: "toolCall", id: callId, name: "bash", arguments: { command: cmd } }]);
const result = (id: string, callId: string, text: string) =>
  msg(id, "toolResult", [{ type: "text", text }], { toolCallId: callId, toolName: "bash" });

describe("vcc_recall expand pairs a tool call with its result", () => {
  it("brings the result along, clipped, without repeating requested entries", async () => {
    const entries = [
      msg("u0", "user", "check the logs"),
      call("a1", "c1", "tail app.log"),
      msg("u2", "user", "interleaved"),
      result("r3", "c1", "line\n".repeat(2000)),
      call("a4", "c2", "ls"),
      result("r5", "c2", "a.txt"),
    ];
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);

    const out = await recall(file, { expand: [1] }, ids);
    expect(out.startsWith("Expanded #1:")).toBe(true);
    expect(out).toContain("#3 [tool_result] [bash] line");
    expect(out).toContain("[result of #1 clipped at 4000 of 10007 chars; expand:[3] for all of it]");
    expect(out).not.toContain("interleaved");

    const both = await recall(file, { expand: [4, 5] }, ids);
    expect(both.match(/#5 \[tool_result\]/g)?.length).toBe(1);
    expect(both).not.toContain("clipped");

    const plainResult = await recall(file, { expand: [3] }, ids);
    expect(plainResult).toContain("#3 [tool_result]");
    expect(plainResult).not.toContain("tail app.log");
  });
});

describe("vcc_recall next-step hints", () => {
  it("search points at its first hit; touched points at a written file", async () => {
    const entries = [
      msg("u0", "user", "fix the redis cache"),
      msg("a1", "assistant", [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "/repo/src/cache.ts", content: "x" } }]),
      msg("r2", "toolResult", [{ type: "text", text: "ok" }], { toolCallId: "w1", toolName: "write" }),
      msg("u3", "user", "what did we do earlier?"),
      msg("a4", "assistant", [{ type: "toolCall", id: "q1", name: "vcc_recall", arguments: {} }]),
    ];
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);

    const found = await recall(file, { query: "redis" }, ids);
    expect(found).toContain("--- Read around a hit: range:[0, 3]; full text: expand:[0] ---");

    const touched = await recall(file, { mode: "touched" }, ids);
    expect(touched).toContain("--- File content at an entry: query:'#1:cache.ts' ---");
  });
});

// Live test P5: the agent searched with words from the question itself, the
// question matched, and the fact on an abandoned branch was never reached.
describe("vcc_recall search skips the current turn", () => {
  const entries = [
    msg("u0", "user", "fix the bucket"),
    msg("a1", "assistant", "fixed"),
    msg("u2", "user", "remember: staging code is TEAL-ORCHID-42"),
    msg("a3", "assistant", "noted the staging code"),
    msg("u4", "user", "add a README line"),
    msg("a5", "assistant", "done"),
    msg("u6", "user", "what was the staging code I gave you?"),
    // the agent message making this recall call, written before the tool runs
    msg("a7", "assistant", [{ type: "toolCall", id: "r1", name: "vcc_recall", arguments: { query: "staging code" } }]),
  ];
  const live = ["u0", "a1", "u4", "a5", "u6", "a7"];

  it("does not answer a question with itself, and falls back to the abandoned branch", async () => {
    const file = writeSession(entries);
    const out = await recall(file, { query: "staging code" }, live);
    expect(out.startsWith("Nothing on the current conversation path")).toBe(true);
    expect(out).toContain("TEAL-ORCHID-42");
    expect(out).not.toContain("what was the staging code");
  });

  it("keeps earlier turns, and range/expand still reach the current turn", async () => {
    const file = writeSession(entries);
    const earlier = await recall(file, { query: "README" }, live);
    expect(earlier).toContain("#4 [user] add a README line");
    expect(await recall(file, { expand: [6] }, live)).toContain("#6 [user] what was the staging code");
    expect(await recall(file, { range: [6, 6] }, live)).toContain("#6 [user]");
  });

  it("takes the turn from the active path even with scope:'all'", async () => {
    // u2/a3 are an abandoned branch whose question is the session's last user message
    const branched = [entries[0], entries[1], msg("q2", "user", "which staging code?"), entries[6], entries[7], msg("z9", "user", "staging code on the old branch")];
    const file = writeSession(branched);
    const out = await recall(file, { query: "staging code", scope: "all" }, ["u0", "a1", "q2", "u6", "a7"]);
    expect(out).toContain("#2 [user] which staging code?");
    expect(out).toContain("#5 [user] staging code on the old branch");
    expect(out).not.toContain("what was the staging code");
  });

  it("skips nothing once the context was compacted inside the turn", async () => {
    const file = writeSession(entries);
    let tool: any;
    registerRecallTool({ registerTool: (t: any) => { tool = t; } } as any);
    const branch = [
      ...["u0", "a1", "u4", "a5"].map((id) => ({ id })),
      { id: "u6", type: "message", message: { role: "user" } },
      { id: "c1", type: "compaction" },
      { id: "a7", type: "message", message: { role: "assistant" } },
    ];
    const r = await tool.execute("call", { query: "staging code" }, undefined, undefined, {
      sessionManager: { getSessionFile: () => file, getBranch: () => branch, getEntries: () => branch },
    });
    expect(r.content[0].text).toContain("#6 [user] what was the staging code");
  });

  it("says so when every match is in the current turn", async () => {
    const file = writeSession(entries);
    const out = await recall(file, { query: "what was" }, live);
    expect(out).toBe('No earlier matches for "what was"; its 1 match is in the current turn, which is already in your context.');
  });

  it("skips nothing when no agent message follows the last user message", async () => {
    const file = writeSession(entries.slice(0, 7));
    const out = await recall(file, { query: "staging code" }, live.slice(0, 5));
    expect(out).toContain("#6 [user] what was the staging code");
  });
});

// ibis review: filtering the turn after ranking let the question win the regex
// path (a "?" makes the query a regex), so the term search never ran.
describe("vcc_recall search leaves the current turn out before ranking", () => {
  it("finds the earlier answer when the agent searches with the question itself", async () => {
    const entries = [
      msg("u0", "user", "note this"),
      msg("a1", "assistant", "The staging code is TEAL-ORCHID-42."),
      msg("u2", "user", "What was the staging code?"),
      msg("a3", "assistant", [{ type: "toolCall", id: "q1", name: "vcc_recall", arguments: { query: "What was the staging code?" } }]),
    ];
    const file = writeSession(entries);
    const out = await recall(file, { query: "What was the staging code?" }, entries.map((e) => e.id));
    expect(out).toContain("TEAL-ORCHID-42");
    expect(out).not.toContain("No earlier matches");
  });

  it("does not let many current-turn hits fill the cap and hide an older one", async () => {
    const turn = Array.from({ length: 60 }, (_, i) => msg(`t${i}`, "toolResult", [{ type: "text", text: `retry loop ${i}` }], { toolCallId: `c${i}`, toolName: "bash" }));
    const entries = [
      msg("u0", "user", "first"),
      msg("a1", "assistant", "retry loop was decided here"),
      msg("u2", "user", "again"),
      msg("a3", "assistant", [{ type: "toolCall", id: "q", name: "vcc_recall", arguments: {} }]),
      ...turn,
    ];
    const file = writeSession(entries);
    const out = await recall(file, { query: "retry loop" }, entries.map((e) => e.id));
    expect(out).toContain("#1 [assistant] retry loop was decided here");
  });
});

// ibis review: an interrupted call left no result, and a later call reused its id.
describe("vcc_recall expand pairs only the call's own result", () => {
  it("does not take a later call's result through a reused id", async () => {
    const entries = [
      msg("u0", "user", "run it"),
      call("old", "call_1", "echo OLD"),
      msg("u2", "user", "try again"),
      call("new", "call_1", "echo NEW"),
      result("r1", "call_1", "NEW_RESULT"),
    ];
    const file = writeSession(entries);
    const ids = entries.map((e) => e.id);
    const old = await recall(file, { expand: [1] }, ids);
    expect(old).toContain("echo OLD");
    expect(old).not.toContain("NEW_RESULT");
    expect(await recall(file, { expand: [3] }, ids)).toContain("NEW_RESULT");
  });
});
