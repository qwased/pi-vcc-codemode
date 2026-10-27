import { describe, expect, test } from "bun:test";
import { parseDeclaredIntent, parseScriptHints } from "../src/codemode/intent";

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

  test("reads a goal from the opening three comment lines", () => {
    expect(parseDeclaredIntent("// note\n// goal: hidden")).toBe("hidden");
    expect(parseDeclaredIntent("// note\n// other\n// goal: third line")).toBe("third line");
    expect(parseDeclaredIntent('// @options: {}\n// note\n// goal: after options')).toBe("after options");
  });

  test("stops at the first non-empty non-comment line", () => {
    expect(parseDeclaredIntent("// note\nconst x = 1;\n// goal: too late")).toBeNull();
    expect(parseDeclaredIntent("// note\n\n// goal: still header")).toBe("still header");
    expect(parseDeclaredIntent("// one\n// two\n// three\n// goal: fourth")).toBeNull();
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

describe("parseScriptHints", () => {
  test("parses goal and blocked together, case-insensitively", () => {
    expect(parseScriptHints("// GOAL: check cache\n// Blocked : waiting on db\ntext('ok');")).toEqual({
      hint: { goal: "check cache", blocked: "waiting on db" },
      rejected: { goal: 0, blocked: 0 },
    });
  });

  test("only the first compliant value of each kind is kept", () => {
    const parsed = parseScriptHints("// goal: first\n// goal: second\n// blocked: a");
    expect(parsed.hint).toEqual({ goal: "first", blocked: "a" });
  });

  test("rejects empty and overlong values with counts", () => {
    const long = "x".repeat(201);
    const parsed = parseScriptHints(`// goal:\n// goal: ${long}\n// blocked: ${long}`);
    expect(parsed.hint).toEqual({});
    expect(parsed.rejected).toEqual({ goal: 2, blocked: 1 });
  });

  test("ignores unknown markers and markers outside the header region", () => {
    const parsed = parseScriptHints("// next: do more\nconst x = 1;\n// blocked: body");
    expect(parsed.hint).toEqual({});
    expect(parsed.rejected).toEqual({ goal: 0, blocked: 0 });
  });
});
