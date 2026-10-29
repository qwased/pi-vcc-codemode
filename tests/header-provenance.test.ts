import { describe, expect, test } from "bun:test";
import { compileRankedWithDetail } from "../src/core/summarize";
import { buildBriefHistory } from "../src/core/brief-history";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { normalize } from "../src/core/normalize";
import { HEADER_NAMES, HISTORICAL_NOTE, wrapLongLines } from "../src/core/format";
import { assistantText, userMsg } from "./fixtures";
import { codemodeCall, codemodeResult, codemodeScript } from "./codemode-fixtures";

export const HEADER_CONTEXT_NOTE =
  "Historical headers: user intent and recorded file operations, not current state or a verified diff.";

const entry = (id: string, message: unknown) => ({ id, type: "message", message });
const chain = (entries: any[]) => {
  let parentId: string | undefined;
  return entries.map((item) => {
    const out = { ...item, parentId };
    parentId = item.id;
    return out;
  });
};

const codemodeHistory = (withUserText: boolean) =>
  buildBriefHistory({
    branchEntries: chain([
      ...(withUserText ? [entry("u1", userMsg("Task: ship the synthetic change without committing it"))] : []),
      entry("c1", codemodeCall(codemodeScript("ship the synthetic change", "const a = 1;"))),
      entry("cr1", codemodeResult()),
    ]),
    globalIndexById: undefined,
  });

const budgetFor = (history: ReturnType<typeof codemodeHistory>): number =>
  Math.round(
    Math.min(2000, Math.max(1100, 15 * normalize(history.messages as any, history.sourceIndices).length)) * 4,
  );

const compile = (history: ReturnType<typeof codemodeHistory>, extra: Record<string, unknown> = {}) =>
  compileRankedWithDetail({
    messages: [],
    sourceIndices: [],
    briefHistory: history,
    briefBudgetChars: budgetFor(history),
    ...extra,
  });

const previousAllSections = [
  "[Session Goal]",
  "- ship the synthetic change",
  "",
  "[Files And Changes]",
  "- Modified: src/core/rank.ts",
  "",
  "[Commits]",
  "- deadbee keep this commit",
  "",
  "[Tracked Commands]",
  "- bun: test",
  "",
  "[User Preferences]",
  "- prefer short reports",
].join("\n");

const noteCount = (summary: string): number => summary.split(HEADER_CONTEXT_NOTE).length - 1;

describe("H4: header provenance note", () => {
  test("is rendered exactly once, before the first title", () => {
    const history = codemodeHistory(true);
    const { summary, detail } = compile(history, { previousSummary: previousAllSections });
    expect(noteCount(summary)).toBe(1);
    const lines = summary.split("\n");
    const noteLine = lines.findIndex((line) => line.startsWith(HEADER_CONTEXT_NOTE));
    const firstTitle = lines.findIndex((line) => /^\[[A-Z][^\]]*\]$/.test(line));
    expect(noteLine).toBeGreaterThanOrEqual(0);
    expect(noteLine).toBeLessThan(firstTitle);
    // The real section titles are unchanged: the note is not a section.
    for (const name of detail.headerNames) expect(HEADER_NAMES).toContain(name as any);
    expect(detail.headerNames).toContain("Session Goal");
    // The ending reading note is untouched (one copy, 395 units).
    expect(summary.split(wrapLongLines(HISTORICAL_NOTE)).length - 1).toBe(1);
    expect(HISTORICAL_NOTE.length).toBe(395);
  });

  test("is charged to the 20% header budget", () => {
    const history = codemodeHistory(true);
    for (const budget of [1000, 1200, 2200, 4400]) {
      const { summary, detail } = compile(history, { previousSummary: previousAllSections, briefBudgetChars: budget });
      const cap = Math.floor((budget - detail.noteChars - 7) * 0.2);
      expect(detail.headerChars).toBeLessThanOrEqual(cap);
      // The annotation opens the header; when the header is narrower than the
      // annotation the existing clip rule shortens it but never moves it.
      expect(summary.startsWith("Historical ")).toBe(true);
      if (budget >= 1200) {
        expect(summary.startsWith(`${HEADER_CONTEXT_NOTE}\n`)).toBe(true);
      }
      // At 1,000 chars the annotation alone fills the header: no section fits.
      if (budget === 1000) expect(detail.headerNames).toEqual([]);
    }
  });

  test("no header means no note", () => {
    const history = codemodeHistory(false);
    const { summary, detail } = compile(history);
    expect(detail.headerChars).toBe(0);
    expect(noteCount(summary)).toBe(0);
    expect(summary).not.toContain("Historical headers:");
  });

  test("a very narrow header keeps the note, never a fake section title", () => {
    const history = codemodeHistory(true);
    const { summary, detail } = compile(history, { previousSummary: previousAllSections, briefBudgetChars: 610 });
    expect(detail.headerChars).toBeGreaterThan(0);
    expect(detail.headerNames).toEqual([]);
    // The annotation is clipped by the existing single-item rule, and the
    // remainder is only the counted omission marker: no title is invented.
    expect(summary.startsWith("Historical ")).toBe(true);
    expect(summary).toContain("header lines omitted)");
    for (const name of HEADER_NAMES) expect(detail.headerNames).not.toContain(name);
  });
});

