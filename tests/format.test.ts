import { describe, it, expect } from "bun:test";
import { formatSummary, trimHeaderToBudget } from "../src/core/format";
import type { SectionData } from "../src/sections";

const empty: SectionData = {
  sessionGoal: [],
  outstandingContext: [],
  filesAndChanges: [],
  commits: [],
  userPreferences: [],
  trackedCommands: [],
  briefTranscript: "",
};

describe("formatSummary", () => {
  it("returns empty string for all-empty sections", () => {
    expect(formatSummary(empty)).toBe("");
  });

  it("formats a single header section", () => {
    const data = {
      ...empty,
      sessionGoal: ["fix auth bug"],
    };
    const r = formatSummary(data);
    expect(r).toContain("[Session Goal]");
    expect(r).toContain("- fix auth bug");
  });

  it("separates header and brief transcript with ---", () => {
    const data = {
      ...empty,
      sessionGoal: ["goal"],
      briefTranscript: "[user]\ndo something",
    };
    const r = formatSummary(data);
    expect(r).toContain("[Session Goal]");
    expect(r).toContain("---");
    expect(r).toContain("[user]\ndo something");
  });

  it("renders brief transcript alone when no header sections", () => {
    const data = {
      ...empty,
      briefTranscript: "[user]\nhi\n\n[assistant]\nhello",
    };
    const r = formatSummary(data);
    expect(r).toContain("[user]\nhi\n\n[assistant]\nhello");
  });

  it("joins multiple header sections with blank line", () => {
    const data = {
      ...empty,
      sessionGoal: ["goal"],
      outstandingContext: ["blocker"],
    };
    const r = formatSummary(data);
    expect(r).toContain("[Session Goal]");
    expect(r).toContain("[Outstanding Context]");
    expect(r).toContain("\n\n");
  });

  it("wraps long lines so compaction TUI rendering stays bounded", () => {
    const data = {
      ...empty,
      briefTranscript: `[assistant]\n${"word ".repeat(80)}`,
    };
    const r = formatSummary(data);
    expect(Math.max(...r.split("\n").map((line) => line.length))).toBeLessThanOrEqual(120);
  });
});

describe("trimHeaderToBudget", () => {
  const headers = [
    "[Session Goal]",
    "- fix the billing migration",
    "[Files And Changes]",
    "- Modified: src/billing.ts",
    "- Read: src/queue.ts",
  ].join("\n");

  it("leaves a header that already fits untouched", () => {
    const result = trimHeaderToBudget(headers, 1000);
    expect(result).toEqual({ text: headers, usedChars: headers.length, truncated: false, omittedItems: 0 });
  });

  it("trims at whole-line boundaries with a counted marker", () => {
    const result = trimHeaderToBudget(headers, 70);
    expect(result.truncated).toBe(true);
    expect(result.usedChars).toBeLessThanOrEqual(70);
    expect(result.omittedItems).toBeGreaterThan(0);
    expect(result.text).toContain("header line");
    expect(result.text).toContain("[Session Goal]");
  });

  it("clips a single overlong item at a grapheme boundary instead of dropping it", () => {
    const long = `- ${"中".repeat(200)}👍🏽`;
    const result = trimHeaderToBudget(long, 40);
    expect(result.truncated).toBe(true);
    expect(result.usedChars).toBeLessThanOrEqual(40);
    expect(result.text).toContain("…");
    expect(result.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("returns an empty header only when even the marker cannot fit", () => {
    const result = trimHeaderToBudget(headers, 5);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(true);
  });
});
