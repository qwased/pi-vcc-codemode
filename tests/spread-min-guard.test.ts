import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Math.min(...array) throws "Maximum call stack size exceeded" once the
 * argument count passes the host limit (V8 rejects around 130k). The test
 * runtime (Bun/JSC) tolerates far more, so a runtime stress test cannot pin
 * the fix; the source guard can.
 */
const SOURCES = ["src/core/rank.ts", "src/core/brief.ts", "src/core/fences.ts"];

describe("allocator avoids argument-spread reductions", () => {
  for (const file of SOURCES) {
    it(`has no Math.min/Math.max spread in ${file}`, () => {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8")
        // Comments may discuss the pattern; only code matters.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const matches = source.match(/Math\.(?:min|max)\(\s*\.\.\./g) ?? [];
      expect(matches).toEqual([]);
    });
  }
});
