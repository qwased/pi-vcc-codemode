# pi-vcc-codemode 0.1.1 真实工作测试与行为核对报告

- 日期：2026-10-25
- 被测对象：pi-vcc-codemode 0.1.1（已安装于 ~/.pi/agent/npm/node_modules/pi-vcc-codemode；与仓库 HEAD `ae24f6b` 逐字节一致；也是 npm latest）
- 对照对象：上游 `@sting8k/pi-vcc` v0.10.2（源码解包到 `../.pi-eval/upstream`）
- 运行宿主：`@agegr/pi-web` 0.12.2 内嵌 `@earendil-works/pi-coding-agent` 1.2.0；本会话只暴露 `codemode` 一个顶层工具
- 仓库测试宿主：1.4.0（仓库 node_modules 内）→ `bun test` 485 pass / 0 fail，`bun run typecheck` 通过
- 本报告对应的真实会话文件：`~/.pi/agent/sessions/<session-file>.jsonl`（路径已脱敏）
- 临时脚本与上游源码在仓库外：`../.pi-eval/`（评估工作目录不是 git 仓库，被测仓库 `git status` 干净，未改动任何被测代码）

> 归档说明（2026-10-26）：本文件从仓库根目录移入 `docs/reviews/`；本机绝对路径和会话文件名已脱敏，结论与数字未改。文中引用的 `CODEMODE_LONG_HORIZON_PLAN.md` 现位于 `docs/plans/`。

---

## 0. 结论摘要

1. **压缩后的行为与压缩前的预测基本一致**（6 项一致，无一项被推翻），但有 4 处预测之外的细节，其中 2 处是我压缩前没发现的真问题。
2. 本轮新发现（真问题）：
   - `vcc_recall({ mode: touched })` 在 codemode-only 会话里**返回空**（第 4.4 节）。
   - 简报每个 assistant 轮**最多 8 条工具行**，本会话被摘要区间有 17 轮 codemode，**9 条意图被丢弃**（第 4.2 节）。
3. 本轮新发现（口径/观感）：规则注入在提示里出现 `- - ` 双横线（第 4.5 节）；合成 harness 的 `firstKeptEntryId` 为空、真实压缩里非空（第 4.6 节）。
4. 上一轮的结论仍然成立：485 pass、两层门控在 69 个真实会话上零差异、成本说法被小样本过度概括、P3 的脚本尾部与 nested 分页仍是用户体感最强的缺口。
5. 修复优先级建议：先改文档口径（README 275 行、计划 §5/§6.3），再做 touched 的 nested 支持，然后才是 store 投影。

---

## 1. 核对：压缩后行为是否与压缩前的预测一致

真实压缩产物 = 会话文件第 63 行（`type: compaction`）：`tokensBefore` 72002、`fromHook: true`、`details.compactor: pi-vcc`、`sourceMessageCount: 36`、`previousSummaryUsed: false`、`reason: manual`、`firstKeptEntryId` = `d94d3f39`（= 第 40 行，一条 assistant 消息）。摘要 1376 字符，`systemMessage.sections.rules` 里带插件注入的两条 codemode 规则。

| 压缩前的预测 | 实测 | 判定 |
| --- | --- | --- |
| 每条 codemode 摘要变成 `* codemode -> <工具名> \| goal: <意图>` | 8 行全都长这样（`-> bash`、`-> write, bash`、`-> read`） | 一致 |
| 意图用用户语言 | 8 条全是中文，与我写的 `// goal:` 逐字一致 | 一致 |
| 工具名是静态声明（扫源码，含注释里的文本） | 一致；但简报行本身仍无 declared 标注 | 一致（风险仍在） |
| 每行带会话全局 `#N` 引用 | `#20 #22 #24 #26 #28 #30 #32 #34`，且被丢弃的 9 条不占行 | 一致 |
| 被丢弃的内容可用 recall 取回 | `range:[2,19]` 返回全部被丢弃轮次；`query "ranked 简报预算"` 命中 #26/#27/#38 | 一致 |
| 文件事实覆盖嵌套 `tools.write` | `[Files And Changes]` 的 4 个 Modified 精确等于被摘要区间内的 4 次嵌套 write | 一致 |
| 保留尾部 = `firstKeptEntryId` 之后 | 第 40 行起 22 条原样保留 | 一致，且真实运行里该字段非空 |

