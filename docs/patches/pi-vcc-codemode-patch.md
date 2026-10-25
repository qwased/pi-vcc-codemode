# pi-vcc codemode 保真度补丁（本机 0.10.2 本地修改版）

- 日期：2026-10-25
- 主机：@agegr/pi-web 0.12.2 → @earendil-works/pi-coding-agent **1.2.0**（`defaultTools: ["+codemode"]`，codemode `mode: "only"`）
- 被修改的包：`~/.pi/agent/npm/node_modules/@sting8k/pi-vcc`（**0.10.2**，与 npm latest 同版）
- 备份：`<backup-dir>/pi-vcc-backup/0.10.2-20261025T051529/pkg`（43 个文件 + `manifest.sha256`；`pi-vcc-backup/.latest` 记录路径）
状态：**已应用（v1.2）**；语法检查 4/4 通过；夹具测试 **8/8 通过**；真实会话 A/B 与成本测量见 §6（快照：`fixtures/session-snapshot.jsonl`）

> 归档说明（2026-10-26）：本文件从仓库根目录移入 `docs/patches/`；本机绝对路径和会话文件名已脱敏，结论与数字未改。正文中的 `<patch-workdir>` 指当时的本地补丁工作目录，不随仓库提供。

## 0. 一句话结论

让 `vcc_recall` 的 `range`/`expand`/搜索**能看到 codemode 脚本正文**，并让工具结果多出一行**嵌套调用记录**（工具名/参数/状态/耗时）；压缩简报也从裸 `* codemode` 变成带脚本首行的 `* codemode "code: …"`。这两类信息在官方 0.10.2 中**完全不可见**。

## 1. 为什么要改（本会话实测证据）

会话文件：`~/.pi/agent/sessions/<session-file>.jsonl`（2.18 MB，路径已脱敏）

| 事实 | 数值 |
|---|---|
| codemode 调用 / 结果 | 43 次 / 42 条 |
| codemode stdout 总量 | **394,601 字符**（单条最大 40,258） |
| Pi 写在结果上的 `nestedCalls` | **62 条**（bash 29 / fetch_content 11 / web_search 10 / get_search_content 7 / vcc_recall 5） |
| 压缩摘要里承载的工具输出 | **0 字符**，只有 `* codemode (#4, #6, …) x10` 这类指针 |
| 官方渲染形态 | `#4 [assistant] codemode(code)` —— 脚本正文不进 range/expand |
| `grep nestedCalls` | 官方 0.10.2 与 fork 0.8.15 **都是 0 命中** |

根因：`src/core/tool-args.ts` 的 `summarizeToolArgs` 只认 `path/command/query`，其余落到 `Object.keys(args).join(", ")` → 对 `{code: "…"}` 只会渲染出 `code` 这个词；而 `nestedCalls` 这个字段没有任何代码读它。

## 2. 改了什么（4 个文件，共 241 行 diff）

| 文件 | 变更 | 效果 |
|---|---|---|
| `src/core/tool-args.ts` | 新增 `CODE_KEYS`/`extractCode`/`condenseCodeTo`/`condenseCode`/`firstChars`/`summarizeValue`/`summarizeArgsFallback`/`codemodeToolNames`/`summarizeCodemodeBrief`，`summarizeToolArgs(args, full?)` | recall 侧：脚本渲染为单行 `code=<预览>`（列表 300、expand 1500；被裁剪时附 `[N lines, M chars total]`）；未知工具 fallback 从“只列 key 名”升级为 `key=value`（数组取前 3 个值 + `+N`），上限 400/1500。简报侧：`summarizeCodemodeBrief` → `-> 工具名×次数`（最多 6 个，其余 `+N more`）+ **80 字符脚本头**（`CODE_BRIEF_CHARS`） |
| `src/core/render-entries.ts` | assistant 条目把 `full` 透传给参数摘要；toolResult 条目追加一行嵌套调用，并**压成单个物理行**（多行 bash 命令不再把换行泄漏进列表）；嵌套参数摘要同样接 `full` | 结果条目出现 `nested: fetch_content(urls=…, mode=readable) 3210ms, web_search(queries=…, numResults=8) 6803ms, bash(command=grep -rn zzz /missing) error exit 1: … 12ms`；列表最多最后 12 条（每条参数 **120** 字符、整行 1500），expand 最多 32 条（每条参数 200、整行 6000）；被省略时写 `nested x40 (last 12, expand for more)`，记录不完整时写 `[record incomplete]`（见 §10 v1.1） |
| `src/core/brief.ts` | `toolOneLiner` 增加 codemode 分支（+ import），v1.2 起改用 `summarizeCodemodeBrief` | 压缩简报从 `* codemode "code: <300 字符>"`变成 `* codemode -> bash×2, write×2, read | code: const b1 = await tools.bash({ command: [ "mkdir -p /d/geminip…`（工具名带次数 + 80 字符脚本头，见 §6.4 与 §10） |
| `src/core/search-entries.ts` | `fullText` 追加嵌套调用文本 `nestedCallsSearchText`（`NESTED_TEXT_BUDGET = 2000`） | 只存在于嵌套参数里的关键词可被搜到；过滤 `vcc_recall` 自身嵌套调用，避免"搜索命中自己的查询"自增循环 |

关键代码（已生效于本机包的 `tool-args.ts`）：

```ts
export const summarizeToolArgs = (args: Record<string, unknown>, full = false): string => {
  const path = extractPath(args);
  if (path) return `path=${path}`;
  if (typeof args.command === "string") return `command=${args.command}`;
  if (typeof args.query === "string") return `query=${args.query}`;
  const code = extractCode(args);
  if (code) return `code=${condenseCode(code, full)}`;
  return summarizeArgsFallback(args, full);
};
```

