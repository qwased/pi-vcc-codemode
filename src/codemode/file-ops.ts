import type { Message, NestedToolCalls } from "@earendil-works/pi-ai";
import { isCodemodeMessage } from "./active";

export interface NestedFileOps {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

/**
 * File operations recorded on codemode tool results, with the same rules as
 * Pi's compaction extractor: only `read`, `write` and `edit`, and only a
 * string `path` argument. Calls whose arguments Pi dropped for size carry no
 * path and are skipped.
 */
export const nestedFileOps = (messages: readonly Message[]): NestedFileOps => {
  const ops: NestedFileOps = { read: new Set(), written: new Set(), edited: new Set() };
  const add = (name: string, args: Record<string, unknown> | undefined): void => {
    const path = typeof args?.path === "string" ? args.path : undefined;
    if (!path) return;
    if (name === "read") ops.read.add(path);
    else if (name === "write") ops.written.add(path);
    else if (name === "edit") ops.edited.add(path);
  };
  for (const msg of messages) {
    if (!isCodemodeMessage(msg)) continue;
    const calls = (msg as { nestedCalls?: NestedToolCalls }).nestedCalls?.calls ?? [];
    for (const call of calls) add(call.name, call.arguments as Record<string, unknown> | undefined);
  }
  return ops;
};

export const nestedFileOpsCount = (ops: NestedFileOps): number =>
  ops.read.size + ops.written.size + ops.edited.size;
