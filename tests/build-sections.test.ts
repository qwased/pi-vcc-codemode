import { describe, it, expect } from "bun:test";
import { buildSections } from "../src/core/build-sections";
import type { NormalizedBlock } from "../src/types";

describe("buildSections", () => {
  it("returns all-empty for no blocks", () => {
    const r = buildSections({ blocks: [] });
    expect(r.sessionGoal).toEqual([]);
    expect(r.outstandingContext).toEqual([]);
    expect(r.briefTranscript).toBe("");
    expect(r.trackedCommands).toEqual([]);
  });

  it("trackedCommands stays empty by default, even with real tracked-looking commands present", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "bash", args: { command: "ssh prod-server 'docker ps'" } },
    ];
    const r = buildSections({ blocks });
    expect(r.trackedCommands).toEqual([]);
  });

  it("populates trackedCommands only when trackCommands is explicitly non-empty", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "bash", args: { command: "ssh prod-server" } },
    ];
    const r = buildSections({ blocks, trackCommands: ["ssh"] });
    expect(r.trackedCommands).toEqual(["ssh: ssh prod-server"]);
  });

  it("populates sections from realistic blocks", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix the auth bug" },
      { kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
      { kind: "tool_result", name: "Read", text: "const x = 1;" },
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts" } },
      { kind: "tool_result", name: "Edit", text: "ok" },
      { kind: "assistant", text: "- run tests next" },
    ];
    const r = buildSections({ blocks });
    expect(r.sessionGoal).toContain("Fix the auth bug");
    expect(r.briefTranscript).toContain('[user]');
    expect(r.briefTranscript).toContain('* Read "auth.ts"');
    expect(r.briefTranscript).toContain('* Edit "auth.ts"');
  });

  it("captures outstanding context from user and assistant text", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Tests are still failing after the retry." },
    ];
    const r = buildSections({ blocks });
    expect(r.outstandingContext.length).toBeGreaterThan(0);
    expect(r.outstandingContext[0]).toContain("Tests are still failing");
  });

  it("brief transcript hides tool results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "Read", text: "lots of code here ..." },
      { kind: "tool_result", name: "bash", text: "Command not found" },
    ];
    const r = buildSections({ blocks });
    expect(r.briefTranscript).toBe("");
  });

  it("brief transcript merges adjacent assistant sections", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Part one." },
      { kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
      { kind: "assistant", text: "Part two." },
    ];
    const r = buildSections({ blocks });
    const matches = r.briefTranscript.match(/\[assistant\]/g);
    expect(matches?.length).toBe(1);
  });

  it("uses an already-rendered briefText instead of rebuilding or capping it", () => {
    const blocks: NormalizedBlock[] = [{ kind: "user", text: "fresh" }];
    const rendered = "[user]\nfresh (#0)\n\n[assistant]\n* Read \"a.ts\" (#1)";
    const r = buildSections({ blocks, briefText: rendered });
    expect(r.briefTranscript).toBe(rendered);
  });

  it("separates headerBlocks and outstandingBlocks from the fresh window", () => {
    const fresh: NormalizedBlock[] = [
      { kind: "user", text: "continue the migration", sourceIndex: 10 },
      { kind: "tool_call", name: "Read", args: { path: "fresh.ts" }, sourceIndex: 11 },
    ];
    const history: NormalizedBlock[] = [
      { kind: "user", text: "original task: migrate billing", sourceIndex: 0 },
      { kind: "tool_call", name: "Edit", args: { path: "old.ts" }, sourceIndex: 1 },
    ];
    const r = buildSections({
      blocks: fresh,
      headerBlocks: history,
      outstandingBlocks: fresh,
    });
    expect(r.sessionGoal.join("\n")).toContain("original task");
    expect(r.filesAndChanges.join("\n")).toContain("old.ts");
    expect(r.filesAndChanges.join("\n")).not.toContain("fresh.ts");
    expect(r.outstandingContext.join("\n")).not.toContain("original task");
  });
});
