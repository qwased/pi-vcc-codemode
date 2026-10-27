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
}
