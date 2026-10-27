import type { NormalizedBlock, FileOps } from "../types";
import { extractPath } from "./tool-args";
import {
  compileBrief,
  heredocCloseIndex,
  renderTextCandidate,
  renderToolCandidate,
  formatTextOmissionMarker,
  renderToolOmissionMarker,
  BRIEF_MIN_TEXT_CHARS,
  BRIEF_TEXT_STEP_CHARS,
  type BriefCandidate,
  type BriefSelection,
} from "./brief";
import { wrapLongLines } from "./format";

export interface BriefRankingOptions {
  /** Maximum normalized blocks used to build the brief transcript. */
  maxBlocks?: number;
  /** Always keep this many latest blocks to preserve local continuity. */
  preserveRecentBlocks?: number;
  /** Hook-provided file activity, used as structural signal instead of prose guessing. */
  fileOps?: FileOps;
  /**
   * Optional size budget (in characters of rendered brief) for the selected
   * blocks. When set, this is the PRIMARY limit: blocks are added by score
   * until the budget is reached, and lower-value blocks are skipped rather
   * than truncating the tail. maxBlocks still applies as a safety upper bound.
   * Callers derive this from a token budget via charsPerToken.
   * When maxBriefCharsCeiling + briefCharsPerBlock are also set, this acts as
   * the FLOOR of a size-relative budget (see below).
   */
  maxBriefChars?: number;
  /**
   * Optional upper bound for a size-relative char budget. When set together
   * with maxBriefChars (floor) and briefCharsPerBlock (slope), the effective
   * budget becomes clamp(briefCharsPerBlock * blockCount, maxBriefChars,
   * maxBriefCharsCeiling): larger transcripts (which carry more high-value
   * long-tail -- edits, commands, tests) get more brief budget, while small
   * sessions stay at the floor and this hard ceiling prevents unbounded growth.
   */
  maxBriefCharsCeiling?: number;
  /** Per-block slope (chars) for the size-relative budget. Requires the ceiling. */
  briefCharsPerBlock?: number;
}

export interface RankedBlock {
  block: NormalizedBlock;
  index: number;
  score: number;
  reasons: string[];
}

const DEFAULT_MAX_BLOCKS = 80;
const DEFAULT_RECENT_BLOCKS = 16;

const EDIT_TOOL_RE = /^(edit|write|multiedit|quick_edit|target_edit|apply_patch)$/i;
const READ_TOOL_RE = /^(read|glob|grep|ls|find|semantic_query|semantic_grep|semantic_show)$/i;
const TEST_COMMAND_RE = /\b(?:bun|npm|pnpm|yarn|node|pytest|cargo|go|mvn|gradle)\b[^\n]*(?:test|spec|check|lint|build|tsc)/i;
const GH_PR_POLL_RE = /(?:^|\s)gh\s+pr\s+(?:view|checks)\s+(\d+)\b/i;
// Durable workflow facts: which PR/issue was acted on, and git state changes.
// Structural (command shape), not prose — same spirit as TEST_COMMAND_RE.
const WORKFLOW_COMMAND_RE =
  /(?:^|\s)(?:gh\s+(?:pr|issue)\s+[a-z-]+|git\s+(?:commit|push|merge|rebase|revert|cherry-pick|tag|reset|checkout|branch)\b)/i;
const MIN_SEGMENT_CLOSING_ASSISTANT_CHARS = 120;

// A bash block whose every meaningful line is pure scaffolding (set -e, cd,
// export, ls, echo, sleep, pwd, comments, heredoc bodies) carries no durable
// fact. Such blocks get a score penalty so the size-relative budget never
// pulls them in ahead of real edits/commands when spare chars appear.
const TRIVIAL_BASH_LINE_RE =
  /^(?:set\s+[-+]|cd(?:\s+\S+)?$|export\s+\w+=|(?:source|\.)\s+\S+|pwd$|true$|:$|#|ls(?:\s|$)|echo\b|clear$|sleep\b)/;
const TRIVIAL_BASH_PENALTY = 16;

const isTrivialOnlyBash = (raw: string): boolean => {
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    // Skip heredoc bodies (they are content, not scaffolding) using the same
    // hardened detection as brief.ts: only skip when the terminator exists
    // downstream, so a stray `<<` never swallows a later real command.
    const close = heredocCloseIndex(lines, i);
    if (close !== -1) i = close;
  }
  const meaningful = kept.map((l) => l.trim()).filter(Boolean).filter((l) => !TRIVIAL_BASH_LINE_RE.test(l));
  return meaningful.length === 0;
};

