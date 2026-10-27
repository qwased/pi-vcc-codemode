# pi-vcc-codemode

[![npm](https://img.shields.io/npm/v/pi-vcc-codemode)](https://www.npmjs.com/package/pi-vcc-codemode)

Codemode-aware fork of [pi-vcc](https://github.com/sting8k/pi-vcc) for [Pi](https://github.com/badlogic/pi-mono). It compacts conversations without calling an LLM, and keeps what a codemode script was trying to do, which tools it called, and what happened inside the script readable after compaction.

Inspired by [VCC](https://github.com/lllyasviel/VCC) (View-oriented Conversation Compiler).

## Why this fork

Pi's `codemode` tool lets the model run one JavaScript script that calls many tools. That is efficient while the session is live, but the transcript records the script as one `codemode` call and one tool result. The nested calls are stored in `nestedCalls` on the result, outside the text a normal compactor reads.

Upstream pi-vcc compacts that transcript correctly but opaquely: the compact brief says `* codemode`, and recall shows `codemode(code)`. After compaction the agent can see that a script ran, but not:

- why it ran,
- which tools it touched,
- which side effects completed before a failure,
- which arguments or errors were involved.

The agent then tends to re-read the same files, re-run the same tests, or repeat writes. This fork keeps a bounded, deterministic view of those facts in the summary, brief, recall and search. No model call is added, and sessions without codemode records keep upstream behavior.

## What changes in codemode sessions

| After compaction | Upstream pi-vcc | pi-vcc-codemode |
|---|---|---|
| codemode call in the brief | `* codemode` | `* codemode intent: Verify the login flow (#42)` |
| codemode call in recall | `codemode(code)` | a bounded script preview, 300 chars in the list and 1,500 chars in expand |
| nested calls | not rendered; only the result text is visible | one line for the last 12 calls (32 in expand), with name, arguments, status, error and duration |
| failed script | the visible error | the same error plus the nested calls that succeeded before it |
| files touched | only direct tool calls | also the writes and edits inside codemode scripts, with entry indices and `#N:path` drill-down |
| search | visible message and tool-argument text | also indexes nested names, arguments, statuses and errors, up to 2,000 chars per result |
| model guidance | none | two prompt rules while codemode is active; the recall rule is added only while `vcc_recall` is active |
| sessions without codemode records | upstream behavior | the same rendering, brief and search |

The tool names in the brief come from a source-level scan of `tools.<name>(...)`. They are a declaration of what the script intends to call, not proof that a call ran. Execution status comes from Pi's nested-call record.

## Example

```js
// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}
// goal: Find why login fails after a password reset
const session = await tools.read({ path: "src/auth/session.ts" });
const result = await tools.bash({ command: "bun test tests/auth.test.ts" });
text(result.output);
```

The compact brief keeps a historical navigation line:

```
* codemode intent: Find why login fails after a password reset (#42)
```

The line records what the script was trying to do, not proof that it succeeded. The declared tool names are no longer repeated in the brief; the nested-call record and recall still show what ran.

Recall keeps a script preview, and the tool result keeps what actually ran:

```
codemode(code=// @options: ... // goal: Find why login fails after a password reset ...)

[codemode] Script failed
Error: 1 test failed
nested: read(path=src/auth/session.ts) 4ms, bash(command=bun test tests/auth.test.ts) error exit 1 812ms
```

The failed bash call now has a visible history: the read succeeded, then the test failed. Without the nested line, only the script's final error survives.

## The `// goal:` marker

The intent is read from the opening `//` comment block, at most three lines. `// @options:` must stay on line 1; `// goal:` can be on any of those lines:

```js
// @options: {"timeout_ms": 60000}
// goal: <intended outcome>
// blocked: <optional, recent-signal only>
```

The markers are matched case-insensitively and tolerate whitespace (`//goal:`, `// GOAL :`). The parser stops at the first non-empty, non-comment line, so comments in the body are not scanned. `// goal:` is shown as `intent:`, capped at 200 chars; without it the brief falls back to a `code:` preview of at most 80 chars. `// blocked:` is never rendered and never enters `[Outstanding Context]`; it can only add a small score when the event is in the recent quarter, and repeated markers do not accumulate. Neither marker is proof of success or current state.

The guideline asks the model to write the goal in the same language as the user's request and to describe intent, not success. Model compliance is not guaranteed. If the marker is missing, the script still compacts and renders through the code-preview fallback.

## Two-layer behavior

The fork deliberately uses two different gates:

- **Prompt layer follows active tools.** The guidelines are appended in `before_agent_start` only while `codemode` is active, in both `mode:"on"` and `mode:"only"`. The recall rule is also gated on `vcc_recall` being active. In `mode:"only"` the active set still contains the hidden declarations; if the codemode catalog omits `vcc_recall`, the rule tells the model to call `tools.vcc_recall` from a script.
- **Historical layer follows message content and effective edits.** A codemode call, or any tool result with `nestedCalls`, keeps the rich rendering and search text even after codemode is disabled or in an older session. Compaction rebuilds the codemode brief from the effective current branch (context edits applied), not from the active tool set; if edits remove every codemode record, the new path still runs instead of falling back to the old summary merge. Turning codemode off stops new prompt rules; it does not make old codemode history opaque.

Direct tool calls next to a codemode call keep the upstream path. `mode:"on"` does not change how `read`, `bash` or other direct calls render.

## Install

Requires Pi 1.0 or newer (`>=1.0.0 <2.0.0`).

```bash
pi install npm:pi-vcc-codemode
```

Or from GitHub:

```bash
pi install https://github.com/qwased/pi-vcc-codemode
```

Or try without installing:

```bash
pi -e https://github.com/qwased/pi-vcc-codemode
```

Install this package **or** upstream pi-vcc, not both: both register `/pi-vcc`, `/pi-vcc-recall`, the `vcc_recall` tool and the same `pi-vcc-config.json`. If you already use upstream, remove it before installing this fork.

The fork keeps upstream names for its commands, `vcc_recall` and the settings file, so existing instructions for pi-vcc still apply and an existing config carries over.

## Usage

pi-vcc runs automatically when your context window fills up, or on demand:

- `/pi-vcc` compacts now, keeping the last user turn.
- `/pi-vcc keep:N [prompt]` keeps the last `N` user turns (`keep:0` compacts everything) and sends the optional prompt to the agent afterwards.

With the default `keep:1`, a small tail is grown automatically (see `smartKeepTail`). To leave `/compact` and automatic compactions to Pi core, set `overrideDefaultCompaction: false`.

On a short session `/pi-vcc` can answer "Nothing to compact yet" whatever `keep:N` says: Pi stops before any extension runs while the whole session still fits in the recent part it always keeps (`compaction.keepRecentTokens` in Pi's settings).

### Codemode sessions

When codemode is active, the injected prompt rules ask the model to use `vcc_recall` for earlier context when that tool is available, and to start each script with a one-line `// goal: ...` in the user's language.

Compaction then shows that goal as `intent:` instead of the script head; the tools the script names remain in the call record and recall, not in the brief line. A tool result that ran other tools lists the nested calls with their arguments, status, error and duration, so a failed script still records what ran before it. The record is what Pi saved and may be incomplete; summary text is a preview, and the original message stays in the session.

`vcc_recall` also has two explicit actions for the full saved record: `scan:true` searches every saved field literally, including text past the default 2,000-character index, and `read` pages through one record's canonical field view. Both use the same session file and `#N` space; see [Recall](#recall).

## Compacted message structure

The block below is the non-codemode/upstream shape; codemode sessions use the historical brief described after it.

```
[Session Goal]
- Fix the authentication bug in login flow
- [Scope change]
- Also update the session token refresh logic

[Files And Changes]
- Modified: src/auth/session.ts
- Created: tests/auth-refresh.test.ts

[Commits]
- a1b2c3d: fix(auth): refresh token after password reset

[Tracked Commands]
- docker: docker compose restart api 2>&1

[Outstanding Context]
- lint check still failing on line 42

[User Preferences]
- Prefer Vietnamese responses
- Always run tests before committing

---

...(28 earlier lines omitted)

[user]
Fix the auth bug, users can't log in after password reset

[assistant]
Root cause is a missing token refresh after password reset... (#11)
* bash "bun test tests/auth.test.ts" (#12)
* edit "src/auth/session.ts" (#14)
* bash "docker compose restart api 2>&1" (#15)
* bash "bun test tests/auth.test.ts" (#16)

---

Use `vcc_recall` to search for prior work, decisions, and context from before this summary. Do not redo work already completed.
```

Codemode sessions use a different brief. It opens with a single historical-navigation note, then keeps user, assistant and tool lines in original order under separate character budgets (initially 40/30/30 of what remains after the note and headers). Short text stays whole; long text keeps a head and tail with `[omitted M of T chars; recall #N]`; when even minimum excerpts do not fit, the oldest continuous range is folded with a counted search boundary. The body is rebuilt from effective history on every compaction, so earlier intent and write steps are re-selected instead of only rolling the previous brief's tail. Non-codemode sessions do not use this path.

`[Session Goal]` is a condensed excerpt, not the full task contract; use the saved original (or `vcc_recall`) for constraints.

A section only appears when it has something to say; a session with no git commits has no `[Commits]`. Ordinary tool calls in non-codemode sessions keep the upstream one-line format.

| Section | Contents |
|---|---|
| `[Session Goal]` | Initial goal and scope changes |
| `[Files And Changes]` | Files modified, created or read (capped, paths trimmed to a common root) |
| `[Commits]` | Last 8 commits made in the session (hash + subject) |
| `[Tracked Commands]` | Recent runs of only the commands listed in `trackCommands` (off by default) |
| `[Outstanding Context]` | Unresolved errors and pending questions |
| `[User Preferences]` | Lines like "always...", "never...", "prefer..." from user messages |
| Brief transcript | The conversation in order, about 120 recent lines, each tool call shortened to one line with a `(#N)` ref |

For non-codemode sessions, on the next compaction the sections are merged with the previous summary and re-capped, and the transcript rolls forward.

## Recall

Pi's default compaction drops old messages for good. `vcc_recall` reads the raw session file instead, so anything compacted away stays reachable. It searches the active conversation lineage by default; `scope:"all"` also covers edited or retried branches. Only the current session is searchable.

Plain keywords work best. Multi-word queries are OR-matched and ranked, rare terms weigh more, and a regex is accepted (falling back to keywords if it matches nothing):

```
vcc_recall({ query: "auth token" })                  // ranked OR search
vcc_recall({ query: "auth token", page: 2 })         // 5 results per page
vcc_recall({ query: "hook|inject" })                 // regex
vcc_recall({ query: "auth token", scope: "all" })    // all lineages
```

In a codemode session, a query also matches text that appeared only inside a nested call, such as a file read or a failed command:

```
vcc_recall({ query: "tests/auth.test.ts" })
```

The `#N` refs in a summary, such as `(#1253)`, are the same numbers recall uses, so the agent can go straight to them:

```
vcc_recall({ range: [1250, 1290] })                  // entries in order, 20 per page
vcc_recall({ expand: [1253] })                       // expanded preview; long scripts stay clipped
vcc_recall({ mode: "touched" })                      // files worked on, with #N
vcc_recall({ query: "#1253:auth.ts" })               // a file's content from #1253
```

Plain `query` is a relevance search over bounded text: 5 hits per page, a 50-hit cap, 200-character snippets, and up to 2,000 characters of a message's tool arguments and nested calls. It stays approximate. Two explicit actions use the complete saved field view instead — every tool argument, deep object/array value, nested-call argument and tool result:

```
vcc_recall({ query: "失效条件", scan: true, scope: "all" })   // literal scan, 20 messages per page
vcc_recall({ query: "失效条件", scan: true, cursor: "..." })   // resume a partial scan
vcc_recall({ read: { index: 41, offset: 0, length: 4000 } })  // page one record's full view
```

`scan` is a case-insensitive literal substring match (no regex, stemming, fuzzy matching or Unicode normalization). It returns a versioned cursor when partial, never reports a timed-out range as "no matches", and marks malformed records as incomplete coverage. A scan fixes the file bound when it starts, so recall messages appended during the scan are not included. `read` returns `actualStart`, `actualEnd`, `total`, `remaining` and a copyable next call, never splits a grapheme, and names verified `toolCallId`-paired results. Both exclude system messages, thinking/image blocks and the recall tool's own arguments/results.

Each call does one of these. `page` and `scope` work with all of them, and a param the call cannot use is named in the output instead of dropped silently.

The same search as a slash command, with results shown in the chat and passed to the agent:

```
/pi-vcc-recall auth token scope:all
/pi-vcc-recall scan:true scope:all auth token
/pi-vcc-recall read:41 offset:0 length:4000 scope:all
```

## How it works

1. Pick the cut: everything before the kept tail is summarized, the tail stays as is.
2. Normalize Pi messages into uniform blocks and drop noise (system messages, empty blocks).
3. Extract the sections and the brief. Non-codemode sessions keep the upstream brief. Codemode sessions rebuild the body from effective history with per-role character budgets and exactly one reading note.
4. Merge the previous summary for non-codemode sessions. Codemode sessions merge headers under the existing rules when there are no edits, rebuild them from effective sources when edits exist, and keep `[Outstanding Context]` fresh-only; the body does not merge the old brief.

No step calls a model, and token counts are estimated from the session's own numbers.

## Config

Config lives at `pi-vcc-config.json` in Pi's agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR` if set) and is created with these defaults on first load:

```json
{
  "overrideDefaultCompaction": true,
  "smartKeepTail": true,
  "debug": false,
  "skipForProviders": [],
  "skipCustomTypes": [],
  "trackCommands": []
}
```

- **`overrideDefaultCompaction`** *(default `true`)*: pi-vcc handles `/pi-vcc`, `/compact` and automatic compactions. With `false` it only handles `/pi-vcc`. Existing config files keep their value.
- **`smartKeepTail`** *(default `true`)*: if the `keep:1` tail is under 5k tokens, keep as many turns as fit in 25k. This is pi-vcc's own limit; Pi's `compaction.keepRecentTokens` does not change it. An explicit `keep:N` is always respected.
- **`debug`** *(default `false`)*: write details of each compaction (message counts, cut, sections, token calibration) to `pi-vcc-debug.json` in the OS temp directory.
- **`skipForProviders`** *(default `[]`)*: providers for which pi-vcc steps aside, so another compaction extension can handle them. Compared case-insensitively with Pi's provider id (see `/model`; Grok is `xai`). Checked on every compaction; `/pi-vcc` always runs.
- **`skipCustomTypes`** *(default `[]`)*: `customType` values of `custom_message` entries to leave out of the summary, for per-turn boilerplate other extensions inject (skill cards, guidance blocks). Exact, case-sensitive match; look for `"type":"custom_message"` in your session file to find the value. Only the summary input changes, not the cut.
- **`trackCommands`** *(default `[]`)*: commands to remember across compactions, listed in a `[Tracked Commands]` section. Any command or prefix works: `["ssh", "kubectl", "docker"]`, `["psql", "./deploy.sh"]`, or `"gh pr"` (matches `gh pr merge`, not `gh run`). Each entry is the command as written, up to the next shell separator outside quotes, with any `sudo`/`env`/`VAR=` prefix kept; the 10 most recent per command are kept. Only `bash` calls are read, and only `ssh` remote commands are looked into, not `sh -c` or `docker exec`. Empty = off.

## Compatibility and limits

- **Pi 1.0 or newer** is required. The fork starts from pi-vcc 0.10.2 and drops the old automatic post-compaction continue fallback: Pi 1.0 resumes the run itself. The marker left in older sessions is still filtered.
- **Non-codemode sessions are unchanged.** Rendering, the brief, search, cut selection and settings match upstream; golden tests pin the upstream output.
- **Non-codemode briefs keep the upstream 8-line/120-line path.** That cap and the 1,000-character codemode-line restoration are unchanged for sessions without codemode records; direct tool lines keep upstream's kept set, and the default query return text is unchanged.
- **Codemode briefs are historical navigation with real character budgets.** User/assistant text and `intent:` are past statements, not current state or proof of success; tool names describe calls or script structure. The body follows effective edits and can differ from the saved original; `#N` points at the saved original, and `scan`/`read` read that original. Text has independent user/assistant budgets (initially 40/30/30 with tools), long text gets head/tail excerpts, and only when minimum excerpts do not fit is the oldest continuous range folded. There is no fixed 16-user or 80-block cap, and codemode lines are no longer re-cut by the old 8-line/1,000-character rule.
- **Long sessions reach the effective budget ceiling earlier.** `historyBlockCount` now counts the whole effective history, not just the current window, so repeated compaction pushes the 15-per-block estimate to the 2,000-token ceiling sooner. This raises the effective character budget for long sessions; it is a behavior change, not a new setting, and the final body still stays within the effective budget.
- **Script previews in `expand` are head-only.** Recall shows 300 chars in the list and 1,500 in expand, and long nested arguments stay clipped. Use `read` for the complete saved fields of one record, or `scan` to find text that the default query's 2,000-character index did not cover.
- **`scan` and `read` have their own bounds.** `scan` returns 20 messages and at most 8,000 characters per page, checks a soft 3-second budget between complete records, and reports only one snippet per message (the first match); continue with the cursor to enumerate the rest. `read` defaults to 4,000 UTF-16 units per page and caps a request at 12,000; a single pathological grapheme larger than that cannot be paged past, and the output says so explicitly rather than returning an empty page.
- **Default search and nested rendering remain bounded.** The list shows the last 12 calls, expand shows the last 32, and default search indexes the first 2,000 chars of a record. Pi may also save an incomplete nested record; the output marks it as `[record incomplete]`. `scan`/`read` cover what was saved, not data Pi never wrote.
- **`mode:'touched'` lists files written or edited from codemode scripts**, except calls whose arguments Pi dropped for size (over 8 KB per call or 32 KB per script); the output says how many were dropped. Files written through `apply_patch` (paths inside the diff) or bash redirects remain invisible.
- **The `intent:` text is a declaration.** It is read from the opening comment block, not from execution; a tool name in the source is not proof that the call ran. The nested record is the execution evidence; `// blocked:` is only a bounded recency signal and is not rendered.
- **No codemode store projection.** `scan` and `read` are explicit new recall parameters; the default query, expand, range and touched behavior are unchanged.

## Verification

The 0.1.3 candidate passes 622 tests and `bun run typecheck` on Pi 1.4.0 (locked) and on a temporary Pi 1.0.0 copy. The offline audit of 15 local codemode sessions found 0 over-budget briefs, 0 note violations and 0 unmarked header omissions (aggregates only); it is not a task-outcome experiment. The production brief seam was also run on a copy of the development session (189 entries, 174 codemode messages): keep:1 used 7,928 of 8,000 chars with one note and no over-budget or header truncation; `scan` completed a 10-page/182-hit query; the longest hit was read in 11 pages with exact reassembly. This is one session's behavior check, not a task-outcome experiment.

At the 0.1.1 release, `bun test` passes 485 tests on Pi 1.4.0 and on Pi 1.0.0, and `bun run typecheck` passes on both hosts. 0.1.1 is a documentation and metadata release; runtime behavior is unchanged from 0.1.0.

The 0.1.2 release passes 517 tests and typecheck on both Pi 1.4.0 and Pi 1.0.0. An offline audit of 6 local codemode-only sessions (`scripts/codemode-brief-audit.ts`, aggregates only) found that the 1,000-character allowance lowers codemode-line discard from 47% (141/301 lines) to 17% (52/301); every ref of a still-dropped line fell inside the marker's range. The same audit measured merge pressure: the fresh brief's median line count grew from 75 to 86.5, leaving the previous summary a median of 33.5 of the 120 merge lines instead of 45.

A small real-session check at 0.1.2 on Pi 1.4.0 (`huawei/deepseek-v4.1-flash`, codemode `mode:"only"`, `inlineBudget: 5000`, forced compaction) showed:

- upstream brief `* codemode` versus fork brief `* codemode -> read, bash | goal: <intent>`; the two summaries were 708 and 733 chars, a 25-char difference. The raw output naming which side was longer was not kept, but in that pair the intent line did not add a measurable size penalty;
- cost depends on session shape: each distinct goal gets its own line, identical goals merge, and when codemode calls follow each other with no assistant text, upstream folds every `* codemode` line into one. In a 13-turn session of that shape the 0.1.1 fork's brief was about 2.2x longer (985 vs 456 chars). With assistant text between calls, upstream drops tool lines beyond 8; the current fork restores adjacent codemode lines within its 1,000-char allowance, so its brief carries more refs there;
- with no goal instruction in the prompt, the fork's model wrote `// goal:` on its own while the upstream model did not (fork 742 vs upstream 716 chars);
- after compaction, a codemode script called `tools.vcc_recall`, got 4 `#N` matches with nested status `ok`, and continued without redoing the work.

Those are two paired runs, not a statistical result. The benefit is directional and visible, not a guarantee for every model or task.

## Development notes

Archived planning, review, evaluation and patch records (Chinese) live in [`docs/`](https://github.com/qwased/pi-vcc-codemode/blob/master/docs/README.md). They are historical working notes, not installation or usage documentation.

## Benchmarks

The inherited compaction engine is measured against the 0.3.18 baseline in [`benchmarks/README.md`](https://github.com/qwased/pi-vcc-codemode/blob/master/benchmarks/README.md). The pi-vcc column below comes from upstream's measurements over 1,884 real sessions (summary chars vs the summarized conversation); codemode rendering adds bounded lines and does not change the cut or the section extractors.

|  | Pi default | pi-vcc-codemode |
|---|---|---|
| **Method** | LLM-generated summary | Algorithmic extraction, no LLM |
| **Determinism** | Non-deterministic, can hallucinate | Same input, same output |
| **Size reduction** | Varies | 97.6% median, 89% at p10 |
| **Compaction latency** | Waits for an LLM call | 1 ms median, 11 ms p90, 348 ms worst |
| **Cost** | Burns tokens on the summarization call | None |
| **History after compaction** | Gone, the agent only sees the summary | Searchable with `vcc_recall` |
| **Repeated compactions** | Each rewrite risks losing more | Sections merge and stay capped |
| **Structure** | Free-form prose | Up to 6 sections + a brief transcript |

![pi-vcc-codemode demo](https://raw.githubusercontent.com/qwased/pi-vcc-codemode/master/demo.gif)

## Acknowledgments

- Forked from [pi-vcc](https://github.com/sting8k/pi-vcc) by [@sting8k](https://github.com/sting8k).
- [VCC](https://github.com/lllyasviel/VCC), the original transcript-preserving conversation compiler.
- Recall `mode:"touched"` and `#N:path` drill-down ported from [pi-blackhole](https://github.com/k0valik/pi-blackhole) by [@k0valik](https://github.com/k0valik), who also suggested the feature.

## License

MIT
