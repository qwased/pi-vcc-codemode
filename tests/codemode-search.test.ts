import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { renderMessage } from "../src/core/render-entries";
import { searchEntries } from "../src/core/search-entries";
import { codemodeCall, codemodeResult, codemodeScript, nestedCall } from "./codemode-fixtures";

const search = (messages: Message[], query: string): number[] => {
  const entries = messages.map((message, index) => renderMessage(message, index, true));
  return searchEntries(entries, messages, query).map((hit) => hit.index);
};

describe("codemode nested search", () => {
  test("nested arguments and errors are searchable", () => {
    const messages = [
      codemodeCall(codemodeScript("调查流程", "return 1;")),
      codemodeResult({
        text: "Script completed",
        calls: [
          nestedCall({ name: "read", arguments: { path: "src/NESTED_TARGET.ts" } }),
          nestedCall({
            name: "bash",
            arguments: { command: "echo NESTED_COMMAND" },
            status: "error",
            error: "NESTED_ERROR_MARKER",
          }),
        ],
      }),
    ] as Message[];

    expect(search(messages, "NESTED_TARGET")).toEqual([1]);
    expect(search(messages, "NESTED_COMMAND")).toEqual([1]);
    expect(search(messages, "NESTED_ERROR_MARKER")).toEqual([1]);
  });

  test("a nested vcc_recall call does not match its own query", () => {
    const messages = [
      codemodeCall(codemodeScript("recall check", "return 1;")),
      codemodeResult({
        text: "Script completed",
        calls: [
          nestedCall({ name: "vcc_recall", arguments: { query: "SELF_QUERY_MARKER" } }),
          nestedCall({ name: "VCC_RECALL", arguments: { query: "SELF_QUERY_MARKER" } }),
        ],
      }),
    ] as Message[];

    expect(search(messages, "SELF_QUERY_MARKER")).toEqual([]);
  });

  test("the outer script body is still searchable; self-match remains a known P3 gap", () => {
    // This test documents the P1 boundary rather than claiming a fix: the
    // codemode script is indexed through its ordinary toolCall arguments.
    const messages = [
      codemodeCall(codemodeScript(
        "outer self match",
        "await tools.vcc_recall({ query: 'OUTER_SELF_MARKER' });",
      )),
      codemodeResult({ text: "Script completed", calls: [] }),
    ] as Message[];

    expect(search(messages, "OUTER_SELF_MARKER")).toEqual([0]);
  });

  test("non-codemode messages gain no nested search text", () => {
    const messages = [
      {
        role: "toolResult",
        toolCallId: "tc_plain",
        toolName: "read",
        content: [{ type: "text", text: "plain result" }],
        isError: false,
        timestamp: 0,
      } as Message,
    ];
    expect(search(messages, "plain")).toEqual([0]);
    expect(search(messages, "nested")).toEqual([]);
  });
});
