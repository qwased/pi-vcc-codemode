import { describe, expect, test } from "bun:test";
import { buildBriefCandidates, renderTextCandidate, type BriefCandidate } from "../src/core/brief";
import { capBrief } from "../src/core/format";
import { compileRankedWithDetail } from "../src/core/summarize";
import { buildBriefHistory } from "../src/core/brief-history";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { normalize } from "../src/core/normalize";
import { assistantText, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript } from "./codemode-fixtures";

// ── independent fence oracle (deliberately not shared with src) ───────────
// CommonMark-ish: 0-3 spaces, then >=3 backticks or tildes. A backtick
// opener's info string cannot contain a backtick. A closer needs the same
// character, at least the opener's length, and an empty info string.
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

interface Fence {
  char: "`" | "~";
  length: number;
  info: string;
}

const parse = (line: string): Fence | null => {
  const m = line.match(FENCE_RE);
  if (!m) return null;
  const run = m[2];
  const info = m[3];
  if (run[0] === "`" && info.includes("`")) return null;
  return { char: run[0] as "`" | "~", length: run.length, info: info.trim() };
};

/** State before each line, plus the state after the last one. */
const depthAt = (text: string): { before: number[]; after: number } => {
  let open: Fence | null = null;
  const before: number[] = [];
  for (const line of text.split("\n")) {
    before.push(open ? 1 : 0);
    const f = parse(line);
    if (!f) continue;
    if (!open) {
      open = f;
    } else if (f.char === open.char && f.length >= open.length && f.info === "") {
      open = null;
    }
  }
  return { before, after: open ? 1 : 0 };
};

// A fence run shorter than the open one is code content, not a closer, so
// "even number of fence lines" is the wrong test: walk the same open/close rule
// and require the text to end outside a fence. A bare closer at depth 0 opens a
// new block, which also fails here.
const isBalanced = (text: string): boolean => depthAt(text).after === 0;

const fenceLines = (text: string): string[] => text.split("\n").filter((line) => parse(line) !== null);
const lineOf = (text: string, snippet: string): number =>
  text.split("\n").findIndex((line) => line.includes(snippet));
const depthOfSnippet = (text: string, snippet: string): number => {
  const at = lineOf(text, snippet);
  if (at < 0) throw new Error(`missing snippet: ${snippet}`);
  return depthAt(text).before[at];
};

// ── synthetic inputs ─────────────────────────────────────────────────────

/** The defect report §3.2 shape: 2,070 chars, keep 640, closer inside the omission. */
const reportText = (): string => {
  const long = "评审文档的结论是这六件事都不是必须的，真正值得做的只有两三件，其中两件是小改动。".repeat(40);
  return [
    "## 模型侧：一行，位置在 Nested tools: 之前",
    "",
    "先说明背景，这段占了大约两百多字符，用来把 fence 的开口推到 head 截断点之前。",
    "",
    "```ts",
    'const ABRIDGED_NOTICE = "When a tool has a hint level, this is a hint only.";',
    ...Array.from({ length: 10 }, (_, i) => `const padded${i} = ${i}; // filler`),
    "```",
    "",
    long,
    "",
    "尾部：最后一次说明。",
  ].join("\n");
};

const candidateOf = (text: string, sourceIndex = 16): BriefCandidate =>
  buildBriefCandidates([{ kind: "assistant", text, sourceIndex } as any])[0];

const excerpt = (text: string, keep: number, sourceIndex = 16): string =>
  renderTextCandidate(candidateOf(text, sourceIndex), keep);

/** A body of ~48-char lines with an opener at line `openLine` and a closer at `closeLine`. */
const fencedLines = (total: number, openLine: number, closeLine: number): string => {
  const lines = Array.from({ length: total }, (_, i) => `line ${i} ${"x".repeat(40)}`);
  lines.splice(closeLine, 0, "```");
  lines.splice(openLine, 0, "```ts");
  return lines.join("\n");
};

// ── P0: excerpt fences ───────────────────────────────────────────────────

describe("excerptText: head cut inside a fence", () => {
  test("closes the head fence so the omission marker stays outside", () => {
    const text = reportText();
    const out = excerpt(text, 640);
    expect(text.length).toBeGreaterThan(2000);
    expect(isBalanced(out)).toBe(true);
    expect(depthOfSnippet(out, "[omitted")).toBe(0);
    // The head is closed before the marker, not after it.
    const lines = out.split("\n");
    const marker = lines.findIndex((line) => line.includes("[omitted"));
    expect(parse(lines[marker - 1])).not.toBeNull();
    expect(parse(lines[marker - 1])!.info).toBe("");
  });
});

