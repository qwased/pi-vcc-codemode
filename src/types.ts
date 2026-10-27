import type { NestedToolCalls } from "@earendil-works/pi-ai";

export type CompactionReason = "manual" | "threshold" | "overflow";

export interface FileOps {
  readFiles?: string[];
  modifiedFiles?: string[];
  createdFiles?: string[];
}

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; toolCallId?: string; sourceIndex?: number }
  | {
      kind: "tool_result";
      name: string;
      text: string;
      toolCallId?: string;
      nestedCalls?: NestedToolCalls;
      isError?: boolean;
      sourceIndex?: number;
    }
  | { kind: "bash"; command: string; output: string; exitCode: number | undefined; sourceIndex?: number };

/** How a script/tool step looks from the record, not proof that it succeeded. */
export type ActivityClass = "mutation" | "readonly" | "unknown";

export interface ScriptHint {
  goal?: string;
  blocked?: string;
}

export interface ActivityEvidence {
  category: ActivityClass;
  /** #N of the paired tool result, when pairing was verified. */
  resultIndex?: number;
  observedError: boolean;
  incomplete: boolean;
}
