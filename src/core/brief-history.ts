/**
 * Effective history for the codemode brief.
 *
 * The new brief is rebuilt from the raw current branch every compaction
 * instead of treating the previous summary as the only database. This module
 * produces the candidate input: raw messages before the retained tail, with
 * context edits applied through the host projection when any exist.
 */
import * as piCore from "@earendil-works/pi-coding-agent";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { isCodemodeMessage } from "../codemode/active";

/** Session message shape Pi stores on `type:"message"` entries (includes bashExecution). */
export type HistoryMessage = SessionMessageEntry["message"];

/**
 * In-memory stand-in for a compaction node on the shadow path handed to the
 * host projection. A plain custom entry contributes no context, so the
 * projection keeps the whole path instead of cutting at the checkpoint, while
 * every node id and parentId stays intact. Never persisted.
 */
export const SHADOW_COMPACTION_TYPE = "pi-vcc-brief-history-shadow";

export type BriefHistoryLimit = "edited-checkpoint" | "missing-history";

export interface BriefHistory {
  messages: HistoryMessage[];
  sourceIndices: Array<number | undefined>;
  /**
   * The raw current-branch window (before edits and any lower bound) contained
   * a codemode record. Decides the new-path gate together with the effective
   * messages, so an edit that removes every codemode record cannot fall back
   * to the old summary merge.
   */
  hadCodemodeHistory: boolean;
  hasContextEdits: boolean;
  limitedReason?: BriefHistoryLimit;
}

export interface BriefHistoryOptions {
  /** Current branch path (root → leaf), including compaction nodes. */
  branchEntries: readonly any[];
  /** Entry id that starts the retained tail; empty/undefined = compact all. */
  firstKeptEntryId?: string;
  skipCustomTypes?: readonly string[];
  /** Entry id → session-global `#N` (core/global-indices.ts). Missing → no ref. */
  globalIndexById?: Map<string, number>;
  /** Test seam; defaults to the host's `buildSessionProjection`. */
  project?: (entries: any[]) => Array<{ sourceEntry: any; messages: any[] }>;
}

const defaultProject = (entries: any[]): Array<{ sourceEntry: any; messages: any[] }> => {
  // Namespace access preserves loading on older supported hosts without this
  // export; edited history on such a host fails closed (same rule as
  // collectLiveMessages) instead of resurrecting omitted content.
  const project = (piCore as any).buildSessionProjection;
  if (typeof project !== "function") {
    throw new Error("Context-edited history requires Pi's buildSessionProjection");
  }
  return project(entries).entries;
};

const isHistoryMessage = (entry: any, skipCustomTypes: readonly string[]): boolean => {
  if (entry?.type !== "message" || entry.message == null) return false;
  const message = entry.message;
  // system messages occupy a #N index but are not conversation content.
  if (message.role === "system") return false;
  // `!!` bash entries are excluded from the LLM context by Pi itself.
  if (message.role === "bashExecution" && message.excludeFromContext) return false;
  if (message.role === "custom" && skipCustomTypes.includes(message.customType)) return false;
  return true;
};

/**
 * Build the effective history for the new codemode brief.
 *
 * Order of operations (§8.3): resolve the retained tail on the original path
 * first, then project edits — so an edit located in the tail still applies to
 * the old message it targets. When a checkpoint itself was edited, history is
 * limited to the entries after the most recent edited checkpoint: its
 * summarized prefix is not rebuilt, and no old header may reintroduce it.
 */
export const buildBriefHistory = (options: BriefHistoryOptions): BriefHistory => {
  const entries = options.branchEntries ?? [];
  const skipCustomTypes = options.skipCustomTypes ?? [];
  const hasContextEdits = entries.some((entry) => entry?.type === "context_edit");
  const empty: BriefHistory = { messages: [], sourceIndices: [], hadCodemodeHistory: false, hasContextEdits };

  let boundary = entries.length;
  if (options.firstKeptEntryId) {
    const index = entries.findIndex((entry) => entry?.id === options.firstKeptEntryId);
    // Without the boundary the tail cannot be excluded; fail closed rather
    // than guessing a range that may duplicate retained content.
    if (index < 0) return { ...empty, limitedReason: "missing-history" };
    boundary = index;
  }

  const indexById = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (typeof entry?.id === "string") indexById.set(entry.id, index);
  });

  const rawWindow = entries
    .slice(0, boundary)
    .filter((entry) => isHistoryMessage(entry, skipCustomTypes));
  const hadCodemodeHistory = rawWindow.some((entry) => isCodemodeMessage(entry.message));

  if (!hasContextEdits) {
    return {
      messages: rawWindow.map((entry) => entry.message as HistoryMessage),
      sourceIndices: rawWindow.map((entry) => options.globalIndexById?.get(entry.id)),
      hadCodemodeHistory,
      hasContextEdits,
    };
  }

  let lowerBound = -1;
  for (const entry of entries) {
    if (entry?.type !== "context_edit") continue;
    const target = indexById.get(entry.targetId);
    if (target !== undefined && entries[target]?.type === "compaction") {
      lowerBound = Math.max(lowerBound, target);
    }
  }

  const shadow = entries.map((entry) =>
    entry?.type === "compaction" ? { ...entry, type: "custom", customType: SHADOW_COMPACTION_TYPE } : entry,
  );
  const projected = (options.project ?? defaultProject)(shadow);

  const messages: HistoryMessage[] = [];
  const sourceIndices: Array<number | undefined> = [];
  for (const { sourceEntry, messages: entryMessages } of projected) {
    const position = indexById.get(sourceEntry?.id);
    if (position === undefined || position >= boundary || position <= lowerBound) continue;
    if (!isHistoryMessage(sourceEntry, skipCustomTypes)) continue;
    for (const message of entryMessages) {
      messages.push(message as HistoryMessage);
      sourceIndices.push(options.globalIndexById?.get(sourceEntry.id));
    }
  }

  return {
    messages,
    sourceIndices,
    hadCodemodeHistory,
    hasContextEdits,
    ...(lowerBound >= 0 ? { limitedReason: "edited-checkpoint" as const } : {}),
  };
};

/**
 * New-path gate: either the effective history still holds codemode records, or
 * the raw window did before edits. Never keyed on the currently active tools.
 */
export const briefHistoryHasCodemode = (history: BriefHistory): boolean =>
  history.hadCodemodeHistory || history.messages.some((message) => isCodemodeMessage(message as any));