压缩后的摘要（我实际拿到的上下文）结构：

```
[Session Goal]        ← 用户原话
[Files And Changes]   ← 4 Modified + 4 Read（只来自被摘要区间）
---
[user]                ← 用户消息逐字
[assistant]
* (9 earlier tool-call entries omitted)
* codemode -> bash | goal: 抽取上游 v0.10.2 源码到临时目录，准备真实数据的 A/B 对照 (#20)
  ... 共 8 条意图行 ...

Use vcc_recall to search for prior work ... Do not redo work already completed.
```

---

## 2. 本轮新发现（真实压缩暴露出来的）

### 2.1 真实压缩的真实值

- 压缩前上下文 72002 token，被摘要的源消息 36 条，摘要 1376 字符（约 344 token）。
- 被摘要区间 = 第 0 行到第 39 行；第 40 行到第 62 行（22 条）作为原始尾部保留。
- `previousSummaryUsed: false`：本会话是第一次压缩，不是二次合并。

### 2.2 简报的 8 行/turn 上限与被丢弃的意图

- 实现：`src/core/brief.ts:355-378`，`TOOL_CALLS_PER_TURN = 8`，按 `[assistant]` 段**保留最后 8 条工具行**，在第一条保留行前插入 `* (N earlier tool-call entries omitted)`。
- 合并先于截断：`src/core/brief.ts:330-352` 把连续相同 base 行折叠成 `(#12, #14) x2`。所以相同意图的重复脚本不会线性膨胀（合成数据 n=60 相同意图：fork 581 vs 上游 533 字符）。
- 后果：本次 17 轮 codemode 只留了最后 8 条，**9 条意图在简报里消失**。简报是压缩后模型唯一能看到的东西，这正是插件声称要解决的问题类型；只有走 recall 才能取回（refs 不在简报里，只能靠 query/range 找到）。
- 计数语义：`omitted` 计的是折叠后的行数，且只出现一次。

### 2.3 文件事实来自宿主 fileOps（含嵌套），不是插件自己抽的

- 宿主 `@earendil-works/pi-coding-agent` 的 `extractFileOpsFromMessage` 对 `toolResult.nestedCalls.calls` 逐个 `addFileOp(name, args)`（只认 `read` / `write` / `edit` + `args.path`）；插件在 `src/hooks/before-compact.ts:755-757` 把 `preparation.fileOps` 直接转给 `extractFiles`。
- 直接证据：本会话被摘要区间内只有 4 次嵌套 write（行 23/29/31/33：`live-session-dump.ts`、`ab.ts`、`ab2.ts`、`intent-matrix.ts`），摘要里的 Modified 正好是这 4 个；Read 是 `readOnly = read - modified` 过滤后的 4 个。
- 反证：把同一批消息喂给 `extractFiles(normalize(msgs))`（**不传 fileOps**）= 三个集合全空。理由：codemode 的 toolCall 参数只有 `{ code }`，没有 path，纯静态抽取在 codemode 会话里抽不到文件。
- 上限：`src/core/build-sections.ts:52-60` 每类最多 10 条，超出显示 `(+N more)`。

### 2.4 真问题：`vcc_recall({ mode: touched })` 在 codemode-only 会话返回空

- 实测输出：`No file operations found in session history.`（同一会话里摘要的文件视图却列出了 4 个 Modified 文件）
- 原因：`getFileIndicators`（`src/core/search-entries.ts:330-355`）只遍历 `msg.content` 里的**顶层** toolCall；不看 `nestedCalls`。而搜索索引 `fullText`（同文件 319 行）对 codemode 消息**是**看 nested 的（`isCodemodeMessage` 门控）。
- 影响：`mode:only` 的 agent 所有文件操作都在嵌套里，touched 等于永久为空；而 `vcc_recall` 的工具描述只提到 `apply_patch` 和 bash 重定向的盲区，没提这个更大的盲区。
- 判定：这是压缩前没发现的缺口，且与 codemode 场景直接相关，我建议优先级高于 P2 的 store 投影。

### 2.5 观感 bug：注入规则出现 `- - ` 双横线