## 3. 明确没有改的（残留缺口，知情的取舍）

- **不写任何会话文件**、不改 `#N` 计数、不碰压缩策略/阈值/keepTail/settings（`pi-vcc-config.json` 未动）。
- 压缩简报**仍然不输出工具结果正文**（`brief.ts` 里 `case "tool_result": break` 是上游设计）；因此**嵌套调用记录仍不进简报**，只在 recall 的 range/expand/搜索里可见。
- 搜索索引中 toolCall 参数的 **2000 字符聚合预算**未动：脚本 ≤2000 字符可被搜索全文命中，更长则只索引前 2000 字符。
- expand 里"配对结果"的 **4000 字符裁剪**（`PAIRED_RESULT_CHARS`）未动；单条 40k 字符结果仍需分页取。
- 只影响**读取/渲染**路径（recall、搜索、简报生成），因此**历史会话立即受益**：改完 `/reload` 后对同一会话即可看到差异。

## 4. 项目侧目录

```
<patch-workdir>/
├── pi-vcc-codemode-patch.md              # 本文档
├── pi-vcc-backup/
│   ├── .latest                           # 最新备份路径
│   └── 0.10.2-20261025T051529/
│       ├── pkg/                          # 官方 0.10.2 全量副本（43 文件）
│       └── manifest.sha256               # 备份时的 sha256 清单
└── pi-vcc-codemode-patch/
    ├── patch/
    │   ├── apply.mjs                     # 打补丁（幂等；对非 0.10.2 树会拒绝）
    │   ├── expected-before.json          # 4 个目标文件在 0.10.2 里的 sha256
    │   ├── files/src/core/*.ts           # 整文件替换载荷（tool-args / render-entries）
    │   ├── edits/*.find.txt|replace.txt   # 精准替换载荷（brief / search-entries）
    │   ├── diffs/*.diff, all.diff        # 备份 → 现在的 unified diff（241 行）
    │   └── manifest-before/after.sha256  # 前后全包哈希（可核对只动了 4 个文件）
    └── tools/
        ├── verify.mjs                    # 夹具测试（6 项断言）
        ├── verify-real-session.mjs       # 真实会话 A/B（官方 vs 修改版）
        ├── restore.mjs                   # 一键回滚
        ├── hash-manifest.mjs / gen-expected.mjs
```

## 5. 备份 / 回滚 / 重装

- 回滚（推荐）：`node <patch-workdir>/tools/restore.mjs`（默认从 `.latest` 恢复到已安装目录，并打印回滚的文件）
- 手动回滚：`cp -r <backup-dir>/pi-vcc-backup/0.10.2-20261025T051529/pkg/. ~/.pi/agent/npm/node_modules/@sting8k/pi-vcc/`
- 重新打补丁：`node …/patch/apply.mjs --root ~/.pi/agent/npm/node_modules/@sting8k/pi-vcc`（可重复执行；`--check` 只报告）
- 若 pi 包管理器/更新覆盖了本地改动（`pi install`、npm 更新 pi-vcc），重跑一次 `apply.mjs` 即可；它用 `expected-before.json` 里的 0.10.2 哈希做前置校验，版本不符会 `REFUSED`（确需强打用 `--force`）。

## 6. 已完成的验证

### 6.1 语法
`node --check` 对 4 个改动文件全部通过。

### 6.2 夹具测试（`node tools/verify.mjs`）→ **ALL 8 CHECKS PASSED**

| # | 断言 | 结果 |
|---|---|---|
| 1 | codemode 工具调用在 recall 条目里渲染出脚本正文 | PASS（`codemode(code=const [f, s] = await Promise.all(…`） |
| 2 | 900 字符脚本被裁剪且标注 `900 chars total`；expand 比列表长 | PASS（列表 343 / expand 916 字符） |
| 3 | 工具结果的嵌套行含 name/args/status/error/ms | PASS（含 `bash(command=…) error exit 1: no such file 12ms`） |
| 4 | 40 条嵌套调用：列表 `nested x40 (last 12, expand for more)`、expand `nested x40 (last 32)`、`[record incomplete]` | PASS |
| 5 | 压缩简报出现 `* codemode "code: …"`，且不再有裸 `* codemode` | PASS |
| 6 | 只存在于嵌套参数的关键词可被搜到；`vcc_recall` 自身嵌套调用不被索引 | PASS（命中 #12/#13；自匹配 0 命中） |
| 7 | 嵌套记录必须是**单个物理行**：多行 bash 命令被压平，列表与 expand 均无泄漏换行 | PASS（`bash(command=echo alpha echo beta) 42ms`） |
| 8 | 简报里 codemode 行 = 工具名 + 次数（最多 6 个后 `+N more`）+ ≤80 字符脚本头，且单行 | PASS（`-> read, bash, grep, find, write, edit +3 more | code: await tools.read({}); …`） |

### 6.3 真实会话 A/B（`node tools/verify-real-session.mjs`）

| 指标 | 官方 0.10.2 | 修改版 |
|---|---|---|
| 渲染条目总数 | 248 | 248 |
| codemode 调用条目 | 116 | 116 |
| …其中显示脚本正文 | **0** | **114** |
| codemode 结果条目 | 113 | 113 |
| …其中显示嵌套调用 | **0**（见下注） | **107** |
| 嵌套记录行数 / 总字符 / 均长 | 0 | 107 / 19,945 / 186 |
| 嵌套记录泄漏换行的条数 | — | **0** |

