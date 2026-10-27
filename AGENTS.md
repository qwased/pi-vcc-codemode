# AGENTS.md

pi-vcc-codemode is the codemode-aware fork of pi-vcc: a Pi extension with algorithmic compaction (no LLM call) plus `vcc_recall` over the raw session history. User-facing docs are in `README.md`; keep it short and put contributor notes here.

## Checks

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test
```

`bun.lock` pins Pi 1.4.0. CI also runs the suite on Pi 1.0.0, the minimum supported version; to do the same locally:

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.0.0 @earendil-works/pi-codemode@1.0.0
bun run typecheck
bun test
```

Restore the locked host afterwards with `bun install --frozen-lockfile --ignore-scripts`.

## Layout

- `index.ts`: registers everything below.
- `src/hooks/before-compact.ts`: the compaction hook: which messages are live, where to cut, smart keep-tail.
- `src/core/`: summary pipeline (`normalize` → `filter-noise` → `build-sections` → `brief`/`rank` → `format`, driven by `summarize.ts`), effective-history rebuild (`brief-history.ts`), full-field scan/read (`recall-full.ts`), recall (`recall-request.ts` parses the call, `recall-run.ts` runs it, `search-entries.ts` ranks), settings.
- `src/codemode/`: activation and historical-content gates, `// goal:` parsing, script/nested rendering, nested search text, nested file operations, prompt guidelines.
- `src/extract/`: one module per summary section (goals, files, commits, preferences, tracked commands).
- `src/commands/`, `src/tools/recall.ts`: `/pi-vcc`, `/pi-vcc-recall` and the `vcc_recall` tool.
- `docs/`: archived plans, reviews and patch notes; not part of the npm package.

## Rules

- Support the whole peer range (`>=1.0.0 <2.0.0`). Do not add fallbacks for older Pi hosts.
- Codemode gating is two-layer. Prompt guidelines follow the current active tools. The historical brief, rendering and search follow message content (`codemode` calls or `nestedCalls`). The brief gate is the effective history plus `hadCodemodeHistory` read before edits; a raw codemode record removed by context edits must keep the new path and must not fall back to the old summary merge. A session without codemode records must behave like upstream.
- The codemode brief budget is real UTF-16 characters, not tokens or words. `historyBlockCount` is the whole effective history; `budget = round(clamp(15 * count, 1100, 2000) * charsPerToken)`. The note, separators and headers are charged first; headers get at most 20% of what remains; the body starts at user 40 / assistant 30 / tool 30, with unused quota borrowable and oldest continuous ranges folded only when minimum excerpts do not fit. The retry must accumulate overshoot against the current body budget; a flat overage can stall on narrow bands. Long sessions reach the 2000-token ceiling earlier than the old window-only count.
- Annotations do not certify facts. `// goal:` is bounded intent text and `// blocked:` is a recent-only score signal; neither proves success, current state or completion. Blocked text is never rendered or put in Outstanding Context. Annotations cannot override observed errors or create effects/next/verify state.
- `[Session Goal]` is a condensed excerpt of user text, not an exhaustive task contract; key constraints come from the current user message, the saved original, or the plan files, not from this header.
- Keep the old direct-tool path intact. Non-codemode sessions, direct tool lines, the 8-line segment rule, the 120-line brief and the native search return text stay upstream-compatible; the new character-budget path replaces those local quotas only when the historical codemode gate is on.
- `#N` refs in summaries are session-wide entry indices that `vcc_recall` resolves; system entries occupy an index but are not rendered, and custom/compaction entries do not consume one. `scan` and `read` use the same canonical saved-field view and `#N` space, with versioned cursors, fixed file bounds, grapheme-safe windows and self-echo exclusion. Any change to which entries are indexed must keep them stable.
- Agents act on recall and summary text (headers, hint lines, `Ignored:` notes). Treat it as an interface: change it on purpose, and update the tests that pin it.
- The smart keep-tail limit (25k) is pi-vcc's own and does not follow Pi's `compaction.keepRecentTokens`.
- `scripts/codemode-brief-audit.ts` reads local sessions and writes aggregate counts and lengths under `research/`; it must never print or quote message content. Real-session evidence stays aggregated.
- Tests that read settings set `PI_VCC_CONFIG_PATH` to a temp file, never the user's config. `tests/real-sessions.test.ts` runs only when `~/.pi/agent/sessions` exists.
- `research/` is git-ignored local data (real sessions, replays). Never commit it or quote session content in commits or PRs.
- Note user-facing changes in `CHANGELOG.md` under `[Unreleased]`.
- `package.json` ships `src/**/*.ts`, so backups must never live in the published tree: keep them in the git-ignored `research/.backup/`, and keep `*.bak` excluded from `files`.
- Do not reduce candidate lists with `Math.min(...array)` / `Math.max(...array)`; a long branch can exceed the host argument limit. `tests/spread-min-guard.test.ts` pins the allocator and marker files.