const asPathSet = (paths?: string[]): Set<string> => new Set((paths ?? []).filter(Boolean));

const bashCommandFromBlock = (block: NormalizedBlock): string | undefined => {
  if (block.kind === "bash") return block.command;
  if (block.kind === "tool_call" && /^bash$/i.test(block.name) && typeof block.args.command === "string") {
    return block.args.command;
  }
  return undefined;
};

const pathFromBlock = (block: NormalizedBlock): string | undefined => {
  if (block.kind === "tool_call") return extractPath(block.args) ?? undefined;
  if (block.kind === "bash") {
    const match = block.command.match(/(?:^|\s)([\w./-]+\.[\w-]+)(?:\s|$)/);
    return match?.[1];
  }
  return undefined;
};

const add = (ranked: RankedBlock, points: number, reason: string) => {
  ranked.score += points;
  ranked.reasons.push(reason);
};

const scoreBlock = (
  block: NormalizedBlock,
  index: number,
  total: number,
  modifiedFiles: Set<string>,
  readFiles: Set<string>,
): RankedBlock => {
  const ranked: RankedBlock = { block, index, score: 0, reasons: [] };
  const recency = total <= 1 ? 0 : Math.round((index / (total - 1)) * 12);
  add(ranked, recency, "recency");

  if (block.kind === "user") add(ranked, 18, "user-turn");
  if (block.kind === "assistant") add(ranked, 10, "assistant-context");
  if (block.kind === "tool_result") add(ranked, 1, "tool-result-low-value");

  if (block.kind === "tool_call") {
    const command = bashCommandFromBlock(block);
    if (EDIT_TOOL_RE.test(block.name)) add(ranked, 34, "edit-tool");
    else if (command && TEST_COMMAND_RE.test(command)) add(ranked, 26, "test-command");
    else if (READ_TOOL_RE.test(block.name)) add(ranked, 6, "read-tool");
    else add(ranked, 12, "tool-call");
    if (command && WORKFLOW_COMMAND_RE.test(command)) add(ranked, 14, "workflow-command");
    if (command && isTrivialOnlyBash(command)) add(ranked, -TRIVIAL_BASH_PENALTY, "trivial-bash");
  }

  if (block.kind === "bash") {
    add(ranked, 8, "bash");
    if (block.exitCode != null && block.exitCode !== 0) add(ranked, 24, "nonzero-exit");
    if (TEST_COMMAND_RE.test(block.command)) add(ranked, 22, "test-command");
    if (WORKFLOW_COMMAND_RE.test(block.command)) add(ranked, 14, "workflow-command");
    // Penalize scaffolding-only commands, but not ones that failed (a failed
    // `ls`/`cd` still records a real state fact via nonzero-exit).
    if (isTrivialOnlyBash(block.command) && !(block.exitCode != null && block.exitCode !== 0)) {
      add(ranked, -TRIVIAL_BASH_PENALTY, "trivial-bash");
    }
  }

  const path = pathFromBlock(block);
  if (path) {
    if (modifiedFiles.has(path)) add(ranked, 18, "hook-modified-file");
    if (readFiles.has(path)) add(ranked, 6, "hook-read-file");
  }

  if (block.kind === "tool_result" && block.text.length > 1000) add(ranked, -8, "long-tool-result");
  return ranked;
};

const boostAdjacency = (ranked: RankedBlock[]) => {
  const important = ranked
    .filter((r) => r.score >= 34 || r.reasons.includes("edit-tool") || r.reasons.includes("test-command") || r.reasons.includes("nonzero-exit"))
    .map((r) => r.index);

  for (const idx of important) {
    for (let i = idx - 1; i >= Math.max(0, idx - 8); i--) {
      if (ranked[i].block.kind === "user") {
        add(ranked[i], 10, "near-important-event");
        break;
      }
    }
    for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) {
      if (ranked[i].block.kind === "assistant") {
        add(ranked[i], 7, "near-important-event");
        break;
      }
    }
    for (let i = idx + 1; i <= Math.min(ranked.length - 1, idx + 4); i++) {
      if (ranked[i].block.kind === "assistant" || ranked[i].block.kind === "bash") {
        add(ranked[i], 5, "after-important-event");
        break;
      }
    }
  }
};