查询命中数（`searchEntries`）基本不变，说明新增文本没有污染检索：`nestedCalls` 30→32、`asiatechreview` 15→15、`月之暗面 算力 多少张` 41→41、`关连交易` 10→10、`Kratsios` 13→13、`nested` 50→50。官方包里那 3 条“显示嵌套调用”是假阳性：它的工具结果 stdout 里恰好有 `nested:` 字样。

> 数字来自冻结快照 `fixtures/session-snapshot.jsonl`（248 条渲染条目），可复现：`bash tools/checks.sh`；测正在写入的会话用 `LIVE=1 bash tools/checks.sh`。

### 6.6 真实压缩实测：最小号那次压缩（v1.2 已生效）

`node tools/measure-brief-cost.mjs --live --compaction` 直读会话文件，把 **pi-vcc 实际存下来的那份简报** 与“同一批消息在 官方 / v1.1 / v1.2 下重渲染”的结果放在一起比。最新一次压缩（`#334`，窗口 = 上一次压缩后的 103 条消息）：

| 指标 | 实际存下的简报（#334） |
| --- | --- |
| 简报大小 | **7,504 chars ≈ 1,876 tok**（覆盖 587,189 chars → 压缩比 78.3x） |
| 格式 | **v1.2**（`* codemode -> vcc_recall, bash | code: const s = await tools.vcc_recall({ expand: [91, 92] })…`） |
| codemode 记录 | 16 条 / 3,819 chars（**50.9%**），均长 239 chars |
| 非 codemode | 76 行 / 3,594 chars |

**关键发现：这 16 条里只有 8 条是 v1.2 生成的**（1,000 chars 量级），另 8 条是上一次压缩（`#230`，v1.1）**合并带过来的旧行**，仍按 300 字符预览计价：

| 存下简报里的 codemode 记录 | 条数 | 字符（含折行续行） | 均长 |
| --- | --- | --- | --- |
| v1.1 残留（旧压缩带来的） | 8 | **2,824** | 353 |
| v1.2（本次生成） | 8 | **995** | 124 |

→ 若 16 条全是 v1.2 口径，简报约 **5,670 chars（-24%）**、codemode 占比约 **29%**；这份旧行残留会在下一次压缩时被新简报顶掉，所以**下一次压缩的数字才是 v1.2 的真实稳态**。

**同一窗口重渲染对照**（同一批 103 条消息，只换代码版本）：

| 变体 | 简报 chars | codemode 记录 | codemode 占用（占比） | 均长 | 非 codemode 行 / 字符 |
| --- | --- | --- | --- | --- | --- |
| 官方 0.10.2 | 2,858 | 3 | 410（14.3%） | 137 | 77 / 2,369 |
| v1.1 | 5,053 | 8 | 2,655（52.5%） | 332 | 75 / 2,316 |
| **v1.2** | **4,551** | **16** | **2,010（44.2%）** | **126** | **79 / 2,447** |

v1.1 → v1.2 在这段窗口上：codemode 字符 **-24.3%**、非 codemode 字符 **+5.7%**，而且 codemode 记录数翻倍（8 → 16，每条 332 → 126 chars）。**同样是预算上限，v1.2 装进的信息严格更多，且简报本身更小。**

（这段窗口是“连续跑脚本”的极端情形，codemode 占比自然偏高；官方在 2,858 chars 的简报里只留了 3 条折叠行，等于这段历史不可寻回。）

## 7. 你的测试清单

> **v1.2 之后要 `/reload`**：扩展在进程启动/重载时加载，改完文件必须 `/reload`（或重启 pi）才生效。下一次压缩的简报里，codemode 行应长这样：`* codemode -> bash×2, write×2, read | code: const b1 = await tools.bash({ command: [ "mkdir -p /d/geminip… (#250)`——工具名带次数 + **≤80 字符**脚本头（不再是 300 字符整段 JS）。

1. **加载新代码**：在会话里执行 `/reload`（重载扩展/技能/模板），或重启 pi。
2. **历史会话即时验证**（渲染发生在读取时，所以对本会话也生效）：
   - `vcc_recall({ query: "nested" })` → 结果里应出现 `nested: …`
   - `vcc_recall({ expand: [<某个 codemode 调用编号>] })` → 该条应显示 `codemode(code=…)`，其后配对的工具结果里带 `nested: …`
   - `vcc_recall({ range: [a, b] })` 扫一段连续 codemode 步骤
   - `vcc_recall({ mode: "touched" })`（未改，行为应与之前一致）
2b. **单行检查**：随便取一个含多行 bash 命令的 codemode 结果（例如本会话的 `#247`），`vcc_recall({ expand: [247] })` → `nested:` 行必须是**一整行**，命令里的换行应变成空格。
3. **压缩路径**：`/pi-vcc` 手动压缩（或等阈值触发）→ 新简报里应出现 `* codemode "code: …" (#N)`，而不再是裸 `* codemode (#N)`。
3b. **对照 §6.4 / §6.6**：压缩后用 `--compaction` 直读实际简报——v1.2 的稳态目标：codemode 占用 ≈15%（v1.1 是 39.5%），记录均长 ≈125 chars（v1.1 是 334），非 codemode 字符不掉（≈5,600）。
3c. **直读实际简报**：`node tools/measure-brief-cost.mjs --live --compaction` → 打印“存下来的简报格式 / codemode 占比 / 旧格式残留”，并与同窗口重渲染对照。
4. **可能的不适**：条目行明显变长（脚本预览 300 字符/条）。嫌长就调 `CODE_PREVIEW_CHARS`（`src/core/tool-args.ts`，现 300；expand 用 `CODE_FULL_CHARS`=1500），改完 `/reload`。
5. **任何异常**：`node <patch-workdir>/tools/restore.mjs` 立即回到官方 0.10.2，然后告诉我现象；`patch/expected-before.json` 保证补丁可重复落回同一版本。

