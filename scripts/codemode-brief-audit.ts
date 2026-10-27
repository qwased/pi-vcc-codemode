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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { homedir, tmpdir } from "os";
import { findCutPoint } from "@earendil-works/pi-coding-agent";
import { buildBriefSections, stringifyBrief, CODEMODE_SEGMENT_CHARS, type BriefLine } from "../src/core/brief";
import { BRIEF_MAX_LINES, HISTORICAL_NOTE, wrapLongLines } from "../src/core/format";
import { normalize } from "../src/core/normalize";
import { buildGlobalIndexById } from "../src/core/global-indices";
import { calibrateCharsPerToken, estimateMessageContentChars } from "../src/core/token-estimate";
import { applyTailBudget, buildOwnCut } from "../src/hooks/before-compact";
import { nestedFileOps, nestedFileOpsCount } from "../src/codemode/file-ops";
import { compileRanked, compileRankedWithDetail, type RankedCompileInput } from "../src/core/summarize";
import { buildBriefHistory, briefHistoryHasCodemode } from "../src/core/brief-history";
import { isCodemodeMessage } from "../src/codemode/active";
import { fullViewOfMessage, readSavedRecord, scanSavedFields } from "../src/core/recall-full";
import type { Message } from "@earendil-works/pi-ai";

/**
 * Injection seam for measurement: the audit must exercise the same compile
 * function production uses, and callers may substitute it in tests. Never
 * re-implement selection here.
 */
export type BriefCompile = (input: RankedCompileInput) => string;

export const compileBriefWindow = (
  input: RankedCompileInput,
  compileFn: BriefCompile = compileRanked,
): { summary: string; chars: number } => {
  const summary = compileFn(input);
  return { summary, chars: summary.length };
};

export interface SyntheticWindowSpec {
  turns: number;
  codemode?: boolean;
  textChars?: number;
}

const syntheticAssistant = (content: any[], stopReason: "toolUse" | "stop"): Message => ({
  role: "assistant",
  content,
  api: "messages" as any,
  provider: "synthetic" as any,
  model: "synthetic",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason,
  timestamp: 0,
} as unknown as Message);

/**
 * Deterministic window for scenario gates. Content is synthetic and stays in
 * memory; the audit only records counts and sizes, never message text.
 */
export const buildSyntheticWindow = (spec: SyntheticWindowSpec): { messages: Message[]; sourceIndices: number[] } => {
  const turns = Math.max(0, Math.floor(spec.turns));
  const filler = "x".repeat(Math.max(16, Math.floor(spec.textChars ?? 160)));
  const messages: Message[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: "user", content: `user ${i} ${filler}`, timestamp: i } as Message);
    if (spec.codemode) {
      messages.push(syntheticAssistant([{
        type: "toolCall", id: `call_${i}`, name: "codemode",
        arguments: { code: `// goal: step ${i}\nawait tools.bash({ command: "echo ${i}" });` },
      }], "toolUse"));
      messages.push({
        role: "toolResult", toolCallId: `call_${i}`, toolName: "codemode",
        content: [{ type: "text", text: "ok" }],
        nestedCalls: { calls: [{ id: `call_${i}/1`, name: "bash", arguments: { command: `echo ${i}` }, status: "ok" }], complete: true },
        isError: false, timestamp: i,
      } as unknown as Message);
    } else {
      messages.push(syntheticAssistant([{
        type: "toolCall", id: `call_${i}`, name: "Read",
        arguments: { path: `src/file-${i}.ts` },
      }], "toolUse"));
      messages.push({
        role: "toolResult", toolCallId: `call_${i}`, toolName: "Read",
        content: [{ type: "text", text: "file" }], isError: false, timestamp: i,
      } as unknown as Message);
    }
    messages.push(syntheticAssistant([{ type: "text", text: `assistant ${i} ${filler}` }], "stop"));
  }
  return { messages, sourceIndices: messages.map((_, i) => i) };
};

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
  indexById: Map<string, number>;
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
    indexById,
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

const ratioOf = (kept: number, total: number): number | null =>
  total > 0 ? Number((kept / total).toFixed(3)) : null;
const withRatio = (kept: number, total: number): number =>
  total > 0 ? Number((kept / total).toFixed(3)) : 0;
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(2));
};

// Deterministic adjudication scenarios: tight tool quota, annotations vary.
const adjudicationUser = (text: string): Message =>
  ({ role: "user", content: [{ type: "text", text }], timestamp: 0 } as unknown as Message);