const nextNonToolResult = (ranked: RankedBlock[], index: number): NormalizedBlock | undefined => {
  for (let i = index + 1; i < ranked.length; i++) {
    if (ranked[i].block.kind !== "tool_result") return ranked[i].block;
  }
  return undefined;
};

const boostSegmentClosingAssistants = (ranked: RankedBlock[]) => {
  for (let i = 0; i < ranked.length; i++) {
    const current = ranked[i];
    if (current.block.kind !== "assistant") continue;
    if (current.block.text.trim().length < MIN_SEGMENT_CLOSING_ASSISTANT_CHARS) continue;
    const next = nextNonToolResult(ranked, i);
    if (!next || next.kind === "user") {
      add(current, 14, "segment-closing-assistant");
    }
  }
};

const dedupKey = (block: NormalizedBlock): string | undefined => {
  const command = bashCommandFromBlock(block);
  const ghPrPoll = command?.match(GH_PR_POLL_RE);
  if (ghPrPoll) return `gh-pr-poll:${ghPrPoll[1]}`;
  if (command) {
    const normalized = command.replace(/\s+/g, " ").trim();
    return normalized ? `bash:${normalized}` : undefined;
  }
  if (block.kind === "tool_call") {
    const path = pathFromBlock(block);
    return path ? `tool:${block.name.toLowerCase()}:${path}` : undefined;
  }
  return undefined;
};

export const rankBriefBlocks = (blocks: NormalizedBlock[], options: BriefRankingOptions = {}): RankedBlock[] => {
  const modifiedFiles = asPathSet(options.fileOps?.modifiedFiles);
  const readFiles = asPathSet(options.fileOps?.readFiles);
  const ranked = blocks.map((block, index) => scoreBlock(block, index, blocks.length, modifiedFiles, readFiles));
  boostAdjacency(ranked);
  boostSegmentClosingAssistants(ranked);
  return ranked;
};

export const selectRankedBriefBlocks = (
  blocks: NormalizedBlock[],
  options: BriefRankingOptions = {},
): NormalizedBlock[] => {
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  // Size-relative budget: when a ceiling + slope are provided, the effective
  // char budget scales with transcript length (block count) between the floor
  // (maxBriefChars) and the ceiling. Larger transcripts carry more high-value
  // long-tail, so they earn more brief budget; small sessions stay at the floor.
  const maxBriefChars =
    options.maxBriefChars != null && options.maxBriefCharsCeiling != null && options.briefCharsPerBlock != null
      ? Math.round(
          Math.min(
            options.maxBriefCharsCeiling,
            Math.max(options.maxBriefChars, options.briefCharsPerBlock * blocks.length),
          ),
        )
      : options.maxBriefChars;
  // Fast path: nothing to trim by count and no char budget to enforce.
  if (blocks.length <= maxBlocks && maxBriefChars == null) return blocks;

  const preserveRecentBlocks = Math.min(options.preserveRecentBlocks ?? DEFAULT_RECENT_BLOCKS, maxBlocks);
  const ranked = rankBriefBlocks(blocks, options);
  const selected = new Set<number>();
  const seenKeys = new Set<string>();

  // Per-block rendered size, only computed when a char budget is active.
  const costs = maxBriefChars == null
    ? null
    : blocks.map((b) => (b.kind === "tool_result" ? 0 : compileBrief([b]).length + 1));
  let usedChars = 0;

  // Keep the latest blocks to preserve local continuity, iterating NEWEST first
  // so the most recent context is guaranteed. When a char budget is active these
  // are charged against it too and over-budget blocks are skipped -- otherwise a
  // run of large recent blocks could blow past maxBriefChars (the old bug on very
  // long transcripts, where preserve-recent alone exceeded the budget).
  for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - preserveRecentBlocks); i--) {
    if (blocks[i].kind === "tool_result") continue;
    if (selected.has(i)) continue;
    if (costs && usedChars + costs[i] > maxBriefChars!) continue;
    selected.add(i);
    if (costs) usedChars += costs[i];
    const key = dedupKey(blocks[i]);
    if (key) seenKeys.add(key);
  }

  const ordered = [...ranked].sort((a, b) => b.score - a.score || b.index - a.index);
  for (const item of ordered) {
    if (selected.size >= maxBlocks) break;
    if (selected.has(item.index)) continue;
    if (item.block.kind === "tool_result") continue;
    const key = dedupKey(item.block);
    if (key && seenKeys.has(key)) continue;
    if (costs) {
      // Skip (not break) so smaller high-value blocks can still fit the budget.
      if (usedChars + costs[item.index] > maxBriefChars!) continue;
      usedChars += costs[item.index];
    }
    selected.add(item.index);
    if (key) seenKeys.add(key);
  }

  return [...selected].sort((a, b) => a - b).map((i) => blocks[i]);
};