## 8. 可调旋钮（都在 `src/core/tool-args.ts` / `src/core/render-entries.ts`）

| 常量 | 现值 | 含义 |
|---|---|---|
| `CODE_PREVIEW_CHARS` | 300 | 列表/简报里的脚本单行预览长度 |
| `CODE_FULL_CHARS` | 1500 | expand 里的脚本预览长度 |
| `ARGS_PREVIEW_CHARS` / `ARGS_FULL_CHARS` | 400 / 1500 | 未知工具 `key=value` 摘要的总上限 |
| `NESTED_LINE_CHARS` / `_FULL` | 1500 / 6000 | 嵌套调用一行的总上限 |
| `NESTED_SHOWN` / `_FULL` | 12 / 32 | 列表/expand 各显示最后多少条嵌套调用 |
| `NESTED_ARG_CHARS` / `_FULL` | 120 / 200 | 每条嵌套调用的参数预览长度（列表 / expand） |
| `NESTED_TEXT_BUDGET`（search-entries.ts） | 2000 | 嵌套文本进搜索索引的预算 |
| `CODE_BRIEF_CHARS`（tool-args.ts） | 80 | 简报里 codemode 脚本头的长度（≤80，不附 size note） |
| `CODE_BRIEF_TOOL_NAMES`（tool-args.ts） | 6 | 简报里列出的工具名个数上限，其余 `+N more` |

### 6.4 成本测量：“精简”一侧的代价，以及 v1.2 之后的变化

`node tools/measure-brief-cost.mjs` 对同一份冻结快照渲染三个变体：官方 0.10.2 / **v1.1**（300 字符脚本预览）/ **v1.2**（工具名 + 80 字符头）。

**A. 全量未排序渲染（无预算约束，看纯文本量）**

| 视图 | 官方 0.10.2 | v1.1 | v1.2 | v1.1 → v1.2 |
| --- | --- | --- | --- | --- |
| 简报 chars | 6,850 | 23,478 | **11,840** | **-49.6%** |
| 简报行数 | 147 | 193 | 188 | -5 |
| `* codemode` 行数 | 9 | 51 | 46 | -5 |
| 其中字符数 | 767 | 17,190 | **5,557** | **-67.7%** |
| recall 列表视图（248 条） | 26,896 | 83,349 | 83,349 | 不变（列表仍用 300 字符预览） |

**B. 排序简报（= 压缩时真正存下来的那份，受预算约束）**

预算是 `clamp(60 × block 数, 4,400, 8,000)` chars（对应 floor 1,100 tok / ceiling 2,000 tok、15 tok/block）。注意长行会被 `wrapLongLines` 折行，所以下表把折行算回所属记录：

> 口径：`wrapLongLines` 会硬折行并把续行缩进 2 空格，因此**一条逻辑记录 = 一个非缩进行 + 其全部缩进续行**（只数 `* ` 开头会把后面的正文误记到记录头上，v1.2.1 已改正）。

| 指标 | 官方 0.10.2 | v1.1 | v1.2 |
| --- | --- | --- | --- |
| 简报 chars | 6,444 | 6,767 | 6,742 |
| codemode 记录数 | 2 | 8 | 8 |
| codemode 占用（占简报） | 394（6.1%） | **2,673（39.5%）** | **996（14.8%）** |
| codemode 记录均长 | 197 | 334 | **125** |
| 非 codemode 字符 | 5,897 | **3,981** | **5,593** |
| 非 codemode 相对官方 | — | **-32.5%** | -5.2% |

结论：**v1.1 的 300 字符预览在真实预算下吃掉 39.5% 的上下文**（把非 codemode 证据压掉三分之一：5,897 → 3,981 chars）；v1.2 把它降到 **14.8%**，非 codemode 回到 **5,593 chars**（只比官方少 5.2%），同时把这 8 条 codemode 记录从 334 chars/条 压到 **125 chars/条（-62.7%）**。官方那 6.1% 是“折叠 x19 个 ref”的假便宜——它等于把 19 轮 codemode 压成 2 行，什么内容都不剩。

残留代价：recall **列表视图**（一次扫全部条目）仍是官方的 **3.1 倍**（26.9k → 83.3k chars）；用 `query` / `range` 精确定位时不付这个钱，也可以下调 `CODE_PREVIEW_CHARS`（见 §8）。

### 6.5 一键复现（冻结快照）

为了让数字可复现，本会话在某时刻被冻结为 `fixtures/session-snapshot.jsonl`（2.6 MB，251 条消息，含 3 次压缩）：

- `bash tools/checks.sh` —— 跑全部检查（语法 / 补丁状态 / 夹具 7 项 / A-B / 成本 / 只动 4 文件），默认用冻结快照；
- `LIVE=1 bash tools/checks.sh` —— 改测正在写入的真实会话；
- `node tools/inspect-session.mjs` —— 看每次压缩的简报构成（字符、行、codemode 占比、压缩比）。

## 9. 结论与下一步

**“可寻回”一侧：达标。** 脚本正文与嵌套调用都在 `range` / `expand` / 搜索里可见、可按 `#N` 复现、可被关键词搜到，真实压缩路径已确认生效。

**“精简”一侧：v1.2 之后达标。** 简报里 codemode 的占用从 39.5%（v1.1）降到 **14.8%**（v1.2），记录均长从 334 chars 降到 **125 chars**，非 codemode 字符几乎不掉（5,593 vs 官方 5,897）；简报现在写的是“这一步跑了哪些工具（带次数）+ ≤80 字符脚本首部”，而不是整段 JS。

**残留（知情取舍）**