- 磁盘证据（第 63 行 `systemMessage.sections.rules`）：`- - Use vcc_recall to recover ...`、`- - Start each codemode script ...`
- 来源：`src/codemode/guideline.ts:8` 等常量字符串自带 `- ` 前缀，宿主渲染 guidelines 时再加一个 `- `。
- 压缩前的持久化 system 消息（第 4 行）里没有这两条，说明它们只在插件注入/重建提示时出现。
- 无害，但模型每一轮都能看到，修起来是几行字。

### 2.6 合成 harness 与真实路径的差异（口径提醒）

- 合成 `rpc-compact` 路径跑出的 `firstKeptEntryId` 是空字符串；真实手动压缩是 `d94d3f39`。
- 上一轮我据此对计划 §3.1 提出的疑点现在有了答案：真实路径非空，所以窗口/保留尾部类指标必须走真实压缩路径测，合成夹具单独用会失真。
- 同理，`details.sourceMessageCount`、`previousSummaryUsed` 这类字段在两条路径下未必同形，报告与测试都要标注来源。

---

## 3. 上一轮（压缩前）的全部实测结论

### 3.1 工程与一致性

| 项目 | 结果 |
| --- | --- |
| `bun run typecheck` / `bun test`（宿主 1.4.0） | 通过 / **485 pass, 0 fail**，与计划声明一致 |
| 已安装包 vs 仓库源码 | `diff -rq` 无差异；`index.ts` 相同 |
| npm 状态 | `npm view pi-vcc-codemode version` = 0.1.1 = latest |
| 两层门控（真实数据） | 69 个无 codemode 记录的真实会话：逐条 render（list + full）+ brief + ranked brief 与上游 v0.10.2 **0 差异**；407 条记录的 codemode 重会话里**非 codemode 条目 0 改动** |
| guideline 真实生效 | 系统提示里两条规则都在；本会话 13/13 个脚本首行写了 `// goal:` |
| 意图解析矩阵 | 11 例符合 §4.1 规范：英文标记、大小写/空格容错、仅首行或 `@options` 第二行、空值/旧中文标记返回 null |
| 端到端真实压缩（3 步任务，真实模型 + 强制压缩） | fork 摘要 1101 字符（逐步骤意图 + 工具名）vs 上游 883 字符（只有 `* codemode (#2,#4,#6) x3`） |
| codemode 内调 `vcc_recall` | 可用；参数错误显式报 `Ignored: limit 5 (not a vcc_recall param)`；当前轮命中时提示已在上下文，不重复返回 |

### 3.2 成本量化（合成 n 轮，ranked 简报字符数 fork/上游）

| n | 不同意图 | 相同意图 |
| --- | --- | --- |
| 3 | 359 / 233 | 279 / 233 |
| 10 | 660 / 268 | 314 / 268 |
| 60 | 681 / 533 | 581 / 533 |

- 结论：上游把 N 条完全相同的 `codemode` 摘要**折叠成一行带 ref 列表**；fork 每个**不同**意图各占一行（ranked 上限 8 行条），相同意图会合并。
- 真实 13 轮会话：fork 985 字符 vs 上游 456 字符（+116%）。所以 README 275 行与计划 §5 的「意图没有成本」只在 n=1~2 的配对上成立。

### 3.3 已知 P3 缺口的实测复现

- 长脚本尾部不可达：6135 字符脚本 `expand` 只返回 1535 字符（`CODE_FULL_CHARS = 1500`），脚本末尾标记取不到。
- nested 分页缺失：40 条嵌套调用，列表显示最后 12 条、`expand` 显示最后 32 条，前 8 条不可达。
- 无 `codemode` store 投影、无 cursor/offset，`src/tools/recall.ts` 无新参数（与计划「P1 不加 P2 状态投影」一致）。

### 3.4 对计划书本身的评估（结论仍成立）