// ── new codemode path: role budgets, actual-cost rendering ────────────────

export interface BriefAllocationOptions {
  /** Total budget for the whole brief, including note/headers/separators. */
  maxChars: number;
  /** Actual chars of note + structure + header sections already reserved. */
  reservedChars?: number;
}

interface TextAllocation {
  keep: Map<string, number>;
  folded: BriefCandidate[];
  marker?: string;
  used: number;
  full: boolean;
}

interface ToolAllocation {
  selected: Map<string, "short" | "normal">;
  omitted: BriefCandidate[];
  marker?: string;
  used: number;
  full: boolean;
}

// Costs are measured after wrapping: the final body is wrapped, and a
// pre-wrap estimate lets a wrapped long line overshoot the quota silently.
const textCost = (candidate: BriefCandidate, keep: number): number =>
  wrapLongLines(renderTextCandidate(candidate, keep)).length + 1;
const toolCost = (candidate: BriefCandidate, version: "short" | "normal"): number =>
  wrapLongLines(renderToolCandidate(candidate, version)).length + 1;
const markerCost = (text: string): number => wrapLongLines(text).length + 1;

/**
 * Costs are exact only after wrapping, and the allocator asks for the same
 * (candidate, keep) pair many times while it retries and upgrades. One meter
 * per `allocateBriefBudget` call removes that repeated grapheme scan; it is
 * released with the call, so nothing is cached across compactions.
 */
interface CostMeter {
  text(candidate: BriefCandidate, keepChars: number): number;
  tool(candidate: BriefCandidate, version: "short" | "normal"): number;
  marker(text: string): number;
}

const createCostMeter = (): CostMeter => {
  const textCosts = new WeakMap<BriefCandidate, Map<number, number>>();
  const toolCosts = new WeakMap<BriefCandidate, Map<"short" | "normal", number>>();
  const markerCosts = new Map<string, number>();

  return {
    text(candidate, keepChars) {
      let perCandidate = textCosts.get(candidate);
      if (!perCandidate) {
        perCandidate = new Map();
        textCosts.set(candidate, perCandidate);
      }
      const cached = perCandidate.get(keepChars);
      if (cached !== undefined) return cached;
      const value = textCost(candidate, keepChars);
      perCandidate.set(keepChars, value);
      return value;
    },
    tool(candidate, version) {
      let perCandidate = toolCosts.get(candidate);
      if (!perCandidate) {
        perCandidate = new Map();
        toolCosts.set(candidate, perCandidate);
      }
      const cached = perCandidate.get(version);
      if (cached !== undefined) return cached;
      const value = toolCost(candidate, version);
      perCandidate.set(version, value);
      return value;
    },
    marker(text) {
      const cached = markerCosts.get(text);
      if (cached !== undefined) return cached;
      const value = markerCost(text);
      markerCosts.set(text, value);
      return value;
    },
  };
};