- 简报里仍**没有**嵌套调用的 name/status/耗时行（`brief.ts` 的 `case "tool_result": break` 是上游设计）。要拿逐条工具与耗时，仍需一次 `vcc_recall`（代价 = 一次 `range` / `expand`）。
- recall 列表视图仍是 3.1 倍；`CODE_PREVIEW_CHARS`（300）与 `NESTED_ARG_CHARS`（120）是可调旋钮。

**下一步可选（按需，不必现在做）**

| 候选 | 说明 |
| --- | --- |
| B. 简报写结果侧 nested 行 | 从工具结果里的 `nestedCalls` 取工具名 + 耗时（比脚本正则更准、含间接调用），代价是 ~30 行 + 简报再多 ~100 chars/轮 |
| 设置开关 `briefCodemode: full / short / none` | 让简报的 codemode 形态可切换，长期最灵活（需动 `settings.ts`） |
| D. 相邻 codemode 记录按“工具名签名”折叠 | **实测后放弃**，见下 |

**D 是什么、为什么放弃（`node tools/fold-preview.mjs`，样本 = `fixtures/stored-334.txt` 的真实简报）**

- 现状：pi-vcc 只会折叠**字面完全相同**的行（`(#4, #6, …) x19`——官方把 19 轮压成 2 行就是这么来的）。v1.2 每行脚本头都不同，所以折叠失效，16 行全留下。
- D 的想法：把“工具名清单 + 头前 40 字符”当作身份，让**相邻**同类记录也折叠：`* codemode -> bash, read | code: const b1 = await tools.bash({ command: [ "mkdir -p /d/geminiproject (#250, #254, #260) x3`（refs 全保留，仍可 `range`/`expand`；代价是 N-1 个脚本头被丢掉，只剩一个代表头）。
- 实测：这份简报 16 条记录里，**相邻记录的签名没有一对相同**（16 条 → 16 个 run），**收益 0**——每轮跑的脚本/工具组合本来就不同，“相邻相似调用”在真实工具重会话里不成立。

**真正能省的是单行长度**（同一份真实简报里的 8 条 v1.2 记录）：

| 脚本头上限（`CODE_BRIEF_CHARS`） | codemode 字符 | 折行后物理行数 |
| --- | --- | --- |
| 80（当前） | 969 | 16（80 字符头几乎每条都折成 2 行） |
| **48** | **713（-26%）** | **8**（一条一行） |
| 32 | 585 | 8 |
| 0（只有工具名 + ref） | 329 | 8 |

→ 还想更精简的话，**改 `CODE_BRIEF_CHARS` 80 → 48** 就够（纯旋钮，不动结构，收益远大于 D）。极端版“把一段里连续的 codemode 记录并成一行”（工具名并集 + 全部 refs，实测 8 条 → 176 chars）只剩一个脚本头，等于放弃自动线索，只适合将来的 `briefCodemode: none` 极简模式。

已观察：真实压缩 `#334` 确认 v1.2 已生效（§6.6），旧格式残留 8 条会在下一次压缩自然消失。**B 暂不建议做**（会再次推高精简侧成本），**D 已放弃**；若还想动，只建议先把 `CODE_BRIEF_CHARS` 调到 48 试试。

## 10. 变更记录

| 时间 | 版本 | 内容 |
| --- | --- | --- |
| 2026-10-25 05:20 | v1 | 4 文件补丁：脚本正文进 recall 与简报；嵌套调用进 recall；嵌套文本进搜索。夹具 6 项。 |
| 2026-10-25 05:3x | v1.1 | 修 render-entries.ts：嵌套记录压成单物理行、参数上限列表 200→120；夹具加第 7 项；新增 checks.sh / inspect-session.mjs / measure-brief-cost.mjs / 冻结快照。 |
| 2026-10-25 05:5x | v1.2（选项 C） | `brief.ts` 改用 `summarizeCodemodeBrief`：简报写 `-> 工具名×次数 + 80 字符脚本头`；`tool-args.ts` 新增 `condenseCodeTo` / `codemodeToolNames` / `summarizeCodemodeBrief` / `CODE_BRIEF_CHARS`；夹具加到 8 项；measure 脚本支持 v1.1/v1.2 对照与排序简报对照 |
| 2026-10-25 06:0x | v1.2.1（度量口径修正） | `measure-brief-cost.mjs`：记录长度改按**缩进续行归属**统计（旧口径只数 `* ` 开头行，会把折行/正文误算到 codemode 头上）；新增 `--compaction` 审核模式（直读会话文件，实际简报 vs 同窗口重渲染，并区分 v1.1/v1.2 格式残留）；新增 `fixtures/stored-334.txt`（真实存下的简报样本）；§6.4 表格与 §6.6 按新口径重写 |
| 2026-10-25 06:1x | v1.2.2（选项 D 评估） | 新增 `tools/fold-preview.mjs`（在真实简报上评估“按签名折叠”与各种脚本头长度）；结论：**D 收益 0 → 放弃**，改为推荐 `CODE_BRIEF_CHARS` 80 → 48（-26% 字符、每条一行）；§9 已按实测重写 |
| 2026-10-25 06:2x | v1.2.3（丢失度审计 + 设计提案） | 新增 `tools/loss-audit.mjs`（按信息类别测简报保留率：目标/工作集/错误签名/结果/refs）与 `fixtures/loss-audit-334.txt`；新增 **§11 长程任务设计提案**（L1-L8 泄漏点 + P0-P3 提案 + 验收指标） |
| 2026-10-25 06:3x | v1.2.4（跨模式对照） | 新增 `tools/list-sessions.mjs`（枚举所有会话的压缩次数/codemode 使用量）；在 3 个**非 codemode** 会话上复跑 loss-audit → 证明这些丢失与 codemode 无关；新增 §11.6（跨会话对照表）与 §11.7（codemode 特有差异：`[Commits]`/`[Tracked Commands]` 在 codemode 下失效；pi 的 fileOps 反而支持 nestedCalls） |
| 2026-10-25 06:4x | v1.2.5（结果摘要风险复核） | 新增 `tools/result-truth-audit.mjs`：实测“结果摘要会误导”的风险（本会话 31/182 = 17% 首行假成功；harness `isError` 只覆盖 8 个）；核对上游意图（`brief.ts:318` 注释、`tests/brief.test.ts`、README 的确定性承诺）；**§11.3 L1 改判为“上游有意为之且理由充分”**，P1 改为“消除沉默（契约行 + 失败计数 + `errors:true`）而非塞摘要”，新增 §11.8 与“禁止推断性摘要”护栏 |