1. 优点：§2 第一性原理、§2.1 三类数据（原始记录 / 模型声明 / 算法派生）、§3.4 两层门控、§5 阶段门、§6.1 拒绝把诊断指标改名成成功率，都比一般的「压缩更小」叙事成熟。
2. 主要问题 A（成本结论过度概括）：见 3.2。
3. 主要问题 B（收益门名不副实）：§6.3 实际只验证了「可见性 + 无回归」，行为项（正确下一步、少重复调查、目标偏离）和 token 总账一条都没测，却记为「通过」。
4. 主要问题 C（派生信号未标注）：简报里的 `-> read, bash` 是源码静态扫描（含注释文本），§2.1 要求标注算法派生信号，简报行没有标注。
5. 主要问题 D（范围打包）：把「支持范围收窄到 Pi ≥1.0」+「删除自动续跑 fallback」和 codemode 可见性一起首发 0.1.0，用户体感最大的变化其实不是意图行。

---

## 4. 与文档口径的差异清单（可直接改的行）

| 位置 | 现口径 | 建议改成 |
| --- | --- | --- |
| `README.md:275`、计划 §5 | 「708 vs 733，意图没有成本」 | 「边际成本随**不同**意图数增长：每轮最多 8 行、相同意图合并；实测 13 轮会话 +116%，n=1~2 配对看不出差别」 |
| `README.md:260-268`（Compatibility and limits） | 只列了脚本 head-only、nested 上限、工具名是声明、无 store 投影 | 补两条：`mode:touched` 在 codemode-only 会话为空；早期意图会被简报的 8 行上限丢弃、只能经 recall 取回 |
| 计划 §6.3 收益门 | 「可见性 + 无回归 = 通过」 | 拆成三项：可见性 / 行为 / 字符总账，并注明当前只完成第一项 |
| 简报工具名 | `* codemode -> read, bash` | 加标注（如 `-> (declared) read, bash`）或并入 nested 实际状态 |
| `src/codemode/guideline.ts:8` 等 | 字符串自带 `- ` 前缀 → 渲染成 `- - ` | 去掉前缀，或按宿主格式产出 |

---

## 5. 建议优先级

1. **P0（文档，几行字）**：上面差异清单里的第 1、2、5 条。不改代码，避免下一次评估再被同样的口径误导。
2. **P1（补一个真实路径的测量）**：按「不同意图数」统计简报成本与**丢弃率**（本次 17→8），并顺带记录真实 `firstKeptEntryId` 窗口。这是把 §6.3 从「可见性」升级为三项门的最小步骤。
3. **P2（功能）**：让 `mode:touched` 覆盖 `nestedCalls`（等价于把 `fullText` 已有的 `isCodemodeMessage` 分支搬到文件指标里）。它比 store 投影收益更确定，因为它修的是「同一条会话里摘要看得见、recall 看不见」的不一致。
4. **P3**：长脚本分页、nested 分页（仍是用户体感最强的两个缺口）；再往后才是 store 投影与统一执行视图。

---

## 6. 未验证 / 不确定

- Pi 1.0.0 宿主上的 485 pass（需要往 node_modules 装旧宿主，与只读前提冲突，未做）；0.85.1 的历史数字已出范围；CI 是否真跑过未查。
- 行为级收益（下一步是否正确、是否少重复调查）依然没有测量；本次也只是「我没有重做前置工作」的主观感受。
- `- - ` 双横线是否在所有受支持宿主版本都出现：本机 1.2.0 出现，1.0.0 未验证。
- 本次压缩是手动触发（`reason: manual`），自动压缩路径的字段是否同形未测。

---

## 7. 附录：证据与命令

- 上游对照源码：`../.pi-eval/upstream`（`git archive` 解包的 v0.10.2）
- 脚本：`scale.ts`（成本随意图数/相同意图的缩放）、`gating.ts` / `gating2.ts`（69 个真实会话的零差异与只读渲染）、`gaps.ts`（长脚本尾部、nested 32 上限、非 codemode 条目 0 泄漏）、`intent-matrix.ts`（意图解析边界）、`live-session-dump.ts`、`ab.ts` / `ab2.ts`（fork vs 上游真实会话 A/B）、`inspect.ts` / `dump.ts` / `dump2.ts` / `dump3.ts` / `dump4.ts`（会话结构、压缩行、文件视图、规则注入核对）
- 真实 A/B 运行结果：`../.pi-eval/res/fork.json`（1101 字符）与 `res/up.json`（883 字符），两侧会话目录 `res/fork-sessions`、`res/up-sessions`
- 关键命令：仓库内 `bun test`、`bun run typecheck`；对照侧 `cd .pi-eval && bun run <script>.ts`