const allocateTextRole = (
  roleCandidates: BriefCandidate[],
  quota: number,
  meter: CostMeter,
): TextAllocation => {
  if (roleCandidates.length === 0) {
    return { keep: new Map(), folded: [], used: 0, full: true };
  }
  const role = roleCandidates[0].role === "user" ? "user" : "assistant";

  const entries = roleCandidates.map((candidate) => {
    const length = candidate.sourceText.length;
    const minKeep = Math.min(length, BRIEF_MIN_TEXT_CHARS);
    const minCost = meter.text(candidate, minKeep);
    const fullCost = meter.text(candidate, length);
    const keep = fullCost <= minCost ? length : minKeep;
    return { candidate, length, keep, cost: Math.min(minCost, fullCost) };
  });

  let fold = 0;
  let marker = "";
  let used = entries.reduce((sum, entry) => sum + entry.cost, 0);

  if (used > quota) {
    // Prefix sums plus an incremental ref range. The old loop rebuilt the
    // omitted slice for every fold, so both the allocations and the marker
    // scans grew quadratically with the number of candidates.
    const prefix = new Array<number>(entries.length + 1);
    prefix[0] = 0;
    for (let i = 0; i < entries.length; i++) prefix[i + 1] = prefix[i] + entries[i].cost;
    const allCost = prefix[entries.length];
    let minRef = Number.POSITIVE_INFINITY;
    let maxRef = Number.NEGATIVE_INFINITY;
    let allNumeric = true;

    for (fold = 1; fold <= entries.length; fold++) {
      const ref = entries[fold - 1].candidate.sourceIndex;
      if (typeof ref === "number") {
        if (ref < minRef) minRef = ref;
        if (ref > maxRef) maxRef = ref;
      } else {
        allNumeric = false;
      }
      const nextMarker = formatTextOmissionMarker(role, fold, allNumeric ? { min: minRef, max: maxRef } : null);
      const keptCost = allCost - prefix[fold];
      const nextMarkerCost = meter.marker(nextMarker);
      if (nextMarkerCost + keptCost <= quota) {
        marker = nextMarker;
        used = nextMarkerCost + keptCost;
        break;
      }
    }
    if (fold > entries.length) {
      // Not even the newest minimum fits: fold everything, keep only the marker.
      fold = entries.length;
      marker = formatTextOmissionMarker(role, entries.length, allNumeric ? { min: minRef, max: maxRef } : null);
      used = meter.marker(marker);
    }
  }

  const kept = entries.slice(fold);
  const keep = new Map<string, number>();
  for (const entry of kept) keep.set(entry.candidate.key, entry.keep);

  let remaining = quota - used;
  const upgrades = kept
    .filter((entry) => entry.keep < entry.length)
    .map((entry) => ({ entry, delta: meter.text(entry.candidate, entry.length) - meter.text(entry.candidate, entry.keep) }))
    .sort((a, b) => a.delta - b.delta || b.entry.candidate.order - a.entry.candidate.order);
  for (const upgrade of upgrades) {
    if (upgrade.delta <= 0) {
      keep.set(upgrade.entry.candidate.key, upgrade.entry.length);
      continue;
    }
    if (upgrade.delta <= remaining) {
      keep.set(upgrade.entry.candidate.key, upgrade.entry.length);
      remaining -= upgrade.delta;
    }
  }

  let progressed = remaining > 0;
  while (progressed && remaining > 0) {
    progressed = false;
    for (let i = kept.length - 1; i >= 0; i--) {
      const entry = kept[i];
      const current = keep.get(entry.candidate.key)!;
      if (current >= entry.length) continue;
      const next = Math.min(entry.length, current + BRIEF_TEXT_STEP_CHARS);
      const delta = meter.text(entry.candidate, next) - meter.text(entry.candidate, current);
      if (delta > 0 && delta <= remaining) {
        keep.set(entry.candidate.key, next);
        remaining -= delta;
        progressed = true;
      }
    }
  }

  used = marker ? meter.marker(marker) : 0;
  for (const entry of kept) used += meter.text(entry.candidate, keep.get(entry.candidate.key)!);
  const full = kept.length === entries.length &&
    kept.every((entry) => keep.get(entry.candidate.key) === entry.length);

  return {
    keep,
    folded: entries.slice(0, fold).map((entry) => entry.candidate),
    ...(marker ? { marker } : {}),
    used,
    full,
  };
};