## 11. 长程任务（codemode 反复压缩）设计提案 —— 第一性原理

### 11.1 两个产物、两种角色

| 产物 | 性质 | 特点 |
| --- | --- | --- |
| 会话 JSONL（archive） | **追加写、完整、地址稳定**（`#N` = 条目序号） | 已可被 `vcc_recall` 读取：`query` / `range` / `expand` / `mode:'touched'` / `#N:path`。**它是事实来源，压缩不会破坏它** |
| 压缩简报（brief） | **有损索引**，预算 ≈1.8k tok / 120 行 | 只决定“模型此刻看得见什么、知道该往哪查” |

→ 因此长程任务的目标不是“简报里留更多正文”（预算锁死），而是保证三件事：**(a) 目标与未完成事项永不丢失；(b) 被丢掉的区间“存在且可寻址”这件事不被忘记；(c) 找回它所需的检索键（路径/错误串/命令/标识符）留在简报里。**

### 11.2 实测丢失（`node tools/loss-audit.mjs`，本会话 #334 存下的简报；原始输出见 `fixtures/loss-audit-334.txt`）

| 信息类别 | 归档中 | 简报中保留 | 保留率 |
| --- | --- | --- | --- |
| 用户目标（任务定义） | 12 | 6 | **50.0%** |
| 触及文件（工作集） | 30 | 15 | **50.0%** |
| 错误/结果签名 | 31 | 0 | **0.0%** |
| 工具结果（全部） | 138 | 0 | **0.0%** |
| 其中疑似失败的结果 | 24 | 0 | **0.0%** |
| 消息 | 303 | 23 个被引 ref | 7.6% |

丢失的 6 条目标全部是**较新的**用户消息（“选项C…”“相邻 codemode 记录…”等）；丢失的工作集里包含引用次数很高的文件（如 `verify-real-session.mjs`，13 次）。

### 11.3 机制层面的 8 个泄漏点（都在上游代码里，已定位）

| # | 泄漏 | 代码事实 |
| --- | --- | --- |
| L1 | **结果通道为空**（上游**有意为之**，且理由充分：算法生成的“结果摘要”会给 LLM **错误结论**，见 §11.8） | `brief.ts:318` 注释：`Tool result bodies are intentionally omitted from compact briefs.`；README 的价值观是“确定性、不产生幻觉” |
| L2 | **工作集按“最早”淘汰**：`Files And Changes` 每类保留 10 条且 `keep:"head"` + `touchOnDup=false` → 保留最早见到的路径，正在改的文件可能被挤掉 | `summarize.ts` `capItems(..., 10, ",", "head")` |
| L3 | **目标会被后来者挤出**：Session Goal 合并 = 去重 + 保留**尾部**、上限 8 行；且 `extractGoals` 只取首条用户消息 ≤6 行 + `[Scope change]` | `summarize.ts`（CAP=8, `slice(-CAP)`）、`extract/goals.ts` |
| L4 | **转录按“前缀”淘汰**：总 120 行，保留尾部 → 最早（最初框架、第一次排查、第一个决定）先丢；且省略标记 `...(N earlier lines omitted)` **不带 ref** | `format.ts` `BRIEF_MAX_LINES=120` + `capBriefToLineBudget`（`slice(-maxLines)`） |
| L5 | **没有覆盖图**：简报不说“我引了哪些区间、归档还有多大、哪里是空洞” | 无 |
| L6 | **未完成事项易失**：`Outstanding Context` 每次只用“新生成的”，旧的开环任务不合并 | `summarize.ts` `if (header === "Outstanding Context") return fresh;` |
| L7 | **合并无校验**：上一份简报的条目是否还在，没有任何断言（LLM 散文还可能漂移） | 无 |
| L8 | **无法按“期”重取**：archive 完整，但没有“第 k 期（两次压缩之间）的完整视图”入口，只能靠 `range` 猜区间 | 无（`map`/`episode` 缺失） |

### 11.4 提案（按 收益/成本 排序）

