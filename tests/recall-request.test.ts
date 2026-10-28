import { describe, it, expect } from "bun:test";
import { normalizeToolParams, parseCommandRequest, parseToolRequest } from "../src/core/recall-request";
import { ignoredNote } from "../src/core/recall-run";

describe("parseToolRequest", () => {
  it("does not report filler defaults as ignored", () => {
    const r = parseToolRequest({ query: "auth", page: 1, expand: [], mode: "hybrid", scope: "lineage" });
    expect(r.action.kind).toBe("search");
    expect(r.ignored).toBeUndefined();
    expect(ignoredNote(r)).toBe("");
  });

  // 0f00af1: expand next to query was once silently turned into a search;
  // now expand wins and the dropped query is named.
  it("names the query dropped by expand", () => {
    const r = parseToolRequest({ query: "auth", expand: [4], page: 2 });
    expect(r.action).toEqual({ kind: "expand", indices: [4] });
    expect(ignoredNote(r)).toBe("Ignored: query, page (expand runs alone; send the rest in a separate call); action: entry expansion.\n\n");
  });

  it("keeps page for range and names the query", () => {
    const r = parseToolRequest({ range: [10, 50], page: 2, query: "auth" });
    expect(r.action).toEqual({ kind: "range", range: [10, 50], page: 2 });
    expect(r.ignored).toEqual(["query"]);
  });

  it("names everything touched does not use", () => {
    const r = parseToolRequest({ mode: "touched", query: "x", expand: [1], page: 2 });
    expect(r.action.kind).toBe("touched");
    expect(r.ignored).toEqual(["query", "expand"]);
  });

  it("names page without anything to page", () => {
    const r = parseToolRequest({ page: 3 });
    expect(r.action.kind).toBe("recent");
    expect(ignoredNote(r)).toBe("Ignored: page (page applies to query or range results); action: recent entries.\n\n");
  });
});

import { normalizeToolParams } from "../src/core/recall-request";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { registerRecallTool } from "../src/tools/recall";

describe("normalizeToolParams", () => {
  it("repairs mistakes whose meaning is certain", () => {
    expect(normalizeToolParams({ expand: ["459", "#460", 461] })).toEqual({ expand: [459, 460, 461] });
    expect(normalizeToolParams({ expand: 459 })).toEqual({ expand: [459] });
    expect(normalizeToolParams({ expand: "#12, #15" })).toEqual({ expand: [12, 15] });
    expect(normalizeToolParams({ range: "10-20" })).toEqual({ range: [10, 20] });
    expect(normalizeToolParams({ range: "#10..#20" })).toEqual({ range: [10, 20] });
    expect(normalizeToolParams({ range: ["20", 10] })).toEqual({ range: [10, 20] });
    for (const range of [[5], 5, "#5", "5"]) expect(normalizeToolParams({ range })).toEqual({ range: [5, 5] });
    expect(normalizeToolParams({ page: "2" })).toEqual({ page: 2 });
    expect(normalizeToolParams({ scope: " ALL ", mode: "Touched" })).toEqual({ scope: "all", mode: "touched" });
    // seen in a real session: pi rejected the whole call
    expect(normalizeToolParams({ query: "jpeg flag", mode: "all" })).toEqual({ query: "jpeg flag", scope: "all" });
  });

  it("drops what it cannot repair and says so", () => {
    const p = normalizeToolParams({ query: "x", limit: 20, range: [5, 6, 7], expand: "the auth one", scope: "branch", page: 0 });
    expect(p).toEqual({
      query: "x",
      _vccDropped: [
        'limit 20 (not a vcc_recall param)',
        'page 0 (not a page number)',
        'expand "the auth one" (not #N indices)',
        "range [5,6,7] (not [from, to])",
        'scope "branch" (use \'lineage\' or \'all\')',
      ],
    });
    const r = parseToolRequest(p);
    expect(ignoredNote(r).startsWith("Ignored: limit 20 (not a vcc_recall param); page 0")).toBe(true);
    expect(ignoredNote(r)).toContain("; action: hybrid query.");
  });

  it("leaves well-formed params untouched", () => {
    const args = { query: "auth", range: [1, 2], expand: [3], page: 2, scope: "all", mode: "touched" };
    expect(normalizeToolParams(args)).toEqual(args);
  });

  it("passes pi's own schema validation after repair", () => {
    let tool: any;
    registerRecallTool({ registerTool: (t: any) => { tool = t; } } as any);
    const raw = { query: "jpeg", mode: "all", expand: "459", limit: 20 };
    expect(() => validateToolArguments(tool, { id: "1", name: "vcc_recall", arguments: raw } as any)).toThrow();
    const args = validateToolArguments(tool, { id: "1", name: "vcc_recall", arguments: tool.prepareArguments(raw) } as any);
    expect(args).toMatchObject({ query: "jpeg", scope: "all", expand: [459], _vccDropped: ["limit 20 (not a vcc_recall param)"] });
  });
});