const allocateToolRole = (
  toolCandidates: BriefCandidate[],
  quota: number,
  meter: CostMeter,
): ToolAllocation => {
  if (toolCandidates.length === 0) {
    return { selected: new Map(), omitted: [], used: 0, full: true };
  }
  const byKey = new Map(toolCandidates.map((candidate) => [candidate.key, candidate]));
  const sorted = [...toolCandidates].sort((a, b) => b.score - a.score || b.order - a.order);
  const selected = new Map<string, "short" | "normal">();
  let remaining = quota;

  // A 20% channel for observed errors; unused reserve returns to the pool.
  const errorReserve = Math.floor(quota * 0.2);
  let errorUsed = 0;
  for (const candidate of sorted) {
    if (!candidate.evidence?.observedError) continue;
    const cost = meter.tool(candidate, "short");
    if (errorUsed + cost <= errorReserve && cost <= remaining) {
      selected.set(candidate.key, "short");
      errorUsed += cost;
      remaining -= cost;
    }
  }
  for (const candidate of sorted) {
    if (selected.has(candidate.key)) continue;
    const cost = meter.tool(candidate, "short");
    if (cost <= remaining) {
      selected.set(candidate.key, "short");
      remaining -= cost;
    }
  }
  for (const candidate of sorted) {
    if (selected.get(candidate.key) !== "short") continue;
    const delta = meter.tool(candidate, "normal") - meter.tool(candidate, "short");
    if (delta > 0 && delta <= remaining) {
      selected.set(candidate.key, "normal");
      remaining -= delta;
    }
  }

  let omitted = toolCandidates.filter((candidate) => !selected.has(candidate.key));
  let marker = omitted.length > 0 ? renderToolOmissionMarker(omitted) : "";
  const usedNow = (): number => {
    let total = marker ? meter.marker(marker) : 0;
    for (const [key, version] of selected) total += meter.tool(byKey.get(key)!, version);
    return total;
  };
  let used = usedNow();

  // The omission marker is part of the interface: if it does not fit, drop
  // lower-score selected tools until it does.
  while (used > quota && selected.size > 0) {
    let dropKey: string | undefined;
    let dropScore = Infinity;
    for (const key of selected.keys()) {
      const candidate = byKey.get(key)!;
      if (candidate.score < dropScore) {
        dropScore = candidate.score;
        dropKey = key;
      }
    }
    if (!dropKey) break;
    selected.delete(dropKey);
    omitted = toolCandidates.filter((candidate) => !selected.has(candidate.key));
    marker = omitted.length > 0 ? renderToolOmissionMarker(omitted) : "";
    used = usedNow();
  }

  return {
    selected,
    omitted,
    ...(marker ? { marker } : {}),
    used,
    full: omitted.length === 0 && [...selected.values()].every((version) => version === "normal"),
  };
};

const minOrder = (candidates: BriefCandidate[]): number => {
  let min = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) if (candidate.order < min) min = candidate.order;
  return min;
};