| 优先级 | 提案 | 对应泄漏 | 改动点与成本 | 预期效果 |
| --- | --- | --- | --- | --- |
| **P0** | 工作集改为“最近使用优先”：`keep:"tail"` + `touchOnDup:true`，上限 10 → 16 | L2 | `summarize.ts` 2-3 行 | 活跃文件不再被最早文件挤掉 |
| **P0** | 省略标记带区间与入口：`...(N lines omitted: #168-#247 — vcc_recall query/range)` | L4/L5 | `format.ts`/`summarize.ts` ~10 行 | 把“未知的未知”变成“已知的空洞” |
| **P1** | `[Task]` 钉住**首条用户消息原文**（~400 字符）+ 用户消息首行做**单调台账**（去重、LRU、上限 16） | L3 | `brief.ts`/`summarize.ts`/`build-sections.ts` ~30 行 | 目标保留率 50% → ~100% |
| **P1** | **消除“沉默”而不是塞摘要**：(a) 简报加一行契约：`[Results] 不在简报里 → expand:[#N] · vcc_recall({errors:true})`；(b) 覆盖行给出**失败计数**（纯数字，如 `24 failed results`）；(c) 新增 `vcc_recall({errors:true})`（从归档取**原文**错误行 + ref）。**不做**任何“成功/失败/已修复”的推断性摘要 | L1 | ~60 行 | 结果仍不在简报，但“有没有失败、去哪取”不再靠猜；**零误导风险**（详见 §11.8） |
| **P1** | `vcc_pin` 工具 + `/pi-vcc pin`：模型/用户可钉事实、决定、开环任务；**单调、永不淘汰**，简报顶部展示 | L3/L6 | 新工具 + `settings.ts` + 简报一节 ~120 行 | “工作记录与目标不丢”从概率变保证 |
| **P2** | `vcc_recall({ map: true })`：期表（压缩 #、ref 区间、主题词、触及文件、失败数）；`{ errors:true }`、`{ users:true }` | L5/L8 | `recall-run.ts`/`format-recall.ts` ~100 行 | 20 次压缩深的历史也能“翻目录” |
| **P2** | `vcc_recall({ episode: k, depth: 1\|2 })`：按“期”重取完整保真视图（含结果与失败） | L8 | 同上 ~80 行 | **归档完整 ⇒ 简报可以放心丢**：需要时重渲染即可 |
| **P3** | 合并守卫：新简报必须仍包含上一份的所有台账行（字节级），否则回注；同时把 `loss-audit` 阈值接进 `checks.sh` | L7 | `summarize.ts` ~25 行 + 阈值断言 | 漂移/静默丢失变成**可测的回归** |
| **P3** | 预算腾挪：`CODE_BRIEF_CHARS` 80 → 48（实测 -26%）、折叠同轮 codemode 行、纯探索读取不计入 | 预算 | 常量/小改 | 给台账腾出 ~300-500 chars |

### 11.5 验收指标（可复跑，避免“感觉更好”）

| 指标 | 现在 | 目标 |
| --- | --- | --- |
| 目标保留率 | 50% | **≥95%** |
| 活跃工作集保留率（近 N 轮触及的文件） | 50% | **≥90%** |
| 错误签名保留率 | 0% | **≥60%** |
| 覆盖标记（含 ref 区间的省略说明） | 无 | **总是存在** |
| 简报引用的 ref 可解析率 | 100%（已达标） | 100% |
| 简报大小 | 7,504 chars（含旧格式残留） | ≤8,000（上限内） |

复跑命令：`node tools/loss-audit.mjs`（丢失）、`node tools/measure-brief-cost.mjs --live --compaction`（成本）。

### 11.6 「不用 codemode 是不是就没这些问题？」——跨会话实测对照

**不是。** 三条证据：

1. **上游 0.10.2 全仓零 codemode 引用**（`grep -rn codemode` 在 `src/`、`tests/`、`README.md`、`CHANGELOG.md` 全部为 0）→ 它是一个通用压缩器，§11.3 的 L1-L8 全是通用策略，与工具形态无关。
2. **实测对照**（`node tools/loss-audit.mjs --session <任意会话>`，取每个会话存下的最后一份简报）：

