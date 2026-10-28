import { describe, it, expect } from "bun:test";
import {
  buildBriefCandidates,
  compileBrief,
  renderTextCandidate,
  renderToolCandidate,
} from "../src/core/brief";
import { normalize } from "../src/core/normalize";
import type { NormalizedBlock } from "../src/types";
import { assistantWithToolCall, toolResult, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

describe("compileBrief", () => {
  it("returns empty string for no blocks", () => {
    expect(compileBrief([])).toBe("");
  });

  it("renders user and assistant text", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "fix auth bug" },
      { kind: "assistant", text: "Let me look at the auth module." },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("[user]");
    expect(r).toContain("fix auth bug");
    expect(r).toContain("[assistant]");
    expect(r).toContain("Let me look at the auth module.");
  });

  it("preserves assistant markdown line breaks", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "assistant",
        text: "Output nhìn tốt.\n\n```text\nblock #41: head\ntail\n```\n\n- first\n- second",
        sourceIndex: 96,
      },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("Output nhìn tốt.\n\n```text\nblock #41: head\ntail\n```\n\n- first\n- second (#96)");
  });

  it("preserves assistant line breaks when head/tail truncating", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line${i} signal${i}`);
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: lines.join("\n") },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("line0 signal0\nline1 signal1");
    expect(r).toContain("...(middle truncated)...");
    expect(r).toContain("\nline299 signal299");
  });

  it("renders bash commands as user actions", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "npm test", output: "FAIL noisy output", exitCode: 1, sourceIndex: 2 },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("[user]\n$ npm test (#2)");
    expect(r).not.toContain("FAIL noisy output");
  });

  it("drops trivial preamble lines and surfaces the real command", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "set -euo pipefail\ngit add README.md\ngit commit -m \"fix\"\ngit push",
        output: "",
        exitCode: 0,
        sourceIndex: 3,
      },
    ];
    const r = compileBrief(blocks);
    // set -euo pipefail must not be the rendered marker; the git work must show.
    expect(r).toContain('git commit -m "fix"');
    expect(r).toContain("git push");
    expect(r).not.toMatch(/\$ set -euo pipefail/);
  });

  it("keeps a bare trivial command rather than emitting an empty marker", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "set -e", output: "", exitCode: 0, sourceIndex: 4 },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("$ set -e (#4)");
  });

  it("drops redirect-heredoc bodies but keeps the opener", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "cat > /tmp/pr.md <<'EOF'\n## Summary\n- a very long PR body line\nEOF\ngh pr create --body-file /tmp/pr.md",
        output: "",
        exitCode: 0,
        sourceIndex: 5,
      },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("cat > /tmp/pr.md <<'EOF'");
    expect(r).toContain("gh pr create --body-file /tmp/pr.md");
    // The body content must not leak into the brief.
    expect(r).not.toContain("a very long PR body line");
  });

  it("previews the first meaningful body line of an interpreter heredoc", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "python3 - <<'PY'\nimport csv\ntotal = sum(1 for _ in open('data.csv'))\nprint(total)\nPY",
        output: "",
        exitCode: 0,
        sourceIndex: 6,
      },
    ];
    const r = compileBrief(blocks);
    // Opener alone is content-free; a preview of the real work must appear.
    expect(r).toContain("python3 - <<'PY'");
    expect(r).toContain("total = sum(1 for _ in open('data.csv'))");
    // Boilerplate import must be skipped as the preview.
    expect(r).not.toMatch(/<<'PY' import csv/);
  });

  it("previews a non-allowlisted interpreter heredoc (sqlite3) via the denylist", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "sqlite3 app.db <<'SQL'\nSELECT count(*) FROM users;\nSQL",
        output: "",
        exitCode: 0,
        sourceIndex: 7,
      },
    ];
    const r = compileBrief(blocks);
    // sqlite3 is not a file-writer, so its content-free opener gets a preview.
    expect(r).toContain("sqlite3 app.db <<'SQL'");
    expect(r).toContain("SELECT count(*) FROM users;");
  });

  it("previews an ssh remote-command heredoc body", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "ssh deploy@host <<'CMD'\nsudo systemctl restart api\nCMD",
        output: "",
        exitCode: 0,
        sourceIndex: 8,
      },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("ssh deploy@host <<'CMD'");
    expect(r).toContain("sudo systemctl restart api");
  });

  it("previews an interpreter heredoc combined with a redirect", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "python3 - <<'PY' > /tmp/out.sh\nprint('build config')\nPY\nbash /tmp/out.sh",
        output: "",
        exitCode: 0,
        sourceIndex: 9,
      },
    ];
    const r = compileBrief(blocks);
    // The `>` redirect must not suppress the body preview (old lookahead bug).
    expect(r).toContain("print('build config')");
    // The command after the heredoc terminator must survive.
    expect(r).toContain("bash /tmp/out.sh");
  });

  it("does not treat `<<` shift operators as a heredoc opener", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "n=$((1<<10))\ngit commit -m shift",
        output: "",
        exitCode: 0,
        sourceIndex: 10,
      },
    ];
    const r = compileBrief(blocks);
    // `1<<10` is a bit-shift, not a heredoc: the commit below must not be eaten.
    expect(r).toContain("git commit -m shift");
  });

  it("does not eat following commands when a `<<` has no closing terminator", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "bash",
        command: "echo \"see <<NOTE for details\"\nnpm run build",
        output: "",
        exitCode: 0,
        sourceIndex: 11,
      },
    ];
    const r = compileBrief(blocks);
    // `<<NOTE` has no closing `NOTE` line, so it is not a heredoc opener.
    expect(r).toContain("npm run build");
  });

  it("strips filler prefixes but preserves meaningful lead-ins", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Okay, I found the root cause." },
      { kind: "assistant", text: "Actually, the issue is in middleware." },
      { kind: "assistant", text: "Let me check the logs." },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("I found the root cause.");
    expect(r).toContain("the issue is in middleware.");
    expect(r).toContain("Let me check the logs.");
  });

  it("collapses tool calls to one-liners under [assistant]", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Let me check." },
      { kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts" } },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain('* Read "auth.ts"');
    expect(r).toContain('* Edit "auth.ts"');
    // Should merge into single [assistant] section
    const matches = r.match(/\[assistant\]/g);
    expect(matches?.length).toBe(1);
  });

  it("hides non-error tool results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "Read", text: "const x = 1;\nconst y = 2;\n// lots of code" },
    ];
    const r = compileBrief(blocks);
    expect(r).toBe("");
  });

  it("hides tool results regardless of output text", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "bash", text: "FAIL auth.test.ts\nexpected 200 got 401" },
    ];
    const r = compileBrief(blocks);
    expect(r).toBe("");
  });

  it("merges adjacent assistant sections", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "First part." },
      { kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
      // No user/tool_result between these — should merge
      { kind: "assistant", text: "Second part." },
      { kind: "tool_call", name: "Read", args: { file_path: "b.ts" } },
    ];
    const r = compileBrief(blocks);
    const matches = r.match(/\[assistant\]/g);
    expect(matches?.length).toBe(1);
  });

  it("does NOT merge assistant after user", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "First." },
      { kind: "user", text: "Next task." },
      { kind: "assistant", text: "Second." },
    ];
    const r = compileBrief(blocks);
    const matches = r.match(/\[assistant\]/g);
    expect(matches?.length).toBe(2);
  });

  it("truncates long user text", () => {
    const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: longText },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("(truncated)");
    expect(r).not.toContain("word299");
  });

  it("truncates segment-closing assistant text with head and tail", () => {
    const longText = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: longText },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("...(middle truncated)...");
    expect(r).toContain("word0");
    expect(r).toContain("word599");
    expect(r).not.toContain("word300");
  });

  it("truncates non-closing assistant text with head and tail", () => {
    const longText = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: longText },
      { kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
    ];
    const r = compileBrief(blocks);
    expect(r).toContain("...(middle truncated)...");
    expect(r).toContain("word0");
    expect(r).toContain("word599");
    expect(r).not.toContain("word300");
  });

  it("renders a realistic conversation flow", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "fix the login bug" },
      { kind: "assistant", text: "Let me investigate." },
      { kind: "tool_call", name: "Read", args: { file_path: "login.ts" } },
      { kind: "tool_result", name: "Read", text: "export function login() { ... }" },
      { kind: "tool_call", name: "bash", args: { command: "npm test" } },
      { kind: "tool_result", name: "bash", text: "FAIL: login test\nExpected true, got false" },
      { kind: "assistant", text: "The test is failing because..." },
      { kind: "tool_call", name: "Edit", args: { file_path: "login.ts" } },
      { kind: "tool_result", name: "Edit", text: "File edited successfully" },
      { kind: "user", text: "test lại đi" },
      { kind: "assistant", text: "Running tests again." },
      { kind: "tool_call", name: "bash", args: { command: "npm test" } },
      { kind: "tool_result", name: "bash", text: "All tests passed" },
    ];
    const r = compileBrief(blocks);

    // Check structure
    expect(r).toContain("[user]\nfix the login bug");
    expect(r).toContain('[assistant]\nLet me investigate.\n* Read "login.ts"');
    expect(r).toContain('* bash "npm test"');
    expect(r).toContain('The test is failing because...\n* Edit "login.ts"');
    expect(r).toContain("[user]\ntest lại đi");
    expect(r).toContain('[assistant]\nRunning tests again.\n* bash "npm test"');

    // Hidden content
    expect(r).not.toContain("think");
    expect(r).not.toContain("export function login");
    expect(r).not.toContain("File edited successfully");
    expect(r).not.toContain("All tests passed");
  });

  // ── noise filtering tests (aligned with VCC) ──









  it("suppresses blank lines between consecutive tool-only sections", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Checking files." },
      { kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
      { kind: "tool_result", name: "Read", text: "..." },
      // tool_result hidden → next tool_call starts new assistant section
      // but since both are tool-only, no blank line between
      { kind: "tool_call", name: "Read", args: { file_path: "b.ts" } },
      { kind: "tool_result", name: "Read", text: "..." },
    ];
    const r = compileBrief(blocks);
    // The first assistant section has text + tool, so it's NOT tool-only
    // The second would be tool-only but merges into the first (adjacent assistant)
    // So all under one [assistant]
    expect(r.match(/\[assistant\]/g)?.length).toBe(1);
  });

  it("caps tool calls per [assistant] turn at 8 (keep tail)", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Working." },
    ];
    for (let i = 1; i <= 12; i++) {
      blocks.push({ kind: "tool_call", name: "bash", args: { command: `echo ${i}` } });
    }
    const r = compileBrief(blocks);
    expect(r).toContain("(4 earlier tool-call entries omitted)");
    // Last 8 (5..12) kept; first 4 dropped
    expect(r).not.toContain("echo 1\"");
    expect(r).not.toContain("echo 4\"");
    expect(r).toContain("echo 5");
    expect(r).toContain("echo 12");
  });

  it("does not cap when tool calls per turn <= 8", () => {
    const blocks: NormalizedBlock[] = [{ kind: "assistant", text: "ok" }];
    for (let i = 1; i <= 8; i++) {
      blocks.push({ kind: "tool_call", name: "bash", args: { command: `c${i}` } });
    }
    const r = compileBrief(blocks);
    expect(r).not.toContain("entries omitted");
    expect(r).toContain("c1");
    expect(r).toContain("c8");
  });
});

describe("new codemode brief candidates", () => {
  it("keeps raw user/assistant text and uses the fixed tool line format", () => {
    const blocks = normalize([
      userMsg("Please keep THIS exact wording"),
      assistantWithToolCall("Read", { path: "src/a.ts" }),
      toolResult("Read", "body"),
    ]);
    const candidates = buildBriefCandidates(blocks);
    const user = candidates.find((c) => c.role === "user")!;
    expect(user.sourceText).toBe("Please keep THIS exact wording");
    expect(renderTextCandidate(user, user.sourceText.length)).toBe("Please keep THIS exact wording (#0)");
    const tool = candidates.find((c) => c.role === "tool")!;
    expect(renderToolCandidate(tool)).toBe("* Read \"src/a.ts\" (#1)");
  });

  it("uses goal/code navigation without the static name prefix and hides blocked text", () => {
    const code = codemodeScript("检查缓存", "await tools.read({ path: \"a\" });", false)
      .replace("// goal: 检查缓存", "// goal: 检查缓存\n// blocked: SECRET_BLOCKER");
    const blocks = normalize([codemodeCall(code)]);
    // The activity category comes from recorded nested calls, not the script text.
    blocks.push(...normalize([codemodeResult({
      toolCallId: "tc_codemode",
      calls: [nestedCall({ name: "write", arguments: { path: "a" } })],
    })]));
    const [tool] = buildBriefCandidates(blocks);
    expect(tool.tool!.normalNav).toBe("goal: 检查缓存");
    expect(tool.hint?.blocked).toBe("SECRET_BLOCKER");
    expect(tool.sourceText).not.toContain("SECRET_BLOCKER");
    expect(renderToolCandidate(tool)).toBe("* codemode goal: 检查缓存 (#0)");
    expect(tool.score).toBe(30 + 12 + 4 + 2); // mutation + recency + goal + blocked (last 25%)
  });

  it("falls back to a bounded code preview without a goal", () => {
    const code = `const marker = 1; ${"x".repeat(300)}`;
    const blocks = normalize([codemodeCall(code)]);
    const [tool] = buildBriefCandidates(blocks);
    expect(tool.tool!.normalNav.startsWith("code: ")).toBe(true);
    expect(tool.tool!.normalNav.length).toBeLessThanOrEqual("code: ".length + 80);
  });

  it("pairs each call with its own result inside the assistant message", () => {
    const blocks = normalize([
      codemodeCall(codemodeScript("read a", "await tools.read({path:\"a\"});", false), "c1"),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "read", arguments: { path: "a" } })] }),
      codemodeCall(codemodeScript("write b", "await tools.write({path:\"b\"});", false), "c1"),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "write", arguments: { path: "b" } })], isError: true }),
    ]);
    const tools = buildBriefCandidates(blocks).filter((c) => c.role === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0].evidence).toMatchObject({ category: "readonly", resultIndex: 1 });
    expect(tools[1].evidence).toMatchObject({ category: "mutation", resultIndex: 3, observedError: true });
    expect(renderToolCandidate(tools[1])).toContain("{error observed; result #3}");
  });

  it("does not pair a reused call id across the next assistant message", () => {
    const blocks = normalize([
      codemodeCall(codemodeScript("first", "await tools.read({path:\"a\"});", false), "c1"),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "read" })] }),
      codemodeCall(codemodeScript("second", "await tools.write({path:\"b\"});", false), "c1"),
      codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "write" })] }),
    ]);
    const tools = buildBriefCandidates(blocks).filter((c) => c.role === "tool");
    expect(tools[0].evidence?.resultIndex).toBe(1);
    expect(tools[1].evidence?.resultIndex).toBe(3);
  });

  it("penalizes consecutive identical activity except the newest", () => {
    const same = codemodeScript("repeat", "await tools.read({path:\"a\"});", false);
    const blocks = normalize([
      codemodeCall(same, "c1"), codemodeResult({ toolCallId: "c1", calls: [nestedCall({ name: "read" })] }),
      codemodeCall(same, "c2"), codemodeResult({ toolCallId: "c2", calls: [nestedCall({ name: "read" })] }),
    ]);
    const tools = buildBriefCandidates(blocks).filter((c) => c.role === "tool");
    expect(tools[0].score).toBe(tools[1].score - 24); // recency 12 + duplicate penalty 12
  });

  it("renders long text as head, omission marker and tail on grapheme boundaries", () => {
    const text = "A".repeat(200) + "👍🏽" + "B".repeat(200);
    const candidate = buildBriefCandidates([{ kind: "user", text, sourceIndex: 7 }])[0];
    const rendered = renderTextCandidate(candidate, 80);
    expect(rendered).toContain("(#7)");
    expect(rendered).toMatch(/\[omitted \d+ of 404 chars; recall #7\]/);
    expect(rendered).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
describe("H3: text candidates never render an isolated reference", () => {
  const whitespaceTexts = ["", " ", "\n", "  \t", "\r\n\t", "\u00a0", "\u3000\u2007"];

  it("T05: drops whitespace-only assistant candidates from raw blocks", () => {
    for (const text of whitespaceTexts) {
      const candidates = buildBriefCandidates([{ kind: "assistant", text, sourceIndex: 2 }]);
      expect(candidates).toEqual([]);
    }
  });

  it("T05: a whitespace text part does not hide the tool call in its message", () => {
    const msg = assistantWithToolCall("Read", { path: "src/a.ts" });
    const blocks = normalize([{
      ...msg,
      content: [{ type: "text", text: "\n  \t" }, ...(msg.content as any[])],
    } as any]);
    const candidates = buildBriefCandidates(blocks);
    expect(candidates.filter((c) => c.role === "assistant")).toEqual([]);
    expect(candidates.map((c) => c.role)).toEqual(["tool"]);
  });

  it("T06: a leading blank line keeps the ref on the first text line", () => {
    const candidate = buildBriefCandidates([{ kind: "user", text: "\nVisible text", sourceIndex: 7 }])[0];
    expect(renderTextCandidate(candidate, candidate.sourceText.length)).toBe("\nVisible text (#7)");
  });

  it("T06: indentation and trailing line breaks survive the ref", () => {
    const text = "  indented first line\nsecond line\n";
    const candidate = buildBriefCandidates([{ kind: "assistant", text, sourceIndex: 3 }])[0];
    expect(renderTextCandidate(candidate, candidate.sourceText.length)).toBe("  indented first line (#3)\nsecond line\n");
  });

  it("T06: an excerpted leading blank line still refs its first text line", () => {
    const text = "\n" + "x".repeat(500) + "TAIL_MARKER";
    const candidate = buildBriefCandidates([{ kind: "user", text, sourceIndex: 9 }])[0];
    const rendered = renderTextCandidate(candidate, 80);
    expect(rendered.split("\n")[0]).toBe("");
    const firstTextLine = rendered.split("\n").find((line) => line.trim().length > 0)!;
    expect(firstTextLine).toContain("(#9)");
    expect(firstTextLine).toMatch(/^x+/);
  });

  it("T07: a ref already written in the text is kept, with the source ref appended", () => {
    const candidate = buildBriefCandidates([{ kind: "user", text: "See the old note (#12) for details", sourceIndex: 7 }])[0];
    expect(renderTextCandidate(candidate, candidate.sourceText.length)).toBe("See the old note (#12) for details (#7)");
  });

  it("T07: a missing source index adds no ref", () => {
    const candidate = buildBriefCandidates([{ kind: "user", text: "\nno index here" }])[0];
    expect(renderTextCandidate(candidate, candidate.sourceText.length)).toBe("\nno index here");
  });

  it("T08: dropping whitespace candidates keeps the scoring formula on the filtered order", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix auth bug", sourceIndex: 0 },
      { kind: "assistant", text: "\n  \t", sourceIndex: 1 },
      { kind: "tool_call", name: "Read", args: { path: "src/a.ts" }, toolCallId: "c1", sourceIndex: 2 },
      { kind: "tool_result", name: "Read", text: "ok", toolCallId: "c1", isError: false, sourceIndex: 3 },
      { kind: "tool_call", name: "Edit", args: { path: "src/b.ts" }, toolCallId: "c2", sourceIndex: 4 },
      { kind: "tool_result", name: "Edit", text: "ok", toolCallId: "c2", isError: false, sourceIndex: 5 },
    ];
    const candidates = buildBriefCandidates(blocks);
    // The whitespace block is not a candidate; the two tools now hold r=0.5 and r=1.
    expect(candidates.map((c) => c.role)).toEqual(["user", "tool", "tool"]);
    const tools = candidates.filter((c) => c.role === "tool");
    expect(tools[0].score).toBe(6 + Math.round(12 * 0.5));
    expect(tools[1].score).toBe(30 + Math.round(12 * 1));
    // The block list itself is untouched: #N and the budget's block count do not move.
    expect(blocks).toHaveLength(6);
    expect(tools.map((c) => c.sourceIndex)).toEqual([2, 4]);
  });
});
describe("H1: the goal label stays on codemode lines", () => {
  const toolLine = (code: string) => buildBriefCandidates(normalize([codemodeCall(code)]))[0];

  it("T01: a short goal renders as goal: <text>", () => {
    const tool = toolLine(codemodeScript("Verify the login flow", "return 1;"));
    expect(tool.tool!.normalNav).toBe("goal: Verify the login flow");
    expect(renderToolCandidate(tool)).toBe("* codemode goal: Verify the login flow (#0)");
  });

  it("T01: a long goal keeps the 200-unit body and the 80-unit short line", () => {
    // The parser accepts values up to 200 units, so 200 is the largest goal
    // body the line can carry; the short navigation is the 80-unit excerpt.
    const goal = "g".repeat(200);
    const tool = toolLine(codemodeScript(goal, "return 1;"));
    expect(tool.tool!.normalNav).toBe(`goal: ${goal}`);
    expect(tool.tool!.shortNav).toHaveLength("goal: ".length + 80);
    expect(tool.tool!.shortNav.endsWith("…")).toBe(true);
    // Over the parser limit the marker is rejected; no goal line is invented.
    const over = toolLine(codemodeScript("g".repeat(201), "return 1;"));
    expect(over.tool!.normalNav.startsWith("code: ")).toBe(true);
  });

  it("T02: no goal falls back to the code preview, then to the bare tool name", () => {
    const codeOnly = toolLine("return 1;");
    expect(renderToolCandidate(codeOnly)).toBe("* codemode code: return 1; (#0)");
    const bare = buildBriefCandidates(normalize([assistantWithToolCall("codemode", {})]))[0];
    expect(bare.tool!.normalNav).toBe("");
    expect(renderToolCandidate(bare)).toBe("* codemode (#0)");
  });

  it("T03: a goal that starts with code: keeps its label and stays distinct", () => {
    const withGoal = toolLine(codemodeScript("code: return 1;", "return 1;"));
    const codeOnly = toolLine("return 1;");
    expect(renderToolCandidate(withGoal)).toBe("* codemode goal: code: return 1; (#0)");
    expect(renderToolCandidate(codeOnly)).toBe("* codemode code: return 1; (#0)");
    // B (an unlabeled goal line) is not used: these two must never coincide.
    expect(withGoal.tool!.normalNav).not.toBe(codeOnly.tool!.normalNav);
  });

  it("T04: a goal that claims success never hides an observed error", () => {
    const blocks = normalize([
      codemodeCall(codemodeScript("tests passed", "await tools.bash({ command: 'false' });")),
      codemodeResult({
        isError: true,
        text: "Script failed",
        calls: [nestedCall({ name: "bash", arguments: { command: "false" }, status: "error", error: "exit 1" })],
      }),
    ]);
    const [tool] = buildBriefCandidates(blocks);
    expect(tool.tool!.observedError).toBe(true);
    expect(renderToolCandidate(tool)).toContain("goal: tests passed");
    expect(renderToolCandidate(tool)).toContain("{error observed; result #1}");
  });
});