const assembleBriefBody = (
  candidates: BriefCandidate[],
  textAllocations: { user: TextAllocation; assistant: TextAllocation },
  tools: ToolAllocation,
): { text: string; usedChars: number; counts: Record<string, number> } => {
  type Item = { order: number; role: "user" | "assistant"; text: string };
  const items: Item[] = [];

  for (const role of ["user", "assistant"] as const) {
    const allocation = textAllocations[role];
    for (const candidate of candidates) {
      if (candidate.role !== role) continue;
      const keep = allocation.keep.get(candidate.key);
      if (keep === undefined) continue;
      items.push({ order: candidate.order, role, text: renderTextCandidate(candidate, keep) });
    }
    if (allocation.marker && allocation.folded.length > 0) {
      items.push({ order: allocation.folded[0].order - 0.5, role, text: allocation.marker });
    }
  }

  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  for (const [key, version] of tools.selected) {
    const candidate = byKey.get(key)!;
    items.push({ order: candidate.order, role: "assistant", text: renderToolCandidate(candidate, version) });
  }
  if (tools.marker && tools.omitted.length > 0) {
    items.push({
      order: minOrder(tools.omitted) - 0.5,
      role: "assistant",
      text: tools.marker,
    });
  }

  items.sort((a, b) => a.order - b.order);
  const out: string[] = [];
  let lastCategory: "user" | "assistant" | undefined;
  for (const item of items) {
    if (item.role !== lastCategory) {
      if (out.length > 0) out.push("");
      out.push(`[${item.role}]`);
      lastCategory = item.role;
    }
    out.push(item.text);
  }

  // Same-selection audit counts: full/excerpt/fold and per-class retention.
  const textStats = (role: "user" | "assistant") => {
    const allocation = textAllocations[role];
    let full = 0;
    let excerpted = 0;
    let keptChars = 0;
    let sourceChars = 0;
    for (const candidate of candidates) {
      if (candidate.role !== role) continue;
      const keep = allocation.keep.get(candidate.key);
      if (keep === undefined) continue;
      sourceChars += candidate.sourceText.length;
      keptChars += keep;
      if (keep >= candidate.sourceText.length) full++;
      else excerpted++;
    }
    return { full, excerpted, keptChars, sourceChars };
  };
  const userStats = textStats("user");
  const assistantStats = textStats("assistant");

  const toolClass = (candidate: BriefCandidate): "mutation" | "readonly" | "unknown" => {
    const category = candidate.evidence?.category;
    return category === "mutation" || category === "readonly" ? category : "unknown";
  };
  const keptClass = { mutation: 0, readonly: 0, unknown: 0 };
  let toolErrorKept = 0;
  let toolGoalKept = 0;
  let toolBlockedKept = 0;
  for (const key of tools.selected.keys()) {
    const candidate = byKey.get(key)!;
    keptClass[toolClass(candidate)]++;
    if (candidate.evidence?.observedError) toolErrorKept++;
    if (candidate.hint?.goal) toolGoalKept++;
    if (candidate.hint?.blocked) toolBlockedKept++;
  }
  const omittedClass = { mutation: 0, readonly: 0, unknown: 0 };
  let toolErrorOmitted = 0;
  for (const candidate of tools.omitted) {
    omittedClass[toolClass(candidate)]++;
    if (candidate.evidence?.observedError) toolErrorOmitted++;
  }
  const totals = { mutation: 0, readonly: 0, unknown: 0, error: 0, goal: 0, blocked: 0 };
  let annotationGoalRejected = 0;
  let annotationBlockedRejected = 0;
  for (const candidate of candidates) {
    if (candidate.role !== "tool") continue;
    totals[toolClass(candidate)]++;
    if (candidate.evidence?.observedError) totals.error++;
    if (candidate.hint?.goal) totals.goal++;
    if (candidate.hint?.blocked) totals.blocked++;
    annotationGoalRejected += candidate.hintRejected?.goal ?? 0;
    annotationBlockedRejected += candidate.hintRejected?.blocked ?? 0;
  }

  const text = wrapLongLines(out.join("\n"));
  return {
    text,
    usedChars: text.length,
    counts: {
      userKept: textAllocations.user.keep.size,
      userFull: userStats.full,
      userExcerpted: userStats.excerpted,
      userFolded: textAllocations.user.folded.length,
      userKeptChars: userStats.keptChars,
      userSourceChars: userStats.sourceChars,
      assistantKept: textAllocations.assistant.keep.size,
      assistantFull: assistantStats.full,
      assistantExcerpted: assistantStats.excerpted,
      assistantFolded: textAllocations.assistant.folded.length,
      assistantKeptChars: assistantStats.keptChars,
      assistantSourceChars: assistantStats.sourceChars,
      toolKept: tools.selected.size,
      toolOmitted: tools.omitted.length,
      toolNormal: [...tools.selected.values()].filter((version) => version === "normal").length,
      toolShort: [...tools.selected.values()].filter((version) => version === "short").length,
      toolMutationKept: keptClass.mutation,
      toolReadonlyKept: keptClass.readonly,
      toolUnknownKept: keptClass.unknown,
      toolMutationOmitted: omittedClass.mutation,
      toolReadonlyOmitted: omittedClass.readonly,
      toolUnknownOmitted: omittedClass.unknown,
      toolErrorKept,
      toolErrorOmitted,
      toolGoalKept,
      toolBlockedKept,
      toolMutationTotal: totals.mutation,
      toolReadonlyTotal: totals.readonly,
      toolUnknownTotal: totals.unknown,
      toolErrorTotal: totals.error,
      toolGoalTotal: totals.goal,
      toolBlockedTotal: totals.blocked,
      annotationGoalRejected,
      annotationBlockedRejected,
    },
  };
};