| 会话 | 模式 | 消息 | 压缩次数 | 目标保留 | 工作集保留 | 错误签名 | 工具结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--D--ninfer--` 2026-09-22 | 非 codemode | 2,633 | **10** | **38.5%** | **18.6%** | 0% | 0%（1,327 个，其中 118 疑似失败） |
| `--D--dsh-wsl-project--` 2026-09-16 | 非 codemode | 223 | 1 | 100% | 55.0% | 0% | 0%（112 个） |
| `--D--geminiproject--` 2026-10-19 | 非 codemode | 217 | 4 | 100% | 66.7% | 0% | 0%（108 个，其中 21 失败） |
| `--D--geminiproject--` 2026-10-24（本会话） | **codemode** | 303 | 4 | 50.0% | 50.0% | 0% | 0%（138 个，其中 24 失败） |

→ **错误/结果保留率 0% 与模式无关**（上游 `brief.ts`: `case "tool_result": break`）；**目标/工作集保留率随压缩次数与时长衰减**，也是两种模式共性——10 次压缩的纯非 codemode 会话（38.5% / 18.6%）反而比本 codemode 会话（50% / 50%）更差。
3. **机制**：L2（工作集按最早淘汰）、L3（目标尾部截断）、L4（转录前缀淘汰）、L5（无覆盖图）、L6（开环只取新）、L7（无合并校验）全部写在通用 summarizer 里（`summarize.ts` / `format.ts` / `extract/*.ts`），与是否 codemode 无关。

### 11.7 codemode 特有的三点差异（有好有坏）

| 方向 | 事实 | 代码/证据 |
| --- | --- | --- |
| ✅ 更好 | 每轮只产生 1 条 `* codemode` 行 → 120 行预算覆盖的**轮数更多**；非 codemode 一轮可能吃掉 5-10 行 | `format.ts` `BRIEF_MAX_LINES=120` |
| ✅ 更好（本补丁） | 脚本头把路径/命令字面量带进简报，成了**检索键** → 本会话工作集保留 50%，高于 10 次压缩的纯非 codemode 会话（18.6%） | 见 §2/§6.6 |
| ❌ 更差（上游） | 未打补丁时简报只有裸 `* codemode`，零信息；非 codemode 至少还有 `* read "path"` | 已由本补丁修复 |
| ❌ 更差（上游，**新发现，未修**） | **`[Commits]` 与 `[Tracked Commands]` 在 codemode 下永远是空的**：`extract/commits.ts:51` 要求 `b.kind === "tool_call" && b.name === "bash"`；`extract/tracked-commands.ts:134` 注释同样是 “Scans bash tool-call commands”。codemode 里 bash 调用只在 `toolResult.nestedCalls` 里，两个提取器都不看那里 | 修复 = 让提取器也扫 `nestedCalls`（成本很小） |
| ℹ️ 反例（pi 侧其实支持） | **pi 自己的 fileOps 会看 codemode 的 nestedCalls**：`pi-coding-agent/dist/bundle/chunks/chunk-TJXZSVTD.js` 里 `extractFileOpsFromMessage()` 对 `role === "toolResult"` 遍历 `message.nestedCalls.calls` 逐个 `addFileOp(...)`（只认 `read`/`write`/`edit` + `args.path`）→ 所以 `[Files And Changes]` 在 codemode 下能工作 | 说明“嵌套调用”是载荷承重结构 |

**结论**：§11.4 的 P0/P1 提案应做在**共享 summarizer 层**（两种模式都受益）；另加一条极小的 **codemode 适配器**（P1.5）：`extract/commits.ts` 与 `extract/tracked-commands.ts` 除 `tool_call`(bash) 外，也从 `toolResult.nestedCalls` 里的 `bash.arguments.command` 取命令。另外 L1（结果通道）在非 codemode 下**更痛**（1,327 个结果 / 118 失败 vs 138 / 24），故 P1 的“结果一行摘要”优先级应上调。

### 11.8 「结果一行摘要会不会误导 LLM？」——会，实测 17% 是**危险的假成功**

`node tools/result-truth-audit.mjs --session <jsonl>`（新增工具）在真实会话上量化了这个风险：

| 指标 | 本会话（codemode，182 个结果） | `--D--ninfer--`（非 codemode，1,469 个结果） |
| --- | --- | --- |
| 带 `isError:true`（harness 权威标记） | 8 | 55 |
| `isError` 未标记、但正文含失败信号 | **31** | 103 |
| 其中**首行读起来像成功**（codemode 的 `Script completed`） | **31（即 17% 的结果）** | 0（但首行是 `total 56` / `=== ninfer` 之类，同样无信息） |

实例（都是 `isError` 未标记、首行 `Script completed`）：

```
first line: Script completed
real error: cat: node_modules/@earendil-works/pi-coding-agent/package.json: No such file or directory
real error: /usr/bin/bash: line 20: /tmp/vccm/src_core_load-messages.ts: No such file or directory
```

**结论：任何“首行/推断式”的结果摘要都会在 17% 的情况下给出“成功了”的错误结论**——正是用户担心的那种误导，而且是危险方向（假成功）。

**上游的意图**（核对官方 0.10.2 源码与文档）：

- `brief.ts:318` 注释：`Tool result bodies are intentionally omitted from compact briefs.`（只有“有意省略”，没写理由）；
- `tests/brief.test.ts` 里工具结果的正文恰恰是**最有信息**的那类（`FAIL auth.test.ts / expected 200 got 401`、`All tests passed`），测试断言它们**被隐藏**；
- README 的价值观：`No LLM calls` / `Determinism: Same input, same output` / `Can hallucinate 属于 LLM 那一列` / `History after compaction: Searchable with vcc_recall`。

→ 上游的正式理由是**确定性与“不产生幻觉”**，效果上也是“逼你去 recall 取全文”。用户的两点担心（会误导、会让人不去读全文）**都成立**，且与上游价值观一致。

**修正后的 L1 策略**（分三层，默认只做 T0+T1；T2 需显式开启）

| 层 | 内容 | 规则 | 为什么安全 |
| --- | --- | --- | --- |
| **T0（默认）** | 简报里一行**契约**：`[Results] 工具结果不在本简报 → expand:[#N] · vcc_recall({errors:true})` | 只说明“省略存在 + 去哪取”，不含任何结果内容 | 消除“沉默的省略”（未知的未知），零主张 |
| **T1（默认）** | 覆盖行给**失败计数**：`… 24 failed results (vcc_recall errors:true)` | 纯数字 + 入口 | 数字是计数事实，不是内容判断 |
| **T2（可选）** | `[Search keys]` 一节：**逐字片段** ≤40 字符 + `…` + ref，例如 `"No such file or directory" ×4 (#312, #318)` | 只允许**原文子串**、必须带省略号与 ref、**禁止**任何状态词（ok/passed/fixed/成功）；只作“索引词”用途 | 逐字片段不可能“说错”，只能“说不全”，且不完整已被 `…` 标注 |
| **禁止** | 首行摘要 / “测试通过” / “已修复” 之类**推断** | — | 实测 17% 假成功（见上表） |

**配套（把“省略”变安全的关键）**：

1. `vcc_recall({ errors: true })`：从归档里列出失败结果（tool 名 + 耗时 + **原文错误行** + ref），分页；
2. `vcc_recall({ map: true })`：期表（压缩 #、ref 区间、失败计数、触及文件）；
3. `vcc_recall({ episode: k })`：按期重渲染完整保真视图（含结果原文与失败）。

→ 一旦“取全文”是一句话就能做到的事，**简报丢掉结果正文就不再有害**：省略是已知的、可取回的；而简报里任何“结论”都是不可取回的（模型不会去核对）。

**回归护栏**：任何未来的“结果摘要”特性都必须先过 `tools/result-truth-audit.mjs`——若它引入任何“正文有错而摘要像成功”的样本（当前基线 31/182），即视为不合格。