describe("scan/read tool params", () => {
  it("parses a scan with and without a cursor", () => {
    expect(parseToolRequest({ query: "失效条件", scan: true, scope: "all" })).toEqual({
      scope: "all",
      action: { kind: "scan", query: "失效条件", cursor: undefined },
    });
    expect(parseToolRequest({ query: "q", scan: true, cursor: "abc" })).toEqual({
      scope: "lineage",
      action: { kind: "scan", query: "q", cursor: "abc" },
    });
  });

  it("parses read with defaults and repairs string numbers", () => {
    expect(parseToolRequest({ read: 41 })).toEqual({
      scope: "lineage",
      action: { kind: "read", index: 41, offset: 0, length: 4000 },
    });
    const p = normalizeToolParams({ read: { index: "#41", offset: "0", length: "5000" } });
    expect(parseToolRequest(p)).toEqual({
      scope: "lineage",
      action: { kind: "read", index: 41, offset: 0, length: 5000 },
    });
  });

  it("returns explicit errors instead of falling through to another action", () => {
    const cases: Array<[Record<string, any>, string]> = [
      [{ query: "q", scan: true, expand: [1] }, "scan runs alone"],
      [{ query: "q", scan: true, range: [1, 2] }, "scan runs alone"],
      [{ query: "q", scan: true, page: 2 }, "scan runs alone"],
      [{ scan: true }, "scan requires a query"],
      [{ query: "q", cursor: "abc" }, "cursor requires scan:true"],
      [{ read: { index: 1 }, query: "q" }, "read runs alone"],
      [{ read: { index: 1 }, scan: true }, "read runs alone"],
      [{ read: { index: 1 }, page: 1 }, "read runs alone"],
    ];
    for (const [params, message] of cases) {
      const r = parseToolRequest(params as any);
      expect(r.action.kind).toBe("invalid");
      if (r.action.kind === "invalid") expect(r.action.message).toContain(message);
    }
  });

  it("keeps invalid new values visible instead of dropping them", () => {
    const p = normalizeToolParams({ scan: "yes", read: { index: 1, length: 20000 } });
    expect(p.scan).toBeUndefined();
    expect(p.read).toBeUndefined();
    expect((p as any)._vccInvalid).toEqual([
      'scan "yes" (use true or false)',
      "read.length 20000 (use 1-12000)",
    ]);
    expect(parseToolRequest(p).action.kind).toBe("invalid");
  });

  it("does not reserve the words read/scan in an ordinary query", () => {
    const r = parseToolRequest({ query: "read the scan notes" });
    expect(r.action).toEqual({ kind: "search", query: "read the scan notes", page: 1 });
  });
});