const allocateOnce = (
  candidates: BriefCandidate[],
  bodyBudget: number,
  meter: CostMeter,
): BriefSelection => {
  if (candidates.length === 0) {
    return { kind: "ok", text: "", usedChars: 0, reservedChars: 0, counts: {} };
  }

  // A loop, not Math.min(...spread): a session with a six-figure number of
  // blocks would exceed the host's argument limit, and this scan runs first.
  let cheapest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const cost = candidate.role === "tool"
      ? meter.tool(candidate, "short")
      : Math.min(
          meter.text(candidate, Math.min(candidate.sourceText.length, BRIEF_MIN_TEXT_CHARS)),
          meter.text(candidate, candidate.sourceText.length),
        );
    if (cost < cheapest) cheapest = cost;
  }
  if (bodyBudget < cheapest) {
    return { kind: "budget-too-small", text: "", usedChars: 0, reservedChars: 0, counts: { budgetChars: bodyBudget } };
  }

  const users = candidates.filter((candidate) => candidate.role === "user");
  const assistants = candidates.filter((candidate) => candidate.role === "assistant");
  const tools = candidates.filter((candidate) => candidate.role === "tool");

  let userQuota = Math.floor(bodyBudget * 0.4);
  let assistantQuota = Math.floor(bodyBudget * 0.3);
  let toolQuota = bodyBudget - userQuota - assistantQuota;

  let userAlloc = allocateTextRole(users, userQuota, meter);
  let assistantAlloc = allocateTextRole(assistants, assistantQuota, meter);
  let toolAlloc = allocateToolRole(tools, toolQuota, meter);

  // Borrow unused quota, in order, only into roles that are not fully kept.
  for (let pass = 0; pass < 2; pass++) {
    let unused = bodyBudget - (userAlloc.used + assistantAlloc.used + toolAlloc.used);
    if (unused <= 0) break;
    let progressed = false;

    if (!userAlloc.full) {
      const next = allocateTextRole(users, userAlloc.used + unused, meter);
      if (next.used > userAlloc.used) {
        userQuota = userAlloc.used + unused;
        userAlloc = next;
        unused = bodyBudget - (userAlloc.used + assistantAlloc.used + toolAlloc.used);
        progressed = true;
      }
    }
    if (unused <= 0) break;
    if (!assistantAlloc.full) {
      const next = allocateTextRole(assistants, assistantAlloc.used + unused, meter);
      if (next.used > assistantAlloc.used) {
        assistantQuota = assistantAlloc.used + unused;
        assistantAlloc = next;
        unused = bodyBudget - (userAlloc.used + assistantAlloc.used + toolAlloc.used);
        progressed = true;
      }
    }
    if (unused <= 0) break;
    if (!toolAlloc.full) {
      const next = allocateToolRole(tools, toolAlloc.used + unused, meter);
      if (next.used > toolAlloc.used) {
        toolQuota = toolAlloc.used + unused;
        toolAlloc = next;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const assembled = assembleBriefBody(candidates, { user: userAlloc, assistant: assistantAlloc }, toolAlloc);
  return {
    kind: "ok",
    text: assembled.text,
    usedChars: assembled.usedChars,
    reservedChars: 0,
    counts: { ...assembled.counts, budgetChars: bodyBudget },
  };
};

/**
 * Allocate the new codemode brief. Text roles get independent budgets and
 * fold their oldest continuous range only when even the minimum excerpts do
 * not fit; tools take a short version first and upgrade with spare quota.
 * The final body is wrapped here; the wrapper retries with a reduced budget
 * if wrapping pushed it past `maxChars - reservedChars`.
 */
export const allocateBriefBudget = (
  candidates: BriefCandidate[],
  options: BriefAllocationOptions,
): BriefSelection => {
  const reservedChars = Math.max(0, Math.floor(options.reservedChars ?? 0));
  const total = Math.floor(options.maxChars) - reservedChars;
  // Content costs are exact after wrapping; the remaining difference is the
  // [user]/[assistant] section structure. Reserve the structure measured in
  // the previous attempt so a wrapped body never silently overshoots.
  const meter = createCostMeter();
  let structure = 0;
  let last: BriefSelection | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const selection = allocateOnce(candidates, total - structure, meter);
    last = selection;
    if (selection.kind === "budget-too-small") break;
    if (selection.usedChars <= total) {
      return { ...selection, reservedChars };
    }
    // Accumulate the overshoot against the current body budget. Replacing
    // the estimate with the last overage (used - total) can stall on the
    // narrow bands where role allocation stays sticky as the budget drops.
    structure += selection.usedChars - (total - structure);
  }
  return {
    kind: "budget-too-small",
    text: "",
    usedChars: 0,
    reservedChars,
    counts: last?.counts ?? {},
  };
};
