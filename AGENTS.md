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
- `src/core/`: summary pipeline (`normalize` → `filter-noise` → `build-sections` → `brief`/`rank` → `format`, driven by `summarize.ts`), recall (`recall-request.ts` parses the call, `recall-run.ts` runs it, `search-entries.ts` ranks), settings.
- `src/codemode/`: activation and historical-content gates, `// goal:` parsing, script/nested rendering, nested search text, nested file operations, prompt guidelines.
- `src/extract/`: one module per summary section (goals, files, commits, preferences, tracked commands).
- `src/commands/`, `src/tools/recall.ts`: `/pi-vcc`, `/pi-vcc-recall` and the `vcc_recall` tool.
- `docs/`: archived plans, reviews and patch notes; not part of the npm package.

## Rules

- Support the whole peer range (`>=1.0.0 <2.0.0`). Do not add fallbacks for older Pi hosts.
- Codemode behavior is two-layer: prompt guidelines follow the current active tools; historical rendering, brief and search follow message content (`codemode` calls or `nestedCalls`). A session without codemode records must behave like upstream.
- `#N` refs in summaries are session-wide entry indices that `vcc_recall` resolves. Any change to which entries are indexed must keep them stable.
- Agents act on recall and summary text (headers, hint lines, `Ignored:` notes). Treat it as an interface: change it on purpose, and update the tests that pin it.
- The smart keep-tail limit (25k) is pi-vcc's own and does not follow Pi's `compaction.keepRecentTokens`.
- The brief keeps 8 tool lines per assistant segment (upstream rule) and restores adjacent codemode lines within `CODEMODE_SEGMENT_CHARS` (1000). The quota is fork-only; direct tool lines must keep upstream's kept set.
- `scripts/codemode-brief-audit.ts` reads local sessions and writes aggregates under `research/`; it must never print message content.
- Tests that read settings set `PI_VCC_CONFIG_PATH` to a temp file, never the user's config. `tests/real-sessions.test.ts` runs only when `~/.pi/agent/sessions` exists.
- `research/` is git-ignored local data (real sessions, replays). Never commit it or quote session content in commits or PRs.
- Note user-facing changes in `CHANGELOG.md` under `[Unreleased]`.