describe("excerptText: tail cut inside the same fence", () => {
  test("reopens the fence after the marker and keeps the original closer", () => {
    const text = fencedLines(90, 5, 86);
    expect(text.length).toBeGreaterThan(4000);
    const out = excerpt(text, 800);
    expect(isBalanced(out)).toBe(true);
    expect(depthOfSnippet(out, "[omitted")).toBe(0);
    const lines = out.split("\n");
    const marker = lines.findIndex((line) => line.includes("[omitted"));
    const opener = lines.slice(marker + 1).findIndex((line) => parse(line) !== null);
    expect(opener).toBe(0);
    const reopened = parse(lines[marker + 1])!;
    expect(reopened.char).toBe("`");
    expect(reopened.info).toBe("ts");
  });

  test("does not reopen when the tail starts after the fence", () => {
    const text = fencedLines(90, 5, 60);
    const out = excerpt(text, 800);
    const lines = out.split("\n");
    const marker = lines.findIndex((line) => line.includes("[omitted"));
    // The closer is inside the omitted region; the tail must be plain prose.
    expect(depthOfSnippet(out, "[omitted")).toBe(0);
    const firstTail = lines.slice(marker + 1).find((line) => line.trim().length > 0)!;
    expect(parse(firstTail)).toBeNull();
    expect(isBalanced(out)).toBe(true);
  });
});

describe("excerptText: an unclosed source fence", () => {
  test("is closed at the end of the excerpt", () => {
    const text = "# report\n\n```ts\nconst a = 1;\n" + "filler prose ".repeat(80);
    const out = excerpt(text, 200);
    const last = out.split("\n").filter((line) => line.trim().length > 0).pop()!;
    expect(parse(last)?.info).toBe("");
    expect(isBalanced(out)).toBe(true);
  });

  test("a full keep of an unclosed source is also closed", () => {
    const text = "# report\n\n```ts\nconst a = 1;\nno closer here";
    const out = excerpt(text, text.length);
    expect(isBalanced(out)).toBe(true);
    expect(depthAt(out).after).toBe(0);
  });
});

// ── P0: attachRef must not land in an info string ────────────────────────

describe("attachRef: message starting with a fence line", () => {
  test("puts the ref outside the fence, never in the info string", () => {
    const text = "```ts\nconst a = 1;\n```\nafter the block";
    const out = excerpt(text, text.length, 9);
    expect(out).not.toContain("```ts (#9)");
    expect(out.split("\n")[0]).toBe("```ts");
    expect(depthOfSnippet(out, "#9")).toBe(0);
    expect(isBalanced(out)).toBe(true);
  });

  test("keeps the 0.1.4 position for ordinary text", () => {
    const out = excerpt("first line\nsecond line", 1000, 7);
    expect(out.split("\n")[0]).toBe("first line (#7)");
  });
});

// ── P0: legacy line cap must not leave a naked closer ────────────────────

describe("capBrief: cutting inside a fence", () => {
  test("drops the orphan closer and recounts the omission", () => {
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) lines.push(`prose ${i}`);
    lines.push("```ts", "code line", "```", "after prose");
    for (let i = 0; i < 117; i++) lines.push(`tail ${i}`);
    const out = capBrief(lines.join("\n"));
    expect(fenceLines(out)).toHaveLength(0);
    expect(depthAt(out).after).toBe(0);
    expect(out).toContain("(11 earlier lines omitted)");
    expect(out).toContain("after prose");
  });

  test("leaves a retained balanced fence untouched", () => {
    const lines: string[] = [];
    for (let i = 0; i < 70; i++) lines.push(`prose ${i}`);
    lines.push("```ts", "code line", "```");
    for (let i = 0; i < 117; i++) lines.push(`tail ${i}`);
    const out = capBrief(lines.join("\n"));
    expect(isBalanced(out)).toBe(true);
    expect(out).toContain("```ts");
    expect(out).toContain("(70 earlier lines omitted)");
  });
});

// ── P0: integration, the whole summary must stay outside the fence ───────