describe("scan/read command syntax", () => {
  it("parses scan, cursor and scope from standalone tokens", () => {
    expect(parseCommandRequest("scan:true scope:all 失效条件")).toEqual({
      scope: "all",
      action: { kind: "scan", query: "失效条件", cursor: undefined },
    });
    expect(parseCommandRequest("scan:true cursor:abc_- scope:all 失效条件")).toEqual({
      scope: "all",
      action: { kind: "scan", query: "失效条件", cursor: "abc_-" },
    });
  });

  it("parses read with offset/length and defaults", () => {
    expect(parseCommandRequest("read:41 offset:0 length:4000 scope:all")).toEqual({
      scope: "all",
      action: { kind: "read", index: 41, offset: 0, length: 4000 },
    });
    expect(parseCommandRequest("read:41")).toEqual({
      scope: "lineage",
      action: { kind: "read", index: 41, offset: 0, length: 4000 },
    });
  });

  it("rejects conflicting or incomplete command forms", () => {
    const cases: Array<[string, string]> = [
      ["read:41 some query", "read runs alone"],
      ["read:41 page:2", "read runs alone"],
      ["read:41 scan:true", "read runs alone"],
      ["cursor:abc", "cursor requires scan:true"],
      ["scan:true", "scan requires a query"],
      ["offset:0 length:10", "only valid with read:N"],
      ["read:41 length:20000", "between 1 and 12000"],
    ];
    for (const [args, message] of cases) {
      const r = parseCommandRequest(args);
      expect(r.action.kind).toBe("invalid");
      if (r.action.kind === "invalid") expect(r.action.message).toContain(message);
    }
  });

  it("keeps a plain query containing read/scan words unchanged", () => {
    expect(parseCommandRequest("read the scan output")).toEqual({
      scope: "lineage",
      action: { kind: "search", query: "read the scan output", page: 1 },
    });
  });
});
describe("ignored note names the action that actually ran (H8)", () => {
  const run = (raw: Record<string, unknown>) => {
    const request = parseToolRequest(normalizeToolParams(raw));
    return { request, note: ignoredNote(request) };
  };

  it("T17: mode scan is judged by the final action, not the typed value", () => {
    const withQuery = run({ mode: "scan", query: "q" });
    expect(withQuery.request.action.kind).toBe("search");
    expect(withQuery.note).toBe('Ignored: mode "scan" (use scan:true with query for a literal scan); action: hybrid query.\n\n');

    const noQuery = run({ mode: "scan" });
    expect(noQuery.request.action.kind).toBe("recent");
    expect(noQuery.note).toBe('Ignored: mode "scan" (use scan:true with query for a literal scan); action: recent entries.\n\n');

    const withCursor = run({ mode: "scan", cursor: "abc", query: "q" });
    expect(withCursor.request.action.kind).toBe("invalid");
    expect(withCursor.note).toBe('Ignored: mode "scan" (use scan:true with query for a literal scan); action: none (invalid request).\n\n');

    // The correction the note suggests is a real dispatch path.
    const withScan = run({ mode: "scan", scan: true, query: "q" });
    expect(withScan.request.action).toEqual({ kind: "scan", query: "q", cursor: undefined });
    expect(withScan.note).toBe('Ignored: mode "scan" (use scan:true with query for a literal scan); action: literal scan.\n\n');
  });

  it("T18: drill, touched, expand, range, scan and read name their own action", () => {
    const drill = run({ query: "#3:src/a.ts", page: 2 });
    expect(drill.request.action.kind).toBe("drill");
    expect(drill.note).toBe("Ignored: page (a #N:path query runs alone); action: file-content lookup.\n\n");

    const touched = run({ mode: "touched", query: "x" });
    expect(touched.request.action.kind).toBe("touched");
    expect(touched.note).toBe("Ignored: query (mode:'touched' runs alone); action: touched files.\n\n");

    const expand = run({ expand: [1], query: "x" });
    expect(expand.request.action.kind).toBe("expand");
    expect(expand.note).toBe("Ignored: query (expand runs alone; send the rest in a separate call); action: entry expansion.\n\n");

    const range = run({ range: [1, 2], query: "x" });
    expect(range.request.action.kind).toBe("range");
    expect(range.note).toBe("Ignored: query (range runs alone; send the rest in a separate call); action: entry range.\n\n");

    const scan = run({ query: "q", scan: true, limit: 5 });
    expect(scan.request.action.kind).toBe("scan");
    expect(scan.note).toBe("Ignored: limit 5 (not a vcc_recall param); action: literal scan.\n\n");

    const read = run({ read: 41, limit: 5 });
    expect(read.request.action.kind).toBe("read");
    expect(read.note).toBe("Ignored: limit 5 (not a vcc_recall param); action: saved-record read.\n\n");

    // A read with extra params fails before running: no action label is invented.
    const readConflict = run({ read: 41, query: "x" });
    expect(readConflict.request.action.kind).toBe("invalid");
    expect(readConflict.note).toBe("");
  });

  it("T19: dropped-only, ignored-only, both and neither", () => {
    const droppedOnly = run({ query: "x", limit: 20 });
    expect(droppedOnly.note).toBe("Ignored: limit 20 (not a vcc_recall param); action: hybrid query.\n\n");

    const ignoredOnly = run({ expand: [1], query: "x" });
    expect(ignoredOnly.note).toBe("Ignored: query (expand runs alone; send the rest in a separate call); action: entry expansion.\n\n");

    const both = run({ query: "x", limit: 20, expand: [4], page: 2 });
    expect(both.note).toBe("Ignored: limit 20 (not a vcc_recall param); query, page (expand runs alone; send the rest in a separate call); action: entry expansion.\n\n");

    expect(run({ query: "auth" }).note).toBe("");
  });
});
