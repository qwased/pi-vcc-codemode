import { describe, expect, test } from "bun:test";
import { parseDeclaredIntent } from "../src/codemode/intent";

describe("parseDeclaredIntent", () => {
  test("reads // goal: from the first line when there are no options", () => {
    expect(parseDeclaredIntent("// goal: 验证登录流程\nawait tools.read({ path: 'a' });"))
      .toBe("验证登录流程");
  });

  test("reads line 2 when // @options: is first", () => {
    const code = '// @options: {"timeout_ms": 1000}\n// goal: inspect the cache\ntext("ok");';
    expect(parseDeclaredIntent(code)).toBe("inspect the cache");
  });

  test("does not scan past line 2", () => {
    const code = '// @options: {}\nconst x = 1;\n// goal: too late';
    expect(parseDeclaredIntent(code)).toBeNull();
  });

  test("does not accept a goal behind an unrelated first line", () => {
    expect(parseDeclaredIntent("// note\n// goal: hidden")).toBeNull();
  });

  test("tolerates goal case and whitespace around the marker", () => {
    expect(parseDeclaredIntent("  //   GOAL :   mixed case   ")).toBe("mixed case");
    expect(parseDeclaredIntent("//\tgoal:\tspaced")).toBe("spaced");
  });

  test("does not accept an empty goal", () => {
    expect(parseDeclaredIntent("// goal:   ")).toBeNull();
    expect(parseDeclaredIntent("// goal:")).toBeNull();
  });

  test("only the first physical line of the goal is the intent", () => {
    expect(parseDeclaredIntent("// goal: first line\nsecond line\nthird")).toBe("first line");
  });

  test("handles CRLF scripts", () => {
    expect(parseDeclaredIntent("// @options: {}\r\n// goal: windows\r\nprint(1);")).toBe("windows");
  });

  test("returns null for missing or non-script input", () => {
    expect(parseDeclaredIntent("")).toBeNull();
    expect(parseDeclaredIntent("const x = 1;")).toBeNull();
    expect(parseDeclaredIntent("// @options: {}\nconst x = 1;")).toBeNull();
    expect(parseDeclaredIntent(undefined as unknown as string)).toBeNull();
  });

  test("a goal inside the body is not a declaration", () => {
    expect(parseDeclaredIntent("const x = 1;\n// goal: body comment")).toBeNull();
  });
});