describe("codemode brief: structure lines stay outside fences", () => {
  test("[user]/[assistant]/codemode goal/note are all at depth 0", () => {
    // A fence opening at the very start of the newest long text: the excerpt
    // head cut lands inside it, and the closer is far inside the omission.
    const longReport = ["```ts", ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`), "```", "synthetic tail prose ".repeat(40)].join("\n");
    const note = "synthetic assistant note ".repeat(60);
    const entries: any[] = [
      { id: "u1", type: "message", message: userMsg("Task: read the long report and verify.") },
      { id: "c1", type: "message", message: codemodeCall(codemodeScript("read the synthetic report", "const q = 1;")) },
      { id: "cr1", type: "message", message: codemodeResult() },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`,
        type: "message",
        message: assistantText(i === 19 ? longReport : `${note} part ${i}`),
      })),
      { id: "u2", type: "message", message: userMsg("Task: now record the conclusion.") },
    ];
    let parentId: string | undefined;
    const chain = entries.map((e) => {
      const out = { ...e, parentId };
      parentId = e.id;
      return out;
    });
    const history = buildBriefHistory({ branchEntries: chain, globalIndexById: buildGlobalIndexById(chain) });
    const budget = Math.round(
      Math.min(2000, Math.max(1100, 15 * normalize(history.messages as any, history.sourceIndices).length)) * 4,
    );
    const { summary } = compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: budget,
    });
    expect(summary.length).toBeGreaterThan(0);
    expect(isBalanced(summary)).toBe(true);
    for (const snippet of ["[user]", "[assistant]", "* codemode goal:", "Historical navigation"]) {
      expect(depthOfSnippet(summary, snippet)).toBe(0);
    }
    // A fence opener line never carries the (#N) ref in its info string.
    for (const line of summary.split("\n")) {
      if (parse(line) !== null) expect(line).not.toMatch(/\(#\d+\)/);
    }
  });
});

// ── P0: fence primitives (import the module under test) ─────────────────
import { closeUnclosedFences, dropOrphanClosers, parseFenceLine } from "../src/core/fences";

describe("fence primitives", () => {
  test("0-3 spaces are a fence, 4 spaces are not", () => {
    expect(parseFenceLine("```ts")).not.toBeNull();
    expect(parseFenceLine(" ```ts")).not.toBeNull();
    expect(parseFenceLine("   ```ts")).not.toBeNull();
    expect(parseFenceLine("    ```ts")).toBeNull();
  });

  test("tildes are fences and may carry a backtick in their info string", () => {
    expect(parseFenceLine("~~~ts")?.char).toBe("~");
    expect(parseFenceLine("```code `x`")).toBeNull();
    expect(parseFenceLine("~~~code `x`")?.info).toBe("code `x`");
  });

  test("a longer run closes, a shorter one does not", () => {
    const longer = closeUnclosedFences("```ts\ncode\n`````");
    expect(longer.appendedChars).toBe(0);
    const shorter = closeUnclosedFences("````ts\ncode\n```");
    expect(shorter.appendedChars).toBeGreaterThan(0);
    expect(isBalanced(shorter.text)).toBe(true);
  });

  test("closing is idempotent and respects an existing newline", () => {
    const first = closeUnclosedFences("```ts\ncode");
    expect(first.text).toBe("```ts\ncode\n```");
    expect(closeUnclosedFences(first.text).appendedChars).toBe(0);
    const withNewline = closeUnclosedFences("```ts\ncode\n");
    expect(withNewline.text).toBe("```ts\ncode\n```");
  });

  test("dropOrphanClosers removes only a closer for the dropped opener", () => {
    expect(dropOrphanClosers("prose\n```ts\n", ["```", "after"])).toEqual(["after"]);
    expect(dropOrphanClosers("prose\n", ["```", "after"])).toEqual(["```", "after"]);
  });
});

describe("excerptText: cut exactly on a fence boundary", () => {
  test("a head that ends after the closer gets no second closer", () => {
    // Head keeps the whole block; the closer is the last retained line.
    const text = "```ts\n" + "const a = 1;\n".repeat(3) + "```\n" + "tail prose ".repeat(200);
    const out = excerpt(text, 120);
    const lines = out.split("\n");
    const marker = lines.findIndex((line) => line.includes("[omitted"));
    const headFences = lines.slice(0, marker).filter((line) => parseFenceLine(line) !== null);
    expect(headFences).toHaveLength(2);
    expect(depthOfSnippet(out, "[omitted")).toBe(0);
  });

  test("a tail that starts on the opener line does not get a duplicate opener", () => {
    const text = "head prose ".repeat(300) + "\n```ts\n" + "const b = 2;\n".repeat(2) + "```\nend";
    const out = excerpt(text, 120);
    const lines = out.split("\n");
    const marker = lines.findIndex((line) => line.includes("[omitted"));
    const reopened = lines.slice(marker + 1).filter((line) => parseFenceLine(line)?.info === "ts");
    expect(reopened.length).toBeLessThanOrEqual(1);
    expect(isBalanced(out)).toBe(true);
  });
});