describe("H4: repeated compactions do not stack the note", () => {
  test("0.1.5 summary read back by 0.1.5 keeps one note", () => {
    const history = codemodeHistory(true);
    const first = compile(history, { previousSummary: previousAllSections });
    const second = compile(history, { previousSummary: first.summary });
    expect(noteCount(second.summary)).toBe(1);
    expect(second.summary.split(wrapLongLines(HISTORICAL_NOTE)).length - 1).toBe(1);
    expect(second.detail.headerNames).toContain("Session Goal");
  });

  test("an 0.1.4 summary (no note) gains one on the first 0.1.5 compaction", () => {
    const history = codemodeHistory(true);
    const { summary } = compile(history, { previousSummary: previousAllSections });
    expect(noteCount(summary)).toBe(1);
  });

  test("the legacy path never adds the note", () => {
    const { summary, detail } = compileRankedWithDetail({
      messages: [userMsg("legacy task"), assistantText("legacy answer")],
      previousSummary: previousAllSections,
    });
    expect(detail.kind).toBe("legacy");
    expect(noteCount(summary)).toBe(0);
  });

  test("a stored 0.1.5 header fed to the legacy path does not imitate a section", () => {
    const history = codemodeHistory(true);
    const first = compile(history, { previousSummary: previousAllSections });
    const legacy = compileRankedWithDetail({
      messages: [userMsg("next legacy task"), assistantText("legacy answer")],
      previousSummary: first.summary,
    });
    expect(legacy.detail.kind).toBe("legacy");
    expect(legacy.summary).not.toContain("Historical headers:");
    expect(legacy.detail.headerNames).toContain("Session Goal");
    expect(legacy.detail.headerNames).not.toContain("Historical headers");
  });
});

describe("H4: the note does not become state", () => {
  test("an old uncommitted claim is not rewritten", () => {
    const history = codemodeHistory(true);
    const { summary } = compile(history, {
      previousSummary: "[Session Goal]\n- the change is uncommitted\n- next: run the tests",
    });
    expect(summary).toContain("- the change is uncommitted");
    // A source reminder only; no invented current state.
    expect(summary).not.toMatch(/now committed|already committed|committed successfully/i);
    expect(noteCount(summary)).toBe(1);
  });

  test("a fresh report enters the body and the note stays", () => {
    const report = "Synthetic report: the allocator now folds the oldest continuous range. ".repeat(20);
    const history = buildBriefHistory({
      branchEntries: chain([
        entry("u1", userMsg("Task: verify the synthetic allocator")),
        entry("c1", codemodeCall(codemodeScript("verify the allocator", "const b = 2;"))),
        entry("cr1", codemodeResult()),
        entry("a1", assistantText(report)),
        entry("u2", userMsg("Next: summarize")),
      ]),
      globalIndexById: undefined,
    });
    const { summary, detail } = compile(history, { previousSummary: previousAllSections });
    expect(detail.headerNames).toContain("Session Goal");
    expect(noteCount(summary)).toBe(1);
    expect(summary).toContain("[assistant]");
  });
});