const adjudicationCodemodeCall = (callId: string, code: string): Message =>
  syntheticAssistant([{ type: "toolCall", id: callId, name: "codemode", arguments: { code } }], "toolUse");

const adjudicationCodemodeResult = (callId: string, path: string, isError = false, kind: "read" | "write" = "write"): Message =>
  ({
    role: "toolResult",
    toolCallId: callId,
    toolName: "codemode",
    content: [{ type: "text", text: isError ? "Script failed" : "Script completed" }],
    nestedCalls: {
      calls: [{
        id: `${callId}/1`,
        name: kind,
        arguments: { path },
        status: isError ? "error" : "ok",
      }],
      complete: true,
    },
    isError,
    timestamp: 0,
  } as unknown as Message);

interface AdjudicationScenario {
  name: string;
  entries: any[];
  budgetChars: number;
}

const buildAdjudicationScenarios = (): AdjudicationScenario[] => {
  const make = (
    name: string,
    toolCount: number,
    opts: {
      goalOn?: "all" | "even" | "read";
      readEvery?: number;
      blockedFrom?: number;
      blockedTo?: number;
      errorEvery?: number;
    },
  ): AdjudicationScenario => {
    const entries: any[] = [];
    let parentId: string | undefined;
    const push = (id: string, message: unknown) => {
      entries.push({ id, type: "message", message, parentId });
      parentId = id;
    };
    push("u0", adjudicationUser("adjudication task"));
    for (let i = 0; i < toolCount; i++) {
      const isRead = opts.readEvery != null && i % opts.readEvery === 0;
      const goal = opts.goalOn === "all" ||
        (opts.goalOn === "even" && i % 2 === 0) ||
        (opts.goalOn === "read" && isRead);
      const blocked = opts.blockedFrom != null &&
        i >= opts.blockedFrom &&
        (opts.blockedTo == null || i <= opts.blockedTo);
      const code = [
        goal ? `// goal: step ${i}` : "",
        blocked ? `// blocked: waiting on dependency ${i}` : "",
        isRead
          ? `await tools.read({ path: 'src/s${i}.ts' });`
          : `await tools.write({ path: 'src/s${i}.ts', content: 'x' });`,
      ].filter(Boolean).join("\n");
      push(`c${i}`, adjudicationCodemodeCall(`call_${i}`, code));
      push(`r${i}`, adjudicationCodemodeResult(
        `call_${i}`,
        `src/s${i}.ts`,
        opts.errorEvery != null && i % opts.errorEvery === 0,
        isRead ? "read" : "write",
      ));
    }
    push("a0", syntheticAssistant([{ type: "text", text: "Synthetic adjudication run." }], "stop"));
    return { name, entries, budgetChars: 4400 };
  };
  return [
    make("mixed_goals", 200, { goalOn: "even" }),
    make("all_goals", 200, { goalOn: "all" }),
    make("blocked_recent", 200, { blockedFrom: 150, blockedTo: 164 }),
    make("observed_errors", 200, { errorEvery: 6 }),
    make("annotated_reads", 200, { goalOn: "read", readEvery: 2 }),
  ];
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
  // New codemode brief, compiled through the production seam with the same
  // selection the summary uses. Counts and sizes only; no message content.
  newBrief: {
    sessions: 0,
    skippedNoEffectiveCodemode: 0,
    skippedNoHostProjection: 0,
    limitedEditedCheckpoint: 0,
    limitedMissingHistory: 0,
    overBudget: 0,
    noteViolations: 0,
    headerTruncatedSessions: 0,
    headerUnmarked: 0,
    headerDegraded: 0,
    skippedErrors: {} as Record<string, number>,
    perSession: [] as Array<Record<string, any>>,
  },
  timing: null as null | Record<string, unknown>,
  scanRead: null as null | Record<string, unknown>,
  adjudication: null as null | Record<string, unknown>,
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

  // ── new codemode brief through the production seam ──────────────────────
  const branchMessages = session.branch.filter(
    (e: any) => e.type === "message" && e.message && e.message.role !== "system",
  );
  if (branchMessages.some((e: any) => isCodemodeMessage(e.message))) {
    try {
      const history = buildBriefHistory({ branchEntries: session.branch, globalIndexById: session.indexById });
      if (!briefHistoryHasCodemode(history)) {
        result.newBrief.skippedNoEffectiveCodemode++;
      } else {
        const historyBlocks = normalize(history.messages as any, history.sourceIndices).length;
        const budgetChars = Math.round(
          Math.min(BUDGET_CEILING_TOKENS, Math.max(BUDGET_FLOOR_TOKENS, 15 * historyBlocks)) * cpt,
        );
        // Compact-all view: the live window after the last compaction is the
        // fresh header source, mirroring the hook's ownCut for this snapshot.
        const lastCompactionIndex = session.branch.map((e: any) => e.type).lastIndexOf("compaction");
        const live = session.branch
          .slice(lastCompactionIndex + 1)
          .filter((e: any) => e.type === "message" && e.message && e.message.role !== "system");
        const started = performance.now();
        const { summary: newSummary, detail } = compileRankedWithDetail({
          messages: live.map((e: any) => e.message),
          sourceIndices: live.map((e: any) => session.indexById.get(e.id)),
          briefHistory: history,
          briefBudgetChars: budgetChars,
        });
        const rebuildMs = performance.now() - started;
        const counts = detail.counts;
        const totalChars = detail.usedChars + detail.reservedChars;
        const noteCount = newSummary.split("Historical navigation, not current state").length - 1;
        const legacyNote = newSummary.includes("Do not redo work already");
        const headerMarked = detail.headerOmittedItems === 0 || newSummary.includes("header line");
        const headerTotal = detail.headerSections.reduce((sum, s) => sum + s.omitted + s.lines, 0);
        const headerOmittedRatio = headerTotal > 0
          ? detail.headerSections.reduce((sum, s) => sum + s.omitted, 0) / headerTotal
          : 0;

        result.newBrief.sessions++;
        if (history.limitedReason === "edited-checkpoint") result.newBrief.limitedEditedCheckpoint++;
        if (history.limitedReason === "missing-history") result.newBrief.limitedMissingHistory++;
        if (totalChars > budgetChars) result.newBrief.overBudget++;
        if (noteCount !== 1 || legacyNote) result.newBrief.noteViolations++;
        if (detail.headerTruncated) result.newBrief.headerTruncatedSessions++;
        if (!headerMarked) result.newBrief.headerUnmarked++;
        if (headerOmittedRatio > 0.25) result.newBrief.headerDegraded++;

        result.newBrief.perSession.push({
          session: basename(file),
          historyMessages: history.messages.length,
          historyBlocks,
          budgetChars,
          usedChars: detail.usedChars,
          reservedChars: detail.reservedChars,
          ratio: Number((totalChars / Math.max(1, budgetChars)).toFixed(3)),
          headerChars: detail.headerChars,
          headerOmittedItems: detail.headerOmittedItems,
          headerOmittedRatio: Number(headerOmittedRatio.toFixed(3)),
          limited: detail.limited,
          rebuildMs: Number(rebuildMs.toFixed(2)),
          noteOnce: noteCount === 1,
          counts,
          rates: {
            userFull: ratioOf(counts.userFull ?? 0, counts.userKept ?? 0),
            userExcerpt: ratioOf(counts.userExcerpted ?? 0, counts.userKept ?? 0),
            userFold: ratioOf(counts.userFolded ?? 0, (counts.userKept ?? 0) + (counts.userFolded ?? 0)),
            assistantFull: ratioOf(counts.assistantFull ?? 0, counts.assistantKept ?? 0),
            assistantExcerpt: ratioOf(counts.assistantExcerpted ?? 0, counts.assistantKept ?? 0),
            assistantFold: ratioOf(counts.assistantFolded ?? 0, (counts.assistantKept ?? 0) + (counts.assistantFolded ?? 0)),
            mutationRetention: ratioOf(counts.toolMutationKept ?? 0, counts.toolMutationTotal ?? 0),
            readonlyRetention: ratioOf(counts.toolReadonlyKept ?? 0, counts.toolReadonlyTotal ?? 0),
            unknownRetention: ratioOf(counts.toolUnknownKept ?? 0, counts.toolUnknownTotal ?? 0),
            errorRetention: ratioOf(counts.toolErrorKept ?? 0, counts.toolErrorTotal ?? 0),
            goalRetention: ratioOf(counts.toolGoalKept ?? 0, counts.toolGoalTotal ?? 0),
            blockedRetention: ratioOf(counts.toolBlockedKept ?? 0, counts.toolBlockedTotal ?? 0),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("buildSessionProjection")) {
        // Older hosts lack buildSessionProjection; edited history is skipped.
        result.newBrief.skippedNoHostProjection++;
      } else {
        // Aggregate error kinds and source frames only; never message text.
        const frames = error instanceof Error ? String(error.stack ?? "").split("\n").slice(1) : [];
        const first = frames
          .map((line) => line.match(/\(?([^()\s]+\.(?:ts|js)):(\d+):\d+\)?$/))
          .find(Boolean);
        const frame = first ? basename(first[1]) + ":" + first[2] : "unknown";
        const key = (error instanceof Error ? error.name : "Error") + "|" + frame;
        result.newBrief.skippedErrors[key] = (result.newBrief.skippedErrors[key] ?? 0) + 1;
      }
    }
  }
}

// Optional synthetic scenario gate: runs the production compile seam on a
// deterministic in-memory window. Aggregate sizes only; never message text.
if (args.includes("--synthetic")) {
  const spec: SyntheticWindowSpec = {
    turns: Number(argValue("--turns") ?? 40),
    codemode: !args.includes("--plain"),
    textChars: Number(argValue("--text-chars") ?? 160),
  };
  const window = buildSyntheticWindow(spec);
  const legacy = compileBriefWindow({ messages: window.messages, sourceIndices: window.sourceIndices });
  const entries = window.messages.map((message, i) => ({
    id: `m${i}`,
    type: "message",
    message,
    parentId: i > 0 ? `m${i - 1}` : undefined,
  }));
  const history = buildBriefHistory({ branchEntries: entries, globalIndexById: buildGlobalIndexById(entries) });
  const historyBlocks = normalize(history.messages as any, history.sourceIndices).length;
  const budgetChars = Math.round(
    Math.min(BUDGET_CEILING_TOKENS, Math.max(BUDGET_FLOOR_TOKENS, 15 * historyBlocks)) * 4,
  );
  const { summary: newSummary, detail } = compileRankedWithDetail({
    messages: [],
    sourceIndices: [],
    briefHistory: history,
    briefBudgetChars: budgetChars,
  });
  result.synthetic = {
    spec,
    messages: window.messages.length,
    historyBlocks,
    legacyChars: legacy.chars,
    chars: newSummary.length,
    lines: newSummary.split("\n").length,
    budgetChars,
    usedChars: detail.usedChars,
    reservedChars: detail.reservedChars,
    withinBudget: detail.usedChars + detail.reservedChars <= budgetChars,
    noteOnce: newSummary.split("Historical navigation, not current state").length === 2,
    headerOmittedItems: detail.headerOmittedItems,
    kind: detail.kind,
  };
}

// Timing + recall page checks (§9.3). Synthetic files only; counts and
// durations are recorded, never record text.
if (args.includes("--timing")) {
  const turns = 500; // 500 x 4 normalized blocks = 2000 history blocks.
  const window = buildSyntheticWindow({ turns, codemode: true, textChars: 160 });
  const entries = window.messages.map((message, i) => ({
    id: `m${i}`,
    type: "message",
    message,
    parentId: i > 0 ? `m${i - 1}` : undefined,
  }));
  const indexById = buildGlobalIndexById(entries);
  const historyBlocks = normalize(entries.map((e) => e.message) as any, window.sourceIndices).length;
  const rebuildBudget = Math.round(BUDGET_CEILING_TOKENS * 4);
  const rebuildTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    const history = buildBriefHistory({ branchEntries: entries, globalIndexById: indexById });
    compileRankedWithDetail({
      messages: [],
      sourceIndices: [],
      briefHistory: history,
      briefBudgetChars: rebuildBudget,
    });
    rebuildTimes.push(performance.now() - started);
  }

  const dir = mkdtempSync(join(tmpdir(), "pi-vcc-audit-"));
  const file = join(dir, "session.jsonl");
  const totalRecords = 20_000;
  const longText = "y".repeat(12_000);
  const ids: string[] = [];
  try {
    const lines: string[] = [];
    for (let i = 0; i < totalRecords; i++) {
      const id = `m${i}`;
      ids.push(id);
      lines.push(JSON.stringify({
        id,
        type: "message",
        parentId: i > 0 ? `m${i - 1}` : undefined,
        message: {
          role: "user",
          content: [{ type: "text", text: i % 500 === 0 ? `needle ${i}` : `record ${i}` }],
          timestamp: 0,
        },
      }));
    }
    lines.push(JSON.stringify({
      id: "long",
      type: "message",
      parentId: `m${totalRecords - 1}`,
      message: {
        role: "assistant",
        content: [{ type: "text", text: longText }],
        timestamp: 0,
        api: "synthetic",
        provider: "synthetic",
        model: "synthetic",
        stopReason: "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      },
    }));
    writeFileSync(file, lines.join("\n") + "\n");
    const allowed = new Set([...ids, "long"]);

    const readTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      readSavedRecord({ sessionFile: file, index: totalRecords, offset: i * 4000, length: 4000, allowedEntryIds: allowed });
      readTimes.push(performance.now() - started);
    }

    const expectedView = fullViewOfMessage({
      role: "assistant",
      content: [{ type: "text", text: longText }],
    } as unknown as Message, totalRecords);
    let offset = 0;
    let assembled = "";
    let readPages = 0;
    let reassemblyOk = true;
    while (readPages < 12) {
      const outcome = readSavedRecord({ sessionFile: file, index: totalRecords, offset, length: 4000, allowedEntryIds: allowed });
      if (!outcome.ok || !outcome.window) {
        reassemblyOk = false;
        break;
      }
      if (outcome.window.kind === "eof") break;
      if (outcome.window.kind !== "ok") {
        reassemblyOk = false;
        break;
      }
      assembled += outcome.window.text;
      offset = outcome.window.actualEnd;
      readPages++;
    }
    reassemblyOk = reassemblyOk && readPages > 1 && assembled === expectedView;

    let cursor: string | undefined;
    let scanPages = 0;
    let scanHits = 0;
    let scanMalformed = 0;
    let scanComplete = false;
    const seen = new Set<number>();
    while (scanPages < 100) {
      const outcome = scanSavedFields({
        sessionFile: file,
        query: "needle",
        scope: "all",
        cursor,
        allowedEntryIds: allowed,
        branchEntryIds: allowed,
        branchAnchor: "long",
        maxMs: 5,
      });
      if (!outcome.ok) break;
      scanPages++;
      scanHits += outcome.hits.length;
      scanMalformed += outcome.malformed;
      for (const hit of outcome.hits) seen.add(hit.index);
      if (outcome.complete) {
        scanComplete = true;
        break;
      }
      cursor = outcome.nextCursor;
      if (!cursor) break;
    }

    result.timing = {
      rebuild: {
        historyBlocks,
        budgetChars: rebuildBudget,
        runs: rebuildTimes.length,
        p95Ms: percentile(rebuildTimes, 0.95),
        thresholdMs: 1500,
        pass: percentile(rebuildTimes, 0.95) < 1500,
      },
      read: {
        records: totalRecords + 1,
        pages: readTimes.length,
        p95Ms: percentile(readTimes, 0.95),
        thresholdMs: 300,
        pass: percentile(readTimes, 0.95) < 300,
      },
    };
    result.scanRead = {
      readPages,
      readTotalChars: expectedView.length,
      reassemblyOk,
      scanPages,
      scanHits,
      scanUniqueMessages: seen.size,
      expectedNeedleMessages: Math.ceil(totalRecords / 500),
      scanComplete,
      scanMalformed,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Annotation weight adjudication (§6.3): goal 0/4 and blocked 0/2 on frozen
// synthetic scenarios. The audit reports the counts; the release decision is
// recorded in the plan, not made here.
if (args.includes("--adjudicate")) {
  const scenarios = buildAdjudicationScenarios();
  const configs = [
    { name: "goal4_blocked2", goal: 4, blocked: 2 },
    { name: "goal0_blocked2", goal: 0, blocked: 2 },
    { name: "goal4_blocked0", goal: 4, blocked: 0 },
    { name: "goal0_blocked0", goal: 0, blocked: 0 },
  ];
  const rows = configs.map((config) => {
    const totals = {
      toolKept: 0,
      mutationKept: 0,
      mutationTotal: 0,
      errorKept: 0,
      errorTotal: 0,
      goalKept: 0,
      goalTotal: 0,
      blockedKept: 0,
      blockedTotal: 0,
      keptChars: 0,
    };
    const perScenario: Array<Record<string, unknown>> = [];
    for (const scenario of scenarios) {
      const history = buildBriefHistory({
        branchEntries: scenario.entries,
        globalIndexById: buildGlobalIndexById(scenario.entries),
      });
      const { summary: text, detail } = compileRankedWithDetail({
        messages: [],
        sourceIndices: [],
        briefHistory: history,
        briefBudgetChars: scenario.budgetChars,
        briefCandidateOptions: { annotationWeights: { goal: config.goal, blocked: config.blocked } },
      });
      const counts = detail.counts;
      totals.toolKept += counts.toolKept ?? 0;
      totals.mutationKept += counts.toolMutationKept ?? 0;
      totals.mutationTotal += counts.toolMutationTotal ?? 0;
      totals.errorKept += counts.toolErrorKept ?? 0;
      totals.errorTotal += counts.toolErrorTotal ?? 0;
      totals.goalKept += counts.toolGoalKept ?? 0;
      totals.goalTotal += counts.toolGoalTotal ?? 0;
      totals.blockedKept += counts.toolBlockedKept ?? 0;
      totals.blockedTotal += counts.toolBlockedTotal ?? 0;
      totals.keptChars += text.length;
      perScenario.push({
        scenario: scenario.name,
        toolKept: counts.toolKept ?? 0,
        mutationKept: counts.toolMutationKept ?? 0,
        errorKept: counts.toolErrorKept ?? 0,
        goalKept: counts.toolGoalKept ?? 0,
        blockedKept: counts.toolBlockedKept ?? 0,
        chars: text.length,
      });
    }
    return {
      config: config.name,
      ...totals,
      rates: {
        mutation: withRatio(totals.mutationKept, totals.mutationTotal),
        error: withRatio(totals.errorKept, totals.errorTotal),
        goal: withRatio(totals.goalKept, totals.goalTotal),
        blocked: withRatio(totals.blockedKept, totals.blockedTotal),
      },
      perScenario,
    };
  });
  result.adjudication = { scenarios: scenarios.length, rows };
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
  newBrief: (() => {
    const rows = result.newBrief.perSession as Array<Record<string, any>>;
    const pooled = (field: string): number => rows.reduce((sum, row) => sum + (row.counts?.[field] ?? 0), 0);
    return {
      sessions: result.newBrief.sessions,
      skippedNoEffectiveCodemode: result.newBrief.skippedNoEffectiveCodemode,
      skippedNoHostProjection: result.newBrief.skippedNoHostProjection,
      skippedErrors: result.newBrief.skippedErrors,
      limitedEditedCheckpoint: result.newBrief.limitedEditedCheckpoint,
      limitedMissingHistory: result.newBrief.limitedMissingHistory,
      overBudget: result.newBrief.overBudget,
      noteViolations: result.newBrief.noteViolations,
      headerTruncatedSessions: result.newBrief.headerTruncatedSessions,
      headerDegradedSessions: result.newBrief.headerDegraded,
      headerUnmarked: result.newBrief.headerUnmarked,
      medianHistoryBlocks: median(rows.map((row) => row.historyBlocks)),
      medianBudgetChars: median(rows.map((row) => row.budgetChars)),
      medianRatio: median(rows.map((row) => row.ratio)),
      maxRatio: rows.reduce((max, row) => Math.max(max, row.ratio), 0),
      medianRebuildMs: median(rows.map((row) => row.rebuildMs)),
      pooledRates: {
        userFull: withRatio(pooled("userFull"), pooled("userKept")),
        userExcerpt: withRatio(pooled("userExcerpted"), pooled("userKept")),
        userFold: withRatio(pooled("userFolded"), pooled("userKept") + pooled("userFolded")),
        assistantFull: withRatio(pooled("assistantFull"), pooled("assistantKept")),
        assistantExcerpt: withRatio(pooled("assistantExcerpted"), pooled("assistantKept")),
        assistantFold: withRatio(pooled("assistantFolded"), pooled("assistantKept") + pooled("assistantFolded")),
        mutationRetention: withRatio(pooled("toolMutationKept"), pooled("toolMutationTotal")),
        readonlyRetention: withRatio(pooled("toolReadonlyKept"), pooled("toolReadonlyTotal")),
        unknownRetention: withRatio(pooled("toolUnknownKept"), pooled("toolUnknownTotal")),
        errorRetention: withRatio(pooled("toolErrorKept"), pooled("toolErrorTotal")),
        goalRetention: withRatio(pooled("toolGoalKept"), pooled("toolGoalTotal")),
        blockedRetention: withRatio(pooled("toolBlockedKept"), pooled("toolBlockedTotal")),
      },
      pooledCounts: {
        annotationGoalRejected: pooled("annotationGoalRejected"),
        annotationBlockedRejected: pooled("annotationBlockedRejected"),
        toolGoalTotal: pooled("toolGoalTotal"),
        toolBlockedTotal: pooled("toolBlockedTotal"),
      },
    };
  })(),
  ...(result.synthetic ? { synthetic: result.synthetic } : {}),
  ...(result.timing ? { timing: result.timing } : {}),
  ...(result.scanRead ? { scanRead: result.scanRead } : {}),
  ...(result.adjudication ? { adjudication: result.adjudication } : {}),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ summary, ...result }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath}`);
