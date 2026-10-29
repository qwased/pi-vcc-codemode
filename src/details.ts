import type { CompactionReason } from "./types";
import type { BriefHistoryLimit } from "./core/brief-history";

export interface PiVccCompactionDetails {
  compactor: "pi-vcc";
  version: number;
  sections: string[];
  sourceMessageCount: number;
  previousSummaryUsed: boolean;
  reason?: CompactionReason;
  willRetry?: boolean;
  /** Messages in the effective history the new codemode brief was rebuilt from. */
  briefHistoryMessageCount?: number;
  /** Set when history was cut short (edited checkpoint or a missing node). */
  briefHistoryLimited?: BriefHistoryLimit;
  /**
   * Actual character budget of the new codemode brief (0.1.5). Older records
   * lack it; a reader must report "budget unknown" instead of guessing.
   * `usedChars + reservedChars` equals the summary length for an ok brief.
   */
  briefBudget?: {
    charsPerToken: number;
    /** normalize() blocks of the effective history (not the message count). */
    historyBlockCount: number;
    maxChars: number;
    usedChars: number;
    reservedChars: number;
  };
}
