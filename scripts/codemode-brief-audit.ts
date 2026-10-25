/**
 * Offline audit of the codemode brief on local Pi sessions.
 *
 * Reads session JSONL only; writes aggregate results to research/ (git-ignored)
 * and never prints message content. Usage:
 *
 *   bun run scripts/codemode-brief-audit.ts
 *   bun run scripts/codemode-brief-audit.ts --sessions <dir-or-file> --quota 0,400,800,1000,1200
 *   bun run scripts/codemode-brief-audit.ts --out research/codemode-brief-audit.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { homedir } from "os";
import { findCutPoint } from "@earendil-works/pi-coding-agent";
import { buildBriefSections, stringifyBrief, CODEMODE_SEGMENT_CHARS, type BriefLine } from "../src/core/brief";
import { BRIEF_MAX_LINES } from "../src/core/format";
import { normalize } from "../src/core/normalize";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { calibrateCharsPerToken, estimateMessageContentChars } from "../src/core/token-estimate";
import { applyTailBudget, buildOwnCut } from "../src/hooks/before-compact";
import { nestedFileOps, nestedFileOpsCount } from "../src/codemode/file-ops";
import type { Message } from "@earendil-works/pi-ai";

const SESSIONS_DEFAULT = join(homedir(), ".pi", "agent", "sessions");
const OUT_DEFAULT = join(process.cwd(), "research", "codemode-brief-audit.json");
const HOST_KEEP_RECENT_TOKENS = 20_000;
const BUDGET_FLOOR_TOKENS = 1100;
const BUDGET_CEILING_TOKENS = 2000;

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sessionPath = resolve(argValue("--sessions") ?? SESSIONS_DEFAULT);
const outPath = resolve(argValue("--out") ?? OUT_DEFAULT);
const quotas = (argValue("--quota") ?? `0,${CODEMODE_SEGMENT_CHARS}`)
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

interface SessionFile {
  file: string;
  entries: any[];
  branch: any[];
  messages: Message[];
  sourceIndices: Array<number | undefined>;
  hasContextEdit: boolean;
  previousSummary?: string;
  tokensBefore?: number;
}

const readSession = (file: string): SessionFile | null => {
  let entries: any[];
  try {
    entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return null;
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  let cursor = entries[entries.length - 1];
  const branch: any[] = [];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  branch.reverse();
  // Legacy files have no parent links; file order is the only branch view.
  if (!entries.some((e) => typeof e.parentId === "string" && e.parentId)) {
    branch.length = 0;
    branch.push(...entries);
  }

  const indexById = buildGlobalIndexById(entries);
  const messageEntries = branch.filter((e) => e.type === "message" && e.message && e.message.role !== "system");
  const messages = messageEntries.map((e) => e.message as Message);
  const sourceIndices = messageEntries.map((e) => indexById.get(e.id));
  const compactions = branch.filter((e) => e.type === "compaction" && typeof e.summary === "string");
  const lastCompaction = compactions[compactions.length - 1];
  return {
    file,
    entries,
    branch,
    messages,
    sourceIndices,
    hasContextEdit: branch.some((e) => e.type === "context_edit"),
    previousSummary: lastCompaction?.summary,
    tokensBefore: lastCompaction?.tokensBefore,
  };
};

const listSessionFiles = (path: string): string[] => {
  if (!existsSync(path)) return [];
  const out: string[] = [];
  const visit = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) visit(join(p, name));
    } else if (p.endsWith(".jsonl")) {
      out.push(p);
    }
  };
  visit(path);
  return out;
};

const isToolLine = (line: string): boolean =>
  line.startsWith("* ") && !/^\* \(\d+ earlier tool-call entries omitted/.test(line);
const isCodemodeLine = (line: string): boolean => /^\* codemode\b/i.test(line);
const lineRefs = (line: string): number[] => {
  const group = line.match(/\((#\d+(?:, #\d+)*)\)(?: x\d+)?$/)?.[1];
  return group ? [...group.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10)) : [];
};
const markerOf = (sections: BriefLine[]): string =>
  sections.flatMap((s) => s.lines).find((l) => l.includes("tool-call entries omitted")) ?? "";
const markerRange = (sections: BriefLine[]): [number, number] | undefined => {
  const m = markerOf(sections).match(/recall range:\[(\d+), (\d+)\]/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : undefined;
};
const lineCount = (lines: string[], predicate: (line: string) => boolean): number =>
  lines.filter(predicate).length;
const multiset = (lines: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
};
const droppedLines = (uncapped: BriefLine[], capped: BriefLine[]): string[] => {
  const kept = multiset(capped.flatMap((s) => s.lines));
  const dropped: string[] = [];
  for (const line of uncapped.flatMap((s) => s.lines)) {
    const n = kept.get(line) ?? 0;
    if (n > 0) kept.set(line, n - 1);
    else dropped.push(line);
  }
  return dropped;
};

const briefLines = (text: string): string[] => {
  const idx = text.indexOf("\n\n---\n");
  const brief = idx >= 0 ? text.slice(idx + "\n\n---\n".length) : text;
  return brief.split("\n").filter((l) => l.startsWith("* ") || l.startsWith("["));
};
const countRetained = (previous: string, next: string): number => {
  const nextSet = new Set(briefLines(next));
  return [...new Set(briefLines(previous))].filter((l) => nextSet.has(l)).length;
};

const result: any = {
  generatedAt: new Date().toISOString(),
  sessionsPath: sessionPath,
  quotas,
  sessions: { total: 0, withCodemode: 0, withCompactions: 0, withContextEdits: 0 },
  segments: {
    total: 0,
    capped: 0,
    withTextBetweenCalls: 0,
    toolLines: 0,
    codemodeLines: 0,
  },
  quota: {} as Record<string, {
    restored: number;
    remaining: number;
    addedChars: number;
    segmentsTouched: number;
    freshLines: number[];
  }>,
  references: { droppedCodemode: 0, covered: 0, uncovered: 0, missingRange: 0 },
  brief: [] as Array<{
    session: string;
    chars: number;
    budgetFloorChars: number;
    budgetCeilingChars: number;
    charsPerToken: number;
  }>,
  compactions: {
    count: 0,
    summaryChars: [] as number[],
    briefLines: [] as number[],
    budgetRatios: [] as number[],
    retentionPairs: [] as Array<{ previous: number; retained: number; ratio: number }>,
  },
  cut: {
    compared: 0,
    skippedContextEdits: 0,
    piVccShorter: 0,
    piVccLonger: 0,
    nestedFilesOnlyInPiVccWindow: 0,
    perSession: [] as Array<Record<string, unknown>>,
  },
};

for (const quota of quotas) {
  result.quota[String(quota)] = {
    restored: 0,
    remaining: 0,
    addedChars: 0,
    segmentsTouched: 0,
    freshLines: [],
  };
}

for (const file of listSessionFiles(sessionPath)) {
  const session = readSession(file);
  if (!session) continue;
  result.sessions.total++;
  if (!JSON.stringify(session.messages).includes('"name":"codemode"')) continue;
  result.sessions.withCodemode++;
  if (session.hasContextEdit) result.sessions.withContextEdits++;

  const blocks = normalize(session.messages, session.sourceIndices);
  const uncapped = buildBriefSections(blocks, { toolCallsPerTurn: Infinity });
  const base = buildBriefSections(blocks, { codemodeSegmentChars: 0 });
  const cappedByQuota = new Map<number, BriefLine[]>();
  for (const quota of quotas) {
    cappedByQuota.set(quota, buildBriefSections(blocks, { codemodeSegmentChars: quota }));
  }

  const lineChars = (lines: string[]): number => lines.reduce((sum, line) => sum + line.length + 1, 0);

  for (let si = 0; si < uncapped.length; si++) {
    const u = uncapped[si];
    const b = base[si];
    if (u.header !== "[assistant]") continue;
    result.segments.total++;
    result.segments.toolLines += lineCount(u.lines, isToolLine);
    result.segments.codemodeLines += lineCount(u.lines, isCodemodeLine);
    const marked = b.lines.some((l) => l.includes("tool-call entries omitted"));
    if (marked) result.segments.capped++;

    // Text lines between the first and last tool line mean the model narrated
    // between codemode calls, the shape where upstream does not merge lines.
    const toolIdxs = u.lines.map((l, i) => (isToolLine(l) ? i : -1)).filter((i) => i >= 0);
    if (toolIdxs.length > 1 &&
        u.lines.slice(toolIdxs[0] + 1, toolIdxs[toolIdxs.length - 1]).some((l) => !isToolLine(l))) {
      result.segments.withTextBetweenCalls++;
    }

    const droppedSection = droppedLines([u], [b]);
    const droppedCodemode = droppedSection.filter(isCodemodeLine);
    const range = markerRange([b]);
    result.references.droppedCodemode += droppedCodemode.length;
    for (const line of droppedCodemode) {
      const refs = lineRefs(line);
      if (refs.length === 0) continue;
      if (!range) {
        result.references.missingRange++;
        continue;
      }
      for (const ref of refs) {
        if (ref >= range[0] && ref <= range[1]) result.references.covered++;
        else result.references.uncovered++;
      }
    }

    for (const quota of quotas) {
      const q = cappedByQuota.get(quota)![si];
      const baseCm = lineCount(b.lines, isCodemodeLine);
      const quotaCm = lineCount(q.lines, isCodemodeLine);
      const restored = Math.max(0, quotaCm - baseCm);
      const remaining = Math.max(0, lineCount(u.lines, isCodemodeLine) - quotaCm);
      const bucket = result.quota[String(quota)];
      bucket.restored += restored;
      bucket.remaining += remaining;
      bucket.addedChars += Math.max(0, lineChars(q.lines) - lineChars(b.lines));
      if (restored > 0) bucket.segmentsTouched++;
    }
  }

  // Brief pressure: total chars against the ranked floor/ceiling at the
  // session's calibrated chars/token (falling back to the default 4).
  const sourceChars = session.messages.reduce((sum, m) => sum + estimateMessageContentChars(m.content), 0);
  const calibration = session.tokensBefore
    ? calibrateCharsPerToken(sourceChars + (session.previousSummary?.length ?? 0), session.tokensBefore)
    : { charsPerToken: 4 };
  const cpt = calibration.charsPerToken;
  const current = buildBriefSections(blocks);
  result.brief.push({
    session: basename(file),
    chars: stringifyBrief(current).length,
    budgetFloorChars: Math.round(BUDGET_FLOOR_TOKENS * cpt),
    budgetCeilingChars: Math.round(BUDGET_CEILING_TOKENS * cpt),
    charsPerToken: cpt,
  });

  // Merge pressure (N5): the fresh brief gets priority in the 120-line merge
  // budget, so its line count is the ceiling left for the previous summary.
  for (const quota of quotas) {
    const fresh = stringifyBrief(cappedByQuota.get(quota)!);
    result.quota[String(quota)].freshLines.push(fresh.split("\n").length);
  }

  const compactions = session.branch.filter((e) => e.type === "compaction" && typeof e.summary === "string");
  if (compactions.length > 0) {
    result.sessions.withCompactions++;
    for (let i = 0; i < compactions.length; i++) {
      const text = compactions[i].summary as string;
      result.compactions.count++;
      result.compactions.summaryChars.push(text.length);
      result.compactions.briefLines.push(briefLines(text).length);
      // Stored summary against the ranked ceiling at this session's
      // calibrated chars/token (upper bound: 2000 tokens).
      result.compactions.budgetRatios.push(
        text.length / (BUDGET_CEILING_TOKENS * cpt),
      );
      if (i > 0) {
        const previousLines = briefLines(compactions[i - 1].summary as string).length;
        const retained = countRetained(compactions[i - 1].summary as string, text);
        result.compactions.retentionPairs.push({
          previous: previousLines,
          retained,
          ratio: previousLines > 0 ? retained / previousLines : 0,
        });
      }
    }
  }

  // Cut comparison (first compaction of the active branch). Context edits need
  // Pi's projection, which this offline script does not rebuild.
  if (session.hasContextEdit) {
    result.cut.skippedContextEdits++;
  } else if (session.branch.length > 3) {
    try {
      const own = applyTailBudget(session.branch, buildOwnCut(session.branch, 1));
      // Host starts its walk after the newest compaction; approximate that
      // boundary here (projection is skipped above for context-edited sessions).
      const lastCompaction = session.branch.map((e) => e.type).lastIndexOf("compaction");
      const hostStart = lastCompaction >= 0 ? lastCompaction + 1 : 0;
      const host = findCutPoint(session.branch, hostStart, session.branch.length, HOST_KEEP_RECENT_TOKENS);
      const hostFirst = session.branch[host.firstKeptEntryIndex]?.id;
      if (own.ok && own.firstKeptEntryId && hostFirst) {
        const oursIdx = session.branch.findIndex((e) => e.id === own.firstKeptEntryId);
        const hostIdx = session.branch.findIndex((e) => e.id === hostFirst);
        result.cut.compared++;
        const delta = oursIdx - hostIdx;
        if (delta < 0) result.cut.piVccShorter++;
        else if (delta > 0) result.cut.piVccLonger++;
        // Messages pi-vcc summarizes but the host would keep.
        const extra = delta < 0
          ? session.branch.slice(oursIdx, hostIdx)
              .filter((e) => e.type === "message" && e.message)
              .map((e) => e.message as Message)
          : [];
        const nested = nestedFileOps(extra);
        result.cut.nestedFilesOnlyInPiVccWindow += nestedFileOpsCount(nested);
        result.cut.perSession.push({
          session: basename(file),
          ours: oursIdx,
          host: hostIdx,
          delta,
          nestedFilesOnlyInPiVccWindow: nestedFileOpsCount(nested),
        });
      }
    } catch {
      // A host without findCutPoint or an incompatible branch shape is skipped.
    }
  }
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const summary = {
  sessions: result.sessions,
  segments: result.segments,
  quota: Object.fromEntries(Object.entries(result.quota).map(([q, v]: [string, any]) => [
    q,
    {
      ...v,
      discardBefore: result.references.droppedCodemode,
      discardAfter: v.remaining,
      discardRateAfter: result.segments.codemodeLines > 0
        ? Number((v.remaining / result.segments.codemodeLines).toFixed(3))
        : 0,
      medianFreshLines: median(v.freshLines),
      medianOldLinesBudget: median(v.freshLines.map((n: number) => Math.max(0, BRIEF_MAX_LINES - n))),
      sessionsFreshAtOrOverBudget: v.freshLines.filter((n: number) => n >= BRIEF_MAX_LINES).length,
    },
  ])),
  references: {
    ...result.references,
    coverage: result.references.covered + result.references.uncovered > 0
      ? Number((result.references.covered / (result.references.covered + result.references.uncovered)).toFixed(3))
      : null,
  },
  brief: {
    sessions: result.brief.length,
    medianChars: median(result.brief.map((b: any) => b.chars)),
    overCeiling: result.brief.filter((b: any) => b.chars > b.budgetCeilingChars).length,
    underFloor: result.brief.filter((b: any) => b.chars < b.budgetFloorChars).length,
    note: "whole active branch without ranked selection; see compactions.budgetRatio for stored summaries",
  },
  compactions: {
    count: result.compactions.count,
    medianSummaryChars: median(result.compactions.summaryChars),
    medianBriefLines: median(result.compactions.briefLines),
    medianBudgetRatio: median(result.compactions.budgetRatios),
    overCeiling: result.compactions.budgetRatios.filter((r: number) => r > 1).length,
    retentionMedian: median(result.compactions.retentionPairs.map((p: any) => p.ratio)),
    retentionPairs: result.compactions.retentionPairs.length,
  },
  cut: {
    compared: result.cut.compared,
    skippedContextEdits: result.cut.skippedContextEdits,
    piVccShorter: result.cut.piVccShorter,
    piVccLonger: result.cut.piVccLonger,
    nestedFilesOnlyInPiVccWindow: result.cut.nestedFilesOnlyInPiVccWindow,
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ summary, ...result }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath}`);