报告生成方式：全部结论来自本机真实文件、真实会话与真实压缩产物，未修改被测仓库任何文件。

---

## 8. 附：8 行上限该怎么改（真实会话仿真依据）

### 8.1 先看成本：8 行上限不是在省上下文

- 实测每行的字符数（本会话 53 个 codemode 轮）：**有意图时 57 字符（约 14 token）/ 行**；无意图时回退成 code head 行，**113 字符（约 28 token）/ 行**（407 条记录的会话实测）。
- 真实压缩时的绝对量：压缩前 72,002 token 上下文 → 摘要 1,376 字符；其中 8 条意图行约 490 字符（约 122 token），占上下文约 **0.17%**，占摘要约 36%。
- 关键对比：上游那 8 行上限是在**无意图**时代调的（8 x 113 约 900 字符/块）。也就是说，今天每块给无意图脚本头行留的字符预算，本来就够放约 16 条意图行。
- 结论：挤压上下文的不是意图行。真正要控的是「每块的字符预算」，不是「行数」。

### 8.2 在真实会话上仿真（53 个 codemode 轮，全部有意图，6 个 assistant 块，平均每块 9-11 轮）

| 策略 | 显示行数 | 字符 | 约 token | 被丢弃的意图 |
| --- | --- | --- | --- | --- |
| 现状：每块保留最后 8 行 | 33 | 1,956 | 489 | 19（36%） |
| 每块保留最后 16 行 | 49 | 2,941 | 735 | 3（6%） |
| 每块保留最后 24 行 | 52 | 3,090 | 773 | 0 |
| 全部保留 | 52 | 3,090 | 773 | 0 |
| 头 3 + 尾 12 + 中间摘要（每步截 28 字） | 49 | 2,957 | 739 | 5 |

- 代价：16 行/块比现状多 985 字符（约 246 token），相当于本次上下文的 0.3%。
- 最低成本点：**每块 16 行**把丢弃率从 36% 降到 6%；**每块 24 行**为零丢失的封顶值，再多不会有用（块长由用户轮次决定）。
- 仿真把全会话 6 个块都算进去了，所以绝对值偏保守（真实单次压缩只覆盖被摘要区间）。

### 8.3 具体建议（按收益/成本排序）

1. **上限从行数改成字符预算**：每个 assistant 块的 codemode 行预算约 1,000 字符（约 250 token）。按实测 57 字符/行约等于 17 行；若某块全是 113 字符的 code head，则自动回落到今天的 8 行。同一份预算对两种行型都给出合理条数，不必引入第二个魔法数字。
2. **每块永远保留最早的 1-2 行**（目标/计划锚点），剩余额度从尾部填。现在的策略永远丢最早的行，而被丢掉的恰恰是「这次任务要做什么」——长程任务里最贵的信息。
3. **让省略标记可操作**：`* (9 earlier codemode steps omitted: #2..#18, vcc_recall range:[2,18])`。封顶时行上还带着 ref，成本一行，收益是把静默丢失变成一条命令可取回。这一条可以立刻单独发布，零预算风险。
4. **只对超长块启用退化摘要**：单块 codemode 行超过约 40 条时，中间段压成 `* codemode earlier N steps: <意图前 20-28 字>；...`，每步约 28-30 字符（整行是 57 字符），前后保留明细行，块总量硬上限约 1,200 字符。仿真显示意图行本来就短，所以摘要只在块特别长时才划算。

### 8.4 验收标准（可直接并入计划 §6.3 收益门）

- 丢弃率：意图被完全丢弃的比例不高于 20%（现状 36%，每块 16 行方案 6%）；
- 锚点：每个块的第一条意图 100% 保留；
- 绝对量：单个 assistant 块的意图行不超过 1,000 字符，整份摘要不超过压缩前上下文 token 的 1%（现状 0.48%）；
- 相对量：相对上游的 token 增量不超过 10%。

### 8.5 一个提醒

不要把 `TOOL_CALLS_PER_TURN` 从 8 直接改成 16。它同时会放宽 bash、edit 等长噪声行（113 字符/行），那部分上游调参是有依据的。要点是**给两类行不同的预算**，而不是统一抬门槛。
