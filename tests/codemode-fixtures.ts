import type { Message } from "@earendil-works/pi-ai";
import { assistantWithToolCall } from "./fixtures";

export interface NestedCallFixture {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  status: "ok" | "error" | "unfinished";
  durationMs?: number;
  error?: string;
}

export interface NestedCallsFixture {
  calls: NestedCallFixture[];
  complete: boolean;
}

/**
 * A codemode script with the Pi 1.4 first-line options rule. The target comment
 * is first when there are no options and second when the options line is present.
 */
export const codemodeScript = (goal: string, body: string, options = true): string =>
  options
    ? `// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}\n// 目标：${goal}\n${body}`
    : `// 目标：${goal}\n${body}`;

export const codemodeCall = (code: string, id = "tc_codemode"): Message => ({
  ...assistantWithToolCall("codemode", { code }),
  content: [{ type: "toolCall", id, name: "codemode", arguments: { code } }],
} as Message);

export const nestedCall = (
  overrides: Partial<NestedCallFixture> & Pick<NestedCallFixture, "name">,
): NestedCallFixture => ({
  id: `call/${overrides.name}`,
  status: "ok",
  ...overrides,
});

export const codemodeResult = (options: {
  toolCallId?: string;
  text?: string;
  calls?: NestedCallFixture[];
  complete?: boolean;
  isError?: boolean;
} = {}): Message => ({
  role: "toolResult",
  toolCallId: options.toolCallId ?? "tc_codemode",
  toolName: "codemode",
  content: [{ type: "text", text: options.text ?? "Script completed\nok" }],
  nestedCalls: { calls: options.calls ?? [], complete: options.complete ?? true },
  isError: options.isError ?? false,
  timestamp: 0,
} as unknown as Message);

/** The shape of one `codemode-store` custom entry. */
export const codemodeStore = (set: Record<string, unknown>, del: string[] = []) => ({
  set,
  delete: del,
});

/** A script longer than the recall preview cap, with a unique tail marker. */
export const longCodemodeCode = (goal: string, tail: string, bodyLength = 2600): string =>
  codemodeScript(goal, `${"const x = 1;\n".repeat(Math.ceil(bodyLength / 12))}text("${tail}");`);
