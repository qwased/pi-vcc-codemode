# pi-vcc-codemode 0.1.3 执行计划

- 日期：2026-10-28
- 状态：S0–S6 已完成（2026-10-28）；0.1.3 行为、文档与版本已落位，尚未提交、推送或发布。真实会话审计、T01–T26 汇总与双版本验证见 §9.4、§12、§15。`compileRanked` 已在有效历史含 codemode（或原始窗口曾含）时从当前分支重建正文，预算按全历史块数计算；非 codemode 会话仍走原路径。不是已发布声明。
- 决策依据：[最终审阅与决策记录](./CODEMODE_0.1.3_FINAL_REVIEW.md)。
- 取代范围：取代 [第五稿](./CODEMODE_0.1.3_PLAN.md) 的实施顺序、声明设计、预算、召回与验收规则；旧稿保留，不覆盖。
- 行为基线：`d8d511da6ed041b22b9351e2c0ae15180751c1e5`（0.1.2 发布提交，`package.json` 版本 `0.1.2`）；仓库 HEAD：`0fe9c2f4ed89106cdb6bca4d91a47db581c89913`（其后仅文档与 `.mailmap` 提交，无源码差异）。
- 首轮复核命令（不安装依赖）：`git status --short`、`git rev-parse HEAD`、`git log --oneline d8d511d..HEAD`、`bun --version`；确认源码仍与行为基线一致后再按行号定位。
- 目标版本：`0.1.3`，不是 `0.13`。版本口径经用户确认：保持 `0.1.3`，并在 CHANGELOG 明确列出已知变化（scan/read 新动作、简报行为变更、长会话有效预算上浮），不以“补丁版”淡化行为差异。

## 0. 下一对话窗口从这里开始

### 0.1 执行目标

在不调用 LLM 生成摘要、不修改原始会话的前提下，让 codemode 简报在固定字符预算内保留更有价值的历史导航，并使完整的已存文本能够被明确检索、分段读取。

本计划已决定产品取舍，不需要再讨论“声明能否用于打分”“是否取消 next”“是否分角色预算”。下一窗口需要先做实施前核验，而不是重新设计整套产品。

### 0.2 首轮工作清单

1. 读取仓库及全局 `AGENTS.md`、本计划和最终审阅；检查 `git status --short` 与当前提交。
2. 截至本次计划修订前，工作区无已跟踪文件的改动（文档改动已在 `20a45ea` 提交），只有一个未跟踪的备份 `docs/plans/CODEMODE_0.1.3_EXECUTION_PLAN.bak`（修订前与计划逐字节相同）；修订后，本计划以未提交修改留在工作区，`.bak` 是回退点。下一窗口先确认 `git status --short` 只多出这两项，再开始 S0。只把本计划明确要求的源码、测试和发布说明列入编辑范围，不覆盖其他工作。
3. 在取得既有文件的同位置备份许可后才修改源码；本次文档请求不视为对下一窗口备份操作的默示许可。若未获许可，只问这一项，先做不依赖许可的核验。
4. 按 codebase-memory 技能核对索引、逐改动的调用关系与源码、状态转换矩阵；本文件作为唯一实施计划继续补充 hunk 清单，不再平行创建另一份设计稿。修改本计划本身也遵守备份约定。
5. 核对锁定宿主版本与下表的代码锚点，然后执行 S0；不要先改版本号或将任务标为完成。
6. 不提交、不推送、不发布，不改 CI、权限、依赖范围或用户配置；这些操作需单独授权。

### 0.3 命令与环境

工作目录：`D:/geminiproject/pi-vcc-codemode`；Windows，工具 shell 为 Git Bash，Node 24；项目检查使用 Bun。

```sh
git status --short
git rev-parse HEAD
git log --oneline d8d511d..HEAD
bun --version
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test
```

测试涉及设置时必须将 `PI_VCC_CONFIG_PATH` 指向临时文件。没有 Bun 时先报告缺失，不以换锁文件或全局安装代替用户确认。真实会话默认不作为必需输入；先用合成夹具完成全部发布门。

## 1. 范围与明确排除

### 1.1 必须交付

- 完整已存文本的显式字面扫描，独立于压缩轮次，并支持有进度的继续扫描。
- 按 `#N` 读取原始字段视图的字符窗口，能连续读完长脚本、长用户消息及深层 nested 参数。
- goal 与受限 blocked 解析；加分有上限，不把注释变成状态或结果。
- 用户、助手正文、工具活动独立预算；头尾摘录、剩余量、稳定出处、原始顺序。
- codemode 新路径取消固定用户条数/总块数门槛；极端预算不足时按明确规则折叠。
- 历史 codemode 候选每轮从有效原始历史重新选择，不再让旧 brief 仅按 120 行裁尾。
- 生产管线审计、跨轮集成测试、非 codemode 兼容验证及文档。

### 1.2 不进入本版

- `effects/verify/done/verified/next` 声明族、当前任务状态机、永久 blocked、意图账本。
- 精确压缩血缘持久化、旧摘要全文索引、custom store 索引、隐藏推理或图片像素检索。
- Goals/Files 全面迁移到有状态账本、精确删除/重命名事实、为消除 Created 空行而反推创建。
- 新的公开预算设置（不新增旋钮）、新增依赖、CI 修改、修改宿主包或历史 JSONL。注意：`historyBlockCount` 改为全历史块数后，长会话会更早达到 2000 token 上限，属于**有效预算上浮**（见 §7.1），必须逐会话审计，不得笼统声称预算没有变化。
- 将任意输入 user 100%、写类保留率不低于只读、字符增量不超过 2% 同时设成硬门。

## 2. 已核实入口与实施文件

以下行号来自行为基线 `d8d511d`，仅用于定位；仓库 HEAD `0fe9c2f` 与行为基线仅差文档与 `.mailmap`。下一窗口先执行：

```sh
git status --short
git rev-parse HEAD
git log --oneline d8d511d..HEAD
bun --version
```

确认无源码差异后再核对当前内容，不按旧行号盲改。

| 入口 | 已核实行为 | 计划改动 |
|---|---|---|
| `src/types.ts:11-16`、`src/core/normalize.ts:28-55` | 归一化丢失 toolCallId、nestedCalls 与结果状态。 | S2 补最小关联字段，保持 sourceIndex 原语义。 |
| `src/codemode/intent.ts:9-14` | goal 只读第一行或 options 后第二行。 | S2 扩展头部约定区域、受限 blocked、拒绝计数。 |
| `src/codemode/summary.ts:76-93` | 旧 brief 输出 `-> <静态工具名>` 前缀加 `goal: <正文>` 或 `code:` 预览。 | 新简报改为 `intent: <短正文>` 或 `code: <≤80>`，去掉静态名字前缀，不把声明当实际调用证据（§3.4）。 |
| `src/core/brief.ts:278-425` | 用户有效词截断、助手头尾有效词、段内 8 条工具限制。 | S3 增候选构造/字符渲染接口，保留旧路径。 |
| `src/core/rank.ts:219-282` | 全块排序、80 块、16 最近块、超预算整块跳过。 | S3 新增分角色字符分配，旧导出保留给非 codemode 路径。 |
| `src/core/summarize.ts:197-269` | 旧 brief 按剩余行数裁尾，仅新 messages 进 rank。 | S4 新路径替换整个 brief，旧 headers 按既有规则合并后受预算约束。 |
| `src/hooks/before-compact.ts:224-276,529-778` | 窗口切分、尾部、全局索引与编译入口。 | S4 增历史候选来源，不改变切点规则。 |
| `src/core/format.ts:31-69,71,103`、`src/core/summarize.ts:255` | `format.ts` 定义 120 行 cap 与 `wrapLongLines`（31-69）、`RECALL_NOTE`(71)，并在 103 行做外层 wrap；note 由 `summarize.ts:255` 在合并后追加一次。 | 新路径阅读提示只出现一次，最终换行后再核实字符成本。 |
| `src/core/load-messages.ts:11-44`、`src/core/global-indices.ts` | 会话文件流读取和稳定消息编号。 | 复用计数规则，不能重编号。 |
| `src/core/recall-request.ts:7-36,63-159` | 参数白名单、修复、动作优先级和命令解析。 | S1 同步新增 scan/read/cursor 的解析及冲突规则。 |
| `src/core/recall-run.ts:20-63,115-158`、`src/tools/recall.ts:22-87` | view、派发、schema、提示。 | S1 增新动作及继续读取提示，修正 full 宣称。 |
| `src/core/search-entries.ts:258-327`、`src/codemode/search.ts:11-33` | 默认搜索文本有截断/字段限制。 | 保留默认相关性路径，新增完整字段路径，不通过调大 clip 假装修复。 |
| `src/core/jsonl.ts:12-56` | 64KB 流式分行，无起始偏移/提前停止接口。 | S1 增兼容的起点、停止与字节位置能力，供持续扫描复用。 |
| `scripts/codemode-brief-audit.ts` | 既有审计入口。 | S0/S5 接生产候选和最终编译结果，不复制选择器。 |

允许新增的最小实现模块：`src/core/recall-full.ts`（完整字段视图、扫描/读取）、`src/core/brief-history.ts`（历史候选来源）。候选类型与分配尽量放在现有 brief/rank 模块，不预建大而全的 metadata/state 框架。

## 3. 固定产品契约

### 3.1 兼容分流

- **历史门控**：正常依据有效历史中的 `isCodemodeMessage`，不是依据此刻是否启用 codemode 工具；若原始当前分支含 codemode，但编辑后有效候选为零，仍走本版失效处理和重建，不能回退旧摘要合并而复活内容。
- **提示门控**：仍依据当前 active tools；codemode 关闭时不注入其脚本提示。
- **非 codemode**：原始与有效当前分支均不含 codemode 时，现有压缩路径、8 条直接工具规则、120 行旧 brief 规则、默认搜索返回文本保持不变；新增显式 scan/read 能力可用于所有会话。scan 引导放在工具说明和文档，不追加到旧 query 返回文本。
- **codemode**：新正文预算、阅读提示、跨轮重建属于有意契约变更，小窗口也可能变化；不再要求该类会话逐字不变。
- **混合段**：以旧 `buildBriefSections` 对混合块的输出为准，取其保留集合中的直接工具行作为唯一允许的直接工具集合；codemode 行作为候选重新入场；被旧 8 条规则淘汰的直接工具一律不恢复。其候选再参与总预算。codemode 不再受旧“8 条＋1000 字符补回”二次裁剪。对应 golden 见 §9.2。
- 不改 smart keep-tail 的 5k/25k 规则，也不跟随宿主 keepRecentTokens 改值；显式 keep:N 仍优先。

### 3.2 字符、原文和出处

- 总预算与偏移单位使用 UTF-16 code units，即 `string.length`；文档明确它不是 token 或可见字数。
- 截取在 `Intl.Segmenter({granularity:'grapheme'})` 的边界上完成，不拆代理对、组合字符或字素簇。
- 用户/助手短文本保留经过现有 sanitize 后的完整文字；新路径不再删除助手 self-talk 前缀，也不调用有效词截断后冒称完整。
- 对现有 skill/宿主噪声折叠保持明确例外：只折叠既有可识别的注入内容，不对普通用户文本做语义概括；折叠与预算省略分别计数。
- 摘录的 total/omitted 指该条经过上述明确清洗后的显示文本；不是 JSONL 文件字节数，也不是 `read` 规范视图的偏移。
- `#N` 沿用会话文件中所有 `type:'message' && message != null` 的全局位置；system 占号但不输出；custom/compaction 不占号。
- 同一 assistant 消息的多个脚本共享 #N；内部关联使用 `toolCallId`，排序位置另用原始块序号，不能串配结果。
- 找不到来源时不生成假 #N；显示“来源编号不可用”，仍受预算限制。

### 3.3 单条阅读提示

新 codemode 简报开头放置一条短说明，内容固定为：

> 以下按历史顺序排列；用户、助手和 intent 是当时的表达，不代表当前状态或执行成功；工具名表示调用或脚本结构；简报采用有效编辑投影，#N 指向已存原始记录，两者文字可能不同；完整字段检索用 scan，长记录用 read。

实现采用以下固定英文文案，并用测试锁定，不随内容语言漂移：

```text
Historical navigation, not current state or proof of success. User/assistant text and intent are past statements; tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, which may differ. Use vcc_recall: scan searches saved fields; read pages through long records.
```

新路径不再追加旧的“Do not redo work already completed”尾部说明；旧路径不变。读取旧摘要时剥离已知旧 note 与新 note，不能堆叠。

### 3.4 正文行格式（固定）

新路径正文按以下行级格式输出。这些字符串是对 agent 的接口，测试与本契约同时锁定：

- 段头沿用 `[user]` / `[assistant]`。新路径每条正文首行末尾带 `(#N)`；多行原文按现有 `wrapLongLines` 的 120 字符折行续行，续行不重复来源。
- `bash` 执行块沿用现有 `[user]` 区段与 `$ <compressed command> (#N)` 行格式。
- 工具行：`* <tool> <nav> (#N)`。codemode 的 `<nav>` 为 `intent: <≤200 单位>` 或 `code: <≤80 单位>`；普通工具沿用现有参数摘要（如 `* Read "path" (#N)`、`* bash "cmd" (#N)`）。新路径不再输出旧的 `-> <静态工具名> | goal:` 前缀；静态工具名属于声明，不作为调用证据。
- 观测错误只在对应工具行追加后缀 `{error observed; result #R}`；不输出“仍未解决/已完成/已创建”等状态判断。
- 长文本摘录固定为三段：头部、`[omitted M of T chars; recall #N]`、尾部。折叠标记只包含折叠条数与“搜索边界”，不得称为“连续原文集合”。
- 同一 assistant 消息的多个块各自成行并共享同一 `(#N)`；仅当连续整行文本完全相同才折叠为 `(#a, #b) xN`，不跨角色合并，也不按“工具名＋路径”合并。
- 新增或修改上述任一字符串，必须同步更新对应 tests 与本契约（本节）；不接受只改实现或只改测试。

## 4. S0：基线、测试骨架与逐改动核验

### 工作

1. 记录基线提交、Bun/Pi 版本、现有 typecheck/test 结果及失败原因。
2. 沿现有审计入口增加可注入的生产编译函数和合成窗口构造，不先调整权重。
3. 为下表 H1–H8 逐项补齐 graph 路由、调用双向关系、源码核对、coverage 和近代码 hunk；对全量/否定结论使用 auditor，不以搜索命中数量证明完整。
4. 本计划中的近代码是目标接口，不是已验证补丁；落实逐 hunk 的可行性和可接受风险后再进入对应实施阶段。

| Hunk 组 | 目标 | 当前状态 |
|---|---|---|
| H1 | recall 参数/schema/派发/CLI | 已核验（2026-10-28，见 §4.1） |
| H2 | 完整字段视图、JSONL 游标、scan/read | 已核验（2026-10-28，见 §4.1） |
| H3 | normalize 关联字段、注释解析 | 已核验（2026-10-28，见 §4.1） |
| H4 | 候选构造、角色预算、实际成本渲染 | 已核验（2026-10-28，见 §4.1） |
| H5 | 有效历史投影、尾部排除、跨轮 brief 替换 | 已核验（2026-10-28，见 §4.1） |
| H6 | note 剥离、头部预算、旧路径分流 | 已核验（2026-10-28，见 §4.1） |
| H7 | 生产审计与合成/跨轮/兼容测试 | 已核验（2026-10-28，见 §4.1） |
| H8 | README/CHANGELOG/AGENTS 与版本 | 待行为稳定后核验 |

### 阶段门

现有失败与新失败可区分；S1–S4 的状态矩阵和最小 hunk 可实施；不因基线失败而跳过测试或修改无关实现。下一窗口可以从此阶段直接开始，不需要等待新设计讨论。

### 4.1 S0 核验结果（2026-10-28）

**基线与索引**

- `git rev-parse HEAD` = `0fe9c2f4ed89106cdb6bca4d91a47db581c89913`；`d8d511d..HEAD` 仅 `20a45ea`（文档归档）、`0fe9c2f`（.mailmap），`src/`、`tests/`、`scripts/`、`index.ts`、`package.json` 与行为基线无差异。
- `git status --short`：仅本计划的未提交修改与未跟踪的 `CODEMODE_0.1.3_EXECUTION_PLAN.bak`（修订前版本）。Bun 1.4.4；锁定宿主 `@earendil-works/pi-coding-agent` 与 `pi-codemode` 均为 1.4.0。
- 基线检查：`bun install --frozen-lockfile --ignore-scripts` 无变更；`bun run typecheck` 通过；`bun test` 517 pass / 0 fail / 1344 expect / 45 files（8.44s）。
- 图谱：project `D-geminiproject-pi-vcc-codemode`，status ready，generation `2026-10-26T20:24:33Z`，无 parse/skipped 缺口；本计划依赖的源码路径与审计代理追加的 56 条路径/10 个 scope 均为 `no_recorded_issue`，仅 `freshness=metadata_changed`（仅文档改动）。所有结论以源码直读为准。

**宿主前提（1.4.0 直读）**

- `buildSessionProjection` 从根导出（`dist/index.d.ts:21`），实现见 `dist/core/session-manager.js:256-280`：先 `buildContextEntries` 应用最新 compaction，再按 `context_edit` 对目标内容做 omit/replace；普通 `custom` 条目不进入上下文（同文件 164、191 行）；`buildSessionPath` 依赖 `parentId`。
- `CustomEntry` 形状允许影子替换 `{...entry, type:"custom", customType:...}`（`session-manager.d.ts:81-85`）；`ContextEditEntry` 为 `targetId` + `replacement.content|null`（同文件 119-126）。
- `ToolCall.id`、`ToolResultMessage.toolCallId/isError/nestedCalls`、`NestedToolCalls.calls[].status/error/argumentsBytes/complete` 均在 `pi-ai/dist/types.d.ts:271-284,400-435`。
- 压缩事件 `branchEntries` 来自 `sessionManager.getBranch()`（`agent-session.js:2242-2257`），是完整当前分支而非仅当前窗口。

**调用关系（图 + Tier 3 审计）**

- 不存在未列出的生产调用方。生产入口：`index.ts:13` → `before-compact.ts:764`（`compileRanked`）；`tools/recall.ts:87` 与 `commands/vcc-recall.ts:25`（`runRecall`）；`load-messages.ts:44` 与 `global-indices.ts:69`（`forEachJsonlLine`，`src` 内无会话 `readFileSync`）。
- `runAction` 的 `switch`（`recall-run.ts:134-165`）与 `IGNORED_REASON`（115-122）是新增 `action.kind` 必须同步的两个穷尽点；`RecallRequest` 只在 `recall-request.ts:143-148,158-159` 构造。
- `BuildSectionsInput` 的新字段目前只出现在文档，源码无人传入或解构。
- 图谱把 `compile → compileWithBriefBlocks → briefBlocksFor → selectRankedBriefBlocks` 标为可达，但运行时只有 `compileRanked` 传 `briefBlocksFor`；`compile()` 不触达 rank。
- 受影响文案测试：`tests/compile.test.ts`、`format.test.ts`、`build-sections.test.ts`、`codemode-gating.test.ts`、`codemode-visibility.test.ts`、`codemode-brief.test.ts`、`recall-request.test.ts`、`recall-range.test.ts`、`rank.test.ts`、`report.test.ts`、`summary-global-indices.test.ts`、`vcc-recall-command.test.ts`。`vcc_recall` 的 description/promptSnippet 无逐字断言，但 `tests/recall-request.test.ts:84-86` 要求 schema 接受 `_vccDropped`。

**逐 hunk 可行性**

| Hunk | 已核实锚点 | 可行性 | 主要风险 | 结论 |
|---|---|---|---|---|
| H1 | `recall-request.ts:7-13,24-31,36,63-113,120-149`；`recall-run.ts:115-122,134-165`；`tools/recall.ts:22-87`；`commands/vcc-recall.ts` | 可实施 | 新 action 需同步 switch、IGNORED_REASON、schema、命令解析与提示；旧 Ignored 文案被测试锁定 | 可行 |
| H2 | `jsonl.ts:12-57` 无起点/停止；`load-messages.ts:20-38` 计数；`search-entries.ts:270-297` 与 `codemode/search.ts:11` 各有 2000 上限 | 可实施 | 游标边界、分支锚点、损坏记录、字素边界；需保持旧调用签名 | 可行，T19–T23 锁定 |
| H3 | `types.ts:11-16`；`normalize.ts:28-55`；`intent.ts:9-14` | 可实施 | `sourceIndex` 语义不得改变；注释区规则与重复/拒绝计数 | 可行 |
| H4 | `brief.ts:278-425`；`rank.ts:219-282`；`format.ts:31-69,71,103` | 可实施 | 必须保留旧路径逐字行为；新分配器需按实际渲染成本记账 | 可行 |
| H5 | `summarize.ts:197-269`；`before-compact.ts:224-276,529-778`；宿主投影已核实 | 可实施 | 编辑 checkpoint 下界、影子路径、尾部排除 | 可行，T15/T16/T26 锁定 |
| H6 | `format.ts:71-103`；`summarize.ts:243-289` | 可实施 | 新旧 note 均需剥离；外层 wrap 幂等与预算复核 | 可行 |
| H7 | `scripts/codemode-brief-audit.ts`；测试入口见 §9.2 | 可实施 | 仅合成夹具，真实会话非必需；审计不得输出正文 | 可行 |
| H8 | README/CHANGELOG/AGENTS/package.json | 待行为稳定 | 版本与行为变化表述、Pi 1.0.0 临时副本验证 | 延后至 S6 |

**S0 已落位的审计接缝**

`scripts/codemode-brief-audit.ts` 增加 `compileBriefWindow`（默认注入生产 `compileRanked`）与 `buildSyntheticWindow`，并支持 `--synthetic --turns N [--plain]`；默认统计与权重未改，输出只含计数与长度。已用空会话目录运行验证：12 轮合成窗口生成 48 条消息、5247 字符、118 行。

### 4.2 状态转换矩阵（实施前冻结）

| 状态（当前） | 触发 | 状态（目标） | 移动的符号/路径 | 预期可观测 |
|---|---|---|---|---|
| S1 正常 query | `scan:false` 或未设 scan | 原 query 路径 | `parseToolRequest`/`runSearch` | 输出与既有 golden 一致 |
| S1 无扫描 | `scan:true, query, 无 cursor` | 固定上界扫描 | `forEachJsonlLine` 起点/停止、`recall-full` | 返回 hits 或 complete，或 partial+cursor |
| S1 部分页 | 页满 20 / 3s / 追加消息 | 下一 cursor | cursor 编解码 | 固定 maxBytes 不增长；零命中页仍给 cursor |
| S1 非法 cursor | 版本/查询/scope/session/分支不匹配 | 拒绝 | cursor 校验 | 明确重开扫描，不返回“无匹配” |
| S1 损坏行 | JSON parse 失败 | 跳过并标记 | 扫描计数 | `skipped/malformed` 计数，覆盖不完整 |
| S1 read | `read:{index,offset,length}` | 规范视图窗口 | `recall-full` 视图与字素边界 | actualStart/End/total/remaining；可拼回全文 |
| S1 read 极端 | 窗口小于字素/字素超 12000 | 拒绝并给所需值 | 字素边界函数 | `length-too-small` / `grapheme-too-large` |
| S2 注释 | 开头 ≤3 行 `// goal/blocked` | 受限 hints | `parseScriptHints` | goal 进 intent；blocked 只加分；拒绝计数 |
| S2 活动 | toolResult 的 nestedCalls/isError | mutation/readonly/unknown | `normalize` 关联字段、分类器 | 潜在写入优先，错误只在工具行加后缀 |
| S3 预算 | 短文本全装下 | 全文保留 | 候选构造/分配器 | 清洗后全文、顺序、#N |
| S3 长文本 | 超出角色额度 | 头尾摘录 | 分配器/渲染器 | `[omitted M of T chars; recall #N]` |
| S3 极端 | 最低版本装不下 | 折叠最旧连续区间 | 分配器 | 有计数与搜索边界，无空标记洪泛 |
| S3 溢出 | 外层 wrap 后超预算 | 回退最后一次增量 | 渲染复核 | `usedChars+reservedChars ≤ budget` |
| S3 极小预算 | 连 note+出处都装不下 | budget-too-small | 分配器 | 明确结果，不生成假空摘要 |
| S4 非 codemode | 原始/有效分支均无 codemode | 旧 compile 路径 | `compileRanked` 分流 | 逐字不变；8 条/120 行规则保留 |
| S4 历史 codemode | 原始分支有、编辑后有效为 0 | 新路径失效重建 | `brief-history`/`compileRanked` | 不合并旧 brief/header 复活内容 |
| S4 普通编辑 | omit/replace 普通消息 | 影子投影 | `buildSessionProjection` | 失效原文不进入正文/头部；#N 稳定 |
| S4 编辑 checkpoint | context_edit 指向 compaction | 保守下界 | 影子路径 + 下界 | limited 提示；不回填受限前缀 |
| S6 宿主缺失 | 1.0.0 无投影接口 | 不依赖投影的路径 | `collectLiveMessages` | 无编辑历史正常；有编辑时 fail-closed |

## 5. S1：完整已存文本访问

### 5.1 接口决定

保留现有 query/expand/range/touched/drill/recent 的正常行为。新增两个显式动作，不复用默认 mode 的语义：

```ts
type FullReadTarget = { index: number; offset?: number; length?: number };

type AddedRecallParams = {
  scan?: boolean;
  cursor?: string;
  read?: FullReadTarget;
};

type AddedRecallAction =
  | { kind: 'scan'; query: string; cursor?: string }
  | { kind: 'read'; index: number; offset: number; length: number };
```

工具调用示例：

```ts
vcc_recall({ query: '失效条件', scan: true, scope: 'all' });
vcc_recall({ query: '失效条件', scan: true, cursor: '<returned cursor>', scope: 'all' });
vcc_recall({ read: { index: 41, offset: 0, length: 4000 }, scope: 'all' });
```

命令入口同步支持：

```text
/pi-vcc-recall scan:true scope:all 失效条件
/pi-vcc-recall scan:true cursor:<returned-cursor> scope:all 失效条件
/pi-vcc-recall read:41 offset:0 length:4000 scope:all
```

新增标志只识别约定的独立 token。普通查询包含“read”“scan”不改变语义；扫描词中类似旧 drill 的 `#N:path` 也按字面匹配。scan/read 的冲突参数返回明确参数错误，不静默降为普通 query。旧动作之间的原优先级及 Ignored 语义保持不变。

同步修改类型、KNOWN_PARAMS、normalize、set/uses 或等价动作判定、IGNORED_REASON、schema、promptSnippet、工具说明、命令解析及命令提示。无效的新参数不能被 prepareArguments 丢掉后执行另一种动作。

### 5.2 完整字段视图

`recall-full.ts` 提供同一规范视图供 scan 和 read 使用，不借用 `renderMessage(full)`、`condenseCode` 或 capped `extractToolCallArgsText`。

覆盖：用户/助手 text、工具名称与所有深层参数、工具结果 text、bash command/output、已保存的 nested 名称/参数/status/error。递归包括对象、数组、标量，按保存顺序输出字段路径和完整字符串；字段边界有明确分隔，脚本文字不折成单行。

排除：system、thinking、带类型的图片/媒体内容块及其 base64 数据、compaction/custom/branch_summary 条目，以及 recall 自身的参数和工具结果，避免自我回声。这些排除按记录和内容块类型识别，不能因普通参数键名是 thinking、或字符串看似 base64，就猜测删除。扫描定义为该规范文本视图上的字面匹配，不声称 JSONL 字节级搜索或任意语义命中。

对于未保存的 nested arguments，输出已有缺失标记，不补造参数；对原工具输出写入前截断的数据同样不能补回。

### 5.3 scan 的完备性与资源约束

- 只做不区分大小写的字面子串匹配（逐 UTF-16 单元 `contains`，不做 Unicode 归一化、分词、词干、模糊或正则），不使用 BM25/相对得分地板，不限制整次扫描只能找到 50 条。
- 默认 scope 仍为 lineage；完整扫描不自动扩大分支，不剔除已保存的当前用户轮。明确显示 scope，需全会话时用 all。旧 query 的零命中回退及当前轮剔除不变。
- 每次最多返回 20 个不同消息命中，片段每条最多 200 单位；scan 输出总计不超过 8000 单位。一个消息多处命中先返回一个导航入口，read 可读全部。
- 扫描以单条记录为处理单位，不构建整会话的无界 BM25 文档数组。每次约 3 秒处理预算为软上限，检查发生在完整记录之间；不宣称可抢占单条巨型 JSON 解析。
- 首次固定当前文件读取上界、全局编号上界、session identity 和分支锚点。返回带版本的 cursor，至少含下一字节边界、下一 #N、固定上界、scope、查询校验信息、分支锚点和累计命中数。
- cursor 不含文件路径授权能力，不加载其中指定的任意文件；始终使用当前 sessionFile。校验整数边界、版本、查询/scope/session 匹配和记录边界；更换会话或切到非原分支后拒绝继续，提示重开扫描。
- 允许同一分支追加 recall 消息：固定上界排除追加内容，继续扫描不能因这些消息增长而永远结束不了。
- `complete` 表示在固定范围内扫描完成；`partial` 必须给下一 cursor，即使本页零命中。不能把超时/未扫描区间叫“没有匹配”。
- 文件缺失、读取错误、损坏记录分别说明；损坏记录不可跳过后仍宣称完全覆盖。输出 skipped/malformed 计数并将覆盖标为不完整。
- 字符匹配跨 JSONL 64KB 读取块仍应成立，因为解析的是完整记录；read/scan 使用同一字段视图，禁止查询命中无法进入 read 的“第二套文字”。

`forEachJsonlLine` 的可选起点/停止扩展必须维持旧调用签名可用；可增加 options 参数和 callback 位置信息，旧 callback 返回 void 的行为不变。不要将全文件 readFileSync 后 split 作为捷径。

### 5.4 read 的完整性

- `index` 为非负整数；`offset` 默认 0；`length` 默认 4000，上限 12000，必须为正整数。
- 读取一条记录的完整规范文本，输出 actualStart、actualEnd、total、remaining 和可复制的下一次 read 调用。
- 起点落在字素内部时回退到该字素起点；终点在 actualStart + length 以内回退到安全边界。若窗口装不下下一个完整字素，返回 length-too-small 和所需最小 length，不返回空页；若单字素超过 12000 硬上限，返回 grapheme-too-large，此病理输入明确不在本版保证可读完的范围内，不修改原记录。
- `offset === total` 返回 EOF；大于 total 返回越界错误；连续页使用返回的 actualEnd，而非自行加请求 length，不得循环返回原头部。
- 已指定编号但在 lineage 外时与现有 expand 一致，可明确标注 off-path 后读取；不伪装成本分支内容。
- read 不自动带出全部配套结果，避免一个请求失控；返回已验证的 toolCallId 配对结果编号供下一次 read，失败匹配不猜邻接编号。
- read 指向 §5.2 排除的 recall 自身记录时，返回近空视图（`total≈0` → EOF）；这是有意的自回声防护，不是记录丢失，也不为其补造字段。
- 现有 expand 继续作为方便预览，但工具说明中删除对 codemode “full untruncated”的承诺，长记录引导 read；默认 query 的匹配上限/参数截断及 scan 替代入口写入工具说明和文档，不修改旧 query 返回文本。

### 阶段门

深层对象、脚本第 2000 字符之后、nested 第 2000 字符之后均能由 scan 命中并由 read 找回；超过 50 条命中可连续枚举；分段读取拼合等于规范视图；不同压缩轮次不改变 #N 或扫描覆盖。

## 6. S2：注释与活动关联

### 6.1 最小数据流

在 tool_call 上保留 `toolCallId`，tool_result 上保留 `toolCallId`、`nestedCalls`、`isError`。原 sourceIndex 用于显示；按原始消息顺序及调用边界配对，不跨后续 assistant 消息串配复用 ID。

候选只需要以下信息，不持久化任务状态：

```ts
type ActivityClass = 'mutation' | 'readonly' | 'unknown';
type ScriptHint = { goal?: string; blocked?: string };
type ActivityEvidence = {
  category: ActivityClass;
  resultIndex?: number;
  observedError: boolean;
  incomplete: boolean;
};
```

具名 write/edit/multiedit/apply_patch 等 nested 调用可判潜在 mutation，不等于成功；全部已知为 read/glob/grep/ls/find 等且 nested 完整时才判 readonly。缺记录、不完整记录、bash-only、未知工具默认 unknown；本版不做复杂 shell 静态副作用判定。存在已观测写调用时，即使记录不完整仍可判潜在 mutation。

错误来自工具 isError 或 nested status/error，不从 goal/blocked/verify 推断。当前文件是否存在、操作成功后的当前状态均不在这个分类中。

### 6.2 注释解析

- 扫描脚本开头最多三行的连续 `//` 注释区；遇首个非空非注释代码行停止。`@options` 仍须保持第一行。
- 固定标记大小写不敏感；goal/blocked 正文各最多 200 UTF-16 单位，超长或空值拒绝并计数。
- 同一种标记重复时只取第一条合规值，不叠加；未知标记忽略，不解析脚本其他位置或工具输出里的注释。
- goal 正文用于 intent 预览；blocked 只用于最近区间内的加分，正文不渲染、不进 Outstanding Context。
- guideline 保持原两条为主：意图而非成功、如何召回；不加“必须写 blocked”，不新增 effects/next。

### 6.3 固定初始评分与测量裁决

以下为便于直接实现的工程初值，**不是已由数据证明的最优参数**：

| 项目 | 初始分值/规则 |
|---|---|
| mutation 基础分 | 30 |
| unknown 基础分 | 14 |
| readonly 基础分 | 6 |
| 最近性 | 全部候选的原始顺序归一到 0–12；重新压缩不刷新旧事件时间。ordinal 定义见下方 |
| 可观测错误 | +16；不解释为“尚未修复” |
| 合规 goal | +4 |
| 合规 blocked | 仅最后 25% 活动区间内 +2（ordinal 与最近性相同，见下方） |
| 注释总加分 | 上限 6 |
| 连续完全重复活动 | 除最近一条外 -12；不可只按工具名＋路径把不同修改合并 |

“最近性”和 blocked 的“最后 25%”使用同一 ordinal：在全历史有效候选集合内，按原始块顺序取位置 `p`（0 为最旧），归一化 `r = N <= 1 ? 1 : p / (N - 1)`，`N` 为候选块总数；最近性分 = `round(12 × r)`，blocked 仅在 `r ≥ 0.75` 时 +2。不按时间戳、token 或压缩窗口重新分桶，重新压缩不改变历史事件的 ordinal。

按 score 从高到低、再按原始顺序从新到旧选择；成本只决定是否装得下，不打八折、不把同一注释重复计分。最后按原始顺序输出。

工具额度先预留 20% 给有可观测错误的活动候选，不足用量返还总工具池；这是一条例外保留通道，不要求所有只读关键性都由算法判断。助手正文和 goal 是发现语义线索的另一渠道，不新增 `critical` 声明。

S5 分别比较 goal 权重 0/4、blocked 权重 0/2；发布选通过场景门且退化更少者，同等时选更简单的 0。不得为达到写/读保留率目标无限加分。

## 7. S3：角色预算与时间线渲染

### 7.1 总预算

新路径仍使用现有 1100/2000 tokens 估计范围和每块 15 的斜率，但将它明确换算为**整个新简报的字符上限**，不是 token 硬保证：

```ts
const budget = Math.round(
  Math.min(2000, Math.max(1100, 15 * historyBlockCount)) * charsPerToken
);
```

`charsPerToken` 复用已限制在 2–6 的校准值，因此单次总上限有界。`historyBlockCount` 是有效历史候选构造前的 normalized blocks 数（**全历史**），而非本轮新窗口或上一轮保留数量。

这带来一项必须声明的**有效预算上浮**：同一会话反复压缩时，`historyBlockCount` 不再只数本轮窗口，长会话会更早达到 2000 token 上限。这是有意的行为变化，不是新的公开设置，也不等于预算没有变化。审计必须逐会话记录 `historyBlockCount`、实际生效的字符预算、实际总字符与 1100/2000 换算上限的对照（见 §9.3）；发布说明不得用“仅内部调整”带过。

预算分配：

1. 阅读提示与结构分隔先按真实成本扣除。
2. 既有头部区段最多使用剩余预算的 20%；按完整项目边界裁剪，超长单项目用安全截断，并计入省略标记。未使用额度返还正文。
3. 正文剩余分为 user 40%、assistant 30%、tool 30%；这是内部初始参数，不公开配置。
4. 空类别或已完整容纳类别的剩余额度，依次给未完整的 user、assistant、tool。
5. 最终 wrap 后重新计数；如换行/提示使超限，回到分配器减少最后一次增量，不能在输出尾部盲目 slice 掉任意角色。

对于测试注入的极小预算，若连最小阅读提示与一个出处都装不下，返回明确的 budget-too-small 结果，由调用方不生成假空摘要；生产最小预算不应触发这一分支。

### 7.2 用户与助手分配算法

1. 用原始文本和来源构造候选，不先走旧 256/80/120 有效词截断，也不先用 maxBlocks 筛掉它们。
2. 每条最低保留 `min(原文长度, 64)` 个正文单位，头尾各半；角色、#N、标记等另按真实成本计入该角色额度。
3. 若全部最低版本装得下，保留全部；先按“补全文所需增量从小到大”补齐短消息，同成本最近优先。
4. 余量按每轮每条最多增加 64 个正文单位分配，最近到最旧轮转，直到没有空间；最终长条目头尾各半。
5. 若全部最低版本装不下，先把最旧连续消息区间折叠，保留最近可容纳区间的最低摘录；折叠标记包含消息数量与可验证的搜索边界。
6. 极端折叠不是常规路径，不能只为多保留几条工具而主动抹掉用户/助手文字；类别之间只有未用额度可借用，不强抢角色保底。
7. 普通短文本完整时逐字保留清洗后的内容；截断格式固定为头部、`[omitted M of T chars; recall #N]`、尾部，标记计入上限。

折叠同一角色的远端区间时，不能把夹在中间、仍被选中的其他角色内容移位：标记放在首个省略位置，说明是该边界内此角色的省略计数，不称为完全连续的原文集合。

### 7.3 工具活动候选

每条候选提供两种可计量版本：

- 普通版：简短 intent 或代码预览、实际具名调用线索/未知标记、结果错误线索、来源。
- 短版：工具名、最多 80 单位 intent/代码导航、必要错误标记及来源；不以只含编号的条目作为常规保留版本。

score 高的候选先获得短版；余量再升级普通版。超预算先降级，后淘汰；省略组数量和搜索边界受预算约束。候选始终保留原始块顺序；分配完才统一渲染。

观测错误只在工具行追加 `{error observed; result #R}`（§3.4），但不输出“仍未解决”。只读结果正文默认折叠，重要信息通过助手正文、意图、错误与结果编号导航，不把所有 stdout 引入简报。

### 7.4 近代码接口

在 `brief.ts` 建候选，在 `rank.ts` 分配，避免沿用“只返回入选原块”的接口后再次截断：

```ts
type BriefCandidate = {
  key: string;
  order: number;
  role: 'user' | 'assistant' | 'tool';
  sourceIndex?: number;
  sourceText: string;
  score: number;
  evidence?: ActivityEvidence;
};

type BriefSelection = {
  text: string;
  /** 分配器内部完成 wrapLongLines 后的简报正文字符数；外层再 wrap 必须幂等。 */
  usedChars: number;
  /** note＋结构分隔＋头部的实际字符数；不属于 usedChars，但计入总预算。 */
  reservedChars: number;
  counts: Record<string, number>;
};
```

`key` 用内部 entry ID/块序号或本次输入中稳定的 ordinal，不假设 #N 唯一。预算接缝固定如下：

- 分配器只能使用 `budget - reservedChars` 作为正文可用额度；`reservedChars` 由 note、结构分隔与头部区段的实际字符数相加，不能用常数估算。
- `usedChars` 等于分配器内部完成 `wrapLongLines` 后的简报正文字符数；外层再 wrap 必须幂等（再次 wrap 不改变长度），否则该值无效。
- note/headers 不计入 `usedChars`，但计入总预算：发布门检查 `usedChars + reservedChars ≤ budget`。
- 审计消费同一 selection，不另算一套近似成本。

`BuildSectionsInput`（`src/core/build-sections.ts:11-19`）同步扩展，供 S4 传入三套来源：本轮窗口的 Outstanding Context、有编辑时的有效全历史静态头部、全历史简报候选。

```ts
export interface BuildSectionsInput {
  blocks: NormalizedBlock[];
  briefBlocks?: NormalizedBlock[];
  /** S3 已渲染的正文；设置时优先于 briefBlocks，不再二次 cap。 */
  briefText?: string;
  /** 静态头部来源；有编辑时为有效全历史，缺省回退 blocks。 */
  headerBlocks?: NormalizedBlock[];
  /** Outstanding Context 来源；缺省回退 blocks。 */
  outstandingBlocks?: NormalizedBlock[];
  fileOps?: FileOps;
  trackCommands?: readonly string[];
}
```

优先级固定为：`briefText` > `briefBlocks` > `blocks`；`headerBlocks ?? blocks` 供 Session Goal/Files/Commits/Preferences/Tracked Commands，`outstandingBlocks ?? blocks` 供 Outstanding Context。非 codemode 调用不传新字段时行为不变。

### 7.5 S3 实施记录（2026-10-28）

已落位的接口与契约：

- `src/core/brief.ts`
  - `buildBriefCandidates(blocks, options?)`：按原始块顺序生成 `BriefCandidate`；用户/助手正文保留清洗后的原文，不删 self-talk、不做有效词截断；工具行使用 `* <tool> <nav> (#N)`，codemode 的 nav 为 `intent: <≤200>` 或 `code: <≤80>`，普通工具为参数摘要（如 `* Read "path" (#N)`、`* bash "cmd" (#N)`）。
  - 配对按 `toolCallId` + 同一 assistant 消息边界；复用 id 不跨下一条 assistant 消息串配。错误只在工具行追加 `{error observed; result #R}`。
  - 评分按 §6.3：mutation 30 / unknown 14 / readonly 6；最近性 `round(12*r)`；错误 +16；goal +4；blocked 仅 `r>=0.75` +2；注释总加分 ≤6；连续完全重复活动除最近一条外 -12。blocked 正文不进入候选、`sourceText` 或渲染。
  - `renderTextCandidate` 头尾各半截取，标记固定为 `[omitted M of T chars; recall #N]`（无编号时 `source index unavailable`）；`renderTextOmissionMarker` 为 `[N older user messages omitted; scan saved history #a..#b]`，`renderToolOmissionMarker` 为 `* (N earlier tool-call entries omitted; scan saved history #a..#b)`。
- `src/core/rank.ts`
  - `allocateBriefBudget(candidates, { maxChars, reservedChars })`：正文额度 = `maxChars - reservedChars`；初始 user 40%、assistant 30%、tool 30%，空/已满类别的未用额度按 user→assistant→tool 借给未完整类别；工具先短版、按 score 降序，20% 额度预留给可观测错误（未用返还），余量升级普通版；文本先补短消息到全文（增量小者优先、同成本较新优先），再按 64 单位轮转；装不下时折叠最旧连续区间并保留可验证搜索边界。
  - 最终 wrap 在分配器内部完成；若超过正文额度，按超出量缩小额度重试（最多 6 次），仍不行返回 `kind:"budget-too-small"`，不生成假空摘要。
  - `BriefSelection` 增加 `kind` 字段；`usedChars` 为内部 wrap 后正文长度，`reservedChars` 原样返回调用方传入的 note/结构/头部实际成本，发布门检查 `usedChars + reservedChars <= maxChars`。
- `src/core/build-sections.ts`：`briefText > briefBlocks > blocks`；`headerBlocks ?? blocks` 供 Session Goal/Files/Commits/Preferences/Tracked Commands；`outstandingBlocks ?? blocks` 供 Outstanding Context。未传新字段时旧调用逐字不变。
- `src/core/format.ts`：固定 `HISTORICAL_NOTE`（英文文案与 §3.3 逐字一致，测试锁定）；`trimHeaderToBudget` 按整行裁剪头部，超长单行用字素边界截断并加省略号，标记 `...(+N header lines omitted)`，极小预算返回空头部。20% 头部的实际调用与 note 拼装留在 S4。

S3 测试覆盖：T03/T04/T05/T06/T07/T12/T13；另含 100 条短用户消息、无标点中文、组合字符、同一消息交错块、复用 id、字素边界。typecheck 通过，`bun test` 591 pass/0 fail。

S4 接线注意：

- `allocateBriefBudget` 的 `reservedChars` 必须由 S4 用实际 `HISTORICAL_NOTE`、分隔符和（经 20% 裁剪的）头部文本长度计算，不能用常数估算。
- `buildSections` 的 `briefText` 传入分配器渲染结果后，`formatSummary` 用 `capBriefTranscript:false`，不要再过 120 行 cap；`HISTORICAL_NOTE` 只在最终拼装时出现一次。
- 新路径只在 `briefHistory` 存在且 codemode 门控成立时启用；没有该输入时 `compileRanked` 必须继续走旧路径。

### 阶段门

不同角色独立额度成立；超过 16 条用户或 80 块且预算充足时不因条数丢失；短文本、长中文/英文、无标点、组合字符、极端条数、同一消息交错块顺序全部通过；工具多寡不得改变已分配角色保底。

## 8. S4：跨轮历史重建与编译接入

### 8.1 选择的路线

采用**读取既有当前分支原始历史，重新建立 brief 候选**，不把旧 brief 当唯一数据库，也不新增持久化的无限候选缓存。

正常情况下只重建正文；原 header 提取仍使用本轮有效新消息与既有合并规则，之后受 S3 头部额度限制。不要把全历史重新送入“当前 Outstanding Context”提取器，避免把远端旧失败重新描述为当前阻塞。

若存在 context_edit，旧 header 也可能含被省略或替换的内容：本版不尝试从旧字符串中精确删除失效项，而是不继承 previousSummary 的任何 header，从本次有效历史候选重建静态头部，Outstanding Context 仍只取本轮有效新消息。被编辑 checkpoint 的历史下界同时适用于正文和这些头部；不可通过 Files/Goals/Preferences 把受限前缀重新引入。此时 previousSummaryUsed 为 false，头部详情可能比旧稿少，这是明确的保守取舍。

该编辑分支的 Files 也只从有效候选及其有效 nested 记录提取，不复用无法逐项证明来源仍有效的 preparation.fileOps 聚合；否则即使丢弃旧 header，失效路径仍可能从聚合数据重新进入。

### 8.2 来源与切点

- 保留现有 buildOwnCut/resolveSmartKeep/applyTailBudget；它们决定新压缩范围和尾部，S4 不另造切点。
- `branchEntries` 是当前分支路径，包含历史 compaction 节点；全局编号映射仍使用 sessionManager.getEntries 或现有文件回退。
- 无 context_edit 时，遍历当前分支所有原始 message，到本次 firstKeptEntryId 之前；compactAll 则取本次快照末尾之前的全部有效历史。
- 排除 system、非 message 条目、明确跳过的注入类型，以及保留尾部。用于普通 header 的 custom/branch_summary 转换仍留在旧 fresh 管线，不把它们编造为可 recall 的历史消息。
- 工具结果与调用配对不从尾部偷取正文；跨切点只有可证实的已有元数据才能用，不能把未压缩尾部再次渲染。

### 8.3 context_edit：使用宿主投影，但不能直接折叠历史

宿主 `buildSessionProjection` 会先应用最新 compaction，所以直接调用不能得到完整候选；简单删除 compaction 又会断开 parentId 链。

采用只在内存存在的影子路径：保留所有节点 ID、parentId 和顺序，将 compaction 节点替换为不产生上下文的 custom 节点，再交给宿主 projection 处理普通 message 的 omit/replace。不修改原节点、不写回 JSONL、不改 node_modules。转换后的 sourceEntry ID 仍映射原始全局编号。

必须补齐以下规则：

1. 先在原路径确定本次尾部边界，再投影历史；后来的 edit 即使位于尾部，也要影响它明确编辑的旧消息。
2. omit 的旧消息不进入自动简报；replace 使用最新可见替换，但 #N 仍指原始消息。阅读提示说明自动简报采用有效投影，read/scan 则是已存历史证据，不保证文字完全一致。
3. **编辑 compaction 节点的特殊情形**：不能把被用户省略的 checkpoint 背后的所有旧文字重新注入。设保守历史下界为最近一个被编辑 checkpoint 之后，只重建该下界之后的有效历史，加上本轮宿主仍视为有效的 ownCut 消息；此前内容不回填旧 brief，并给一条 `history limited by edited checkpoint; use recall` 提示。
4. 上述受限状态必须进入聚合审计，不能声称“全历史都参与了排序”；显式 recall 仍可访问已存原文，除非宿主本身已不保存。
5. 存在 context_edit 但宿主缺少投影接口时，沿现有 fail-closed 行为报告不能处理，不自行复活原文；不新增对低于支持范围宿主的兜底。
6. Pi 1.0.0 的无编辑历史必须正常走不依赖投影接口的路径；1.4.0 必须测试影子路径与真实宿主投影的普通消息 omit/replace 一致。

这是一条已决定的保守降级，不是待讨论项。若宿主接口核验发现无法保持这些语义，暂停 S4、记录具体反例并修改相应 hunk，不以旧摘要当原始消息绕过发布门。

### 8.4 编译接口与旧数据

```ts
type BriefHistoryInput = {
  messages: Message[];
  sourceIndices: Array<number | undefined>;
  hadCodemodeHistory: boolean;
  hasContextEdits: boolean;
  limitedReason?: 'edited-checkpoint' | 'missing-history';
};

type RankedCompileInputExtension = {
  briefHistory?: BriefHistoryInput;
};
```

- 无 briefHistory：完全保留现有 compileRanked 路径。hook 必须先检查原始分支和失效条件，不能仅因有效 codemode 数为零而省略此输入。
- 有 briefHistory，且有效历史含 codemode 或 hadCodemodeHistory 为 true：S3 生成整个新 brief，不拼接旧 brief、不再经过 120 行 cap；header 依 §8.1 在无编辑时合并、有编辑时从有效来源重建。
- hadCodemodeHistory 来自编辑投影/历史下界之前的原始当前分支记录，不靠扫描旧摘要文字猜测。失效处理先于新旧路径分流，本轮没有 codemode 或全部 codemode 被 omit 时也不能复活旧摘要。
- 旧 0.1.2 摘要不需要反推来源：原始历史仍在时直接重建；原始文件/节点缺失时不给假范围，保留可用 fresh、标明 missing-history，不承诺找回旧摘要已丢的信息。
- `previousSummaryUsed` 继续表示实际是否使用旧 header，有编辑而未继承时为 false；可新增有界统计字段 `briefHistoryMessageCount`/`briefHistoryLimited`，不要改 version=2 所代表的 #N 语义。

### 8.5 S4 近代码 hunk 清单

| 文件/位置 | 改动 |
|---|---|
| `src/core/build-sections.ts:11-19` | `BuildSectionsInput` 增 `briefText?`、`headerBlocks?`、`outstandingBlocks?`，优先级按 §7.4。 |
| `src/core/build-sections.ts:64-81` | `buildSections` 分别从 `headerBlocks ?? blocks`、`outstandingBlocks ?? blocks`、`briefText ?? stringifyBrief(buildBriefSections(briefBlocks ?? blocks))` 取数；非 codemode 调用不传新字段时逐字不变。 |
| `src/core/summarize.ts:243-256` | `compileWithBriefBlocks` 透传三套来源；新路径不调用 `capBrief`、不合并旧 brief；`RECALL_NOTE` 仍只在末尾追加一次。 |
| `src/core/summarize.ts:261-269` | `compileRanked` 接受 `briefHistory`；有该输入时走 S3 选择并传入 `briefText`。 |
| `src/core/format.ts:79-104` | `formatSummary` 接收已渲染正文，不再二次 cap；外层 wrap 幂等，供 `usedChars` 复核；必要时只加“已渲染”开关，不改旧调用默认值。 |
| `src/hooks/before-compact.ts:764-778` | 组装 `briefHistory`、三套块来源与预算字段；不改变 buildOwnCut/resolveSmartKeep/applyTailBudget 的切点。 |
| `src/hooks/before-compact.ts:737-743,768-771` | 有 context_edit 时，Files 的 `fileOps` 按 §8.1 从有效候选重建，不复用 preparation.fileOps 聚合。 |

### 阶段门

1/3/5 次连续压缩后，旧写入候选仍按原始时间评分，而不是无条件从旧摘要尾部淘汰；相同有效历史、相同预算和尾部边界应产生相同新 brief，插入额外 compaction 记录不能改变选择。

分支重试、compactAll、跨轮首次出现 codemode、codemode 工具关闭、旧摘要无 refs、普通 omit/replace、checkpoint 被编辑、索引缺失均有明确输出；不重复尾部，不回填被删除的投影文字。

## 9. S5：合成场景、审计和参数裁决

### 9.1 硬发布门与状态矩阵

| 编号 | 前态/触发 | 预期结果 |
|---|---|---|
| T01 | 无 codemode，原 query/compile 调用 | 除文档描述外，既有 golden 输出不变。 |
| T02 | 有历史 codemode，本轮纯普通消息 | 仍走新历史简报，不以 active tools 决定。 |
| T03 | 所有 user/assistant 短文本在额度内 | 清洗后全文、顺序和 #N 均保留。 |
| T04 | 长任务书，中段与末尾均有约束 | 头尾与实际省略量正确；中段内容通过 scan/read 找回，不宣称摘录完整。 |
| T05 | 17+ user、81+ blocks，预算足够 | 无固定条数淘汰；最终字符数不超限。 |
| T06 | 最低可读版本也放不下 | 较旧片段按规则折叠，有准确计数与有作用域的边界；无空标记洪泛。 |
| T07 | assistant text/tool_call/text 交错 | 输出顺序与原始块顺序一致。 |
| T08 | 同一消息多个 codemode，共享 #N | toolCallId 配对正确，不共享对方的结果/错误。 |
| T09 | 声明 read-like 意图，实际含 write 或失败 | 不覆盖观测，不输出创建/完成/已解除阻塞。 |
| T10 | 无注释、重复注释、超长、脚本字符串伪标签 | 无惩罚/不累计/拒绝位置不合规；原始文本仍可 read。 |
| T11 | 旧 blocked 经 3 轮压缩 | 不出现在 Outstanding，不刷新最近性，不永续加分。 |
| T12 | 普通旧只读与少量失败只读争夺工具额度 | 普通旧读取优先退让；错误保留通道生效，仍在真实预算内。 |
| T13 | 新 brief 与旧 headers 合并且触发 wrap | note 仅一次，总字符记账涵盖换行、标记和 headers。 |
| T14 | 1/3/5 次压缩，尾部与最终原始历史一致 | 新 brief 选择一致；旧候选没有“越压越新”。 |
| T15 | context_edit omit/replace 普通消息 | 正文及头部均不复活失效原文；原编号稳定；read 显示已存原始证据并说明语义。 |
| T16 | context_edit 指向 compaction | 启用下界和 limited 提示，旧 brief 与 Goals/Files/Preferences 等旧 headers 均不能带回受限内容。 |
| T17 | 全局编号缺失/system/custom/其他分支夹杂 | 无伪索引；system 占号但不输出，范围不是精确成员声明。 |
| T18 | 参数/脚本/nested 深处唯一词 | 默认 query 可近似；scan 必须找到并由 read 展开。 |
| T19 | 60+ 匹配、连续 cursor 扫描 | 没有总 50 条硬损失；可达固定上界，每条消息不重不漏。 |
| T20 | scan 时间片结束、当前页零命中 | partial＋cursor，不返回终局“无匹配”。 |
| T21 | 连续扫描期间会话追加 recall 消息 | 固定上界不增长，自回声不新增匹配。 |
| T22 | 错误 cursor/切分支/损坏 JSONL | 明确拒绝或 incomplete，不声称完整覆盖。 |
| T23 | read 多页/字素边界/EOF/越界 | 普通输入可拼回规范视图，偏移单调；length 不足时报所需值，单字素超过硬上限明确拒绝，无半字符或空页循环。 |
| T24 | 显式 keep:0、无用户锚点、超大尾部 | 保持原切点语义，不假设一定有尾部原文。 |
| T25 | Pi 1.0.0/1.4.0 | 双版本通过；仅宿主不存在的编辑能力测试可按现有方式条件跳过。 |
| T26 | 原始分支含 codemode，但编辑/下界后有效数为零 | 先清除失效旧 brief/header，再生成有效内容；不得借无 codemode 的旧路径重新合并。 |

### 9.2 既有测试入口

优先扩展：`tests/recall-request.test.ts`、`tests/search-entries.test.ts`、`tests/recall-quality.test.ts`、`tests/recall-range.test.ts`、`tests/vcc-recall-command.test.ts`、`tests/codemode-search.test.ts`、`tests/codemode-brief.test.ts`、`tests/brief.test.ts`、`tests/rank.test.ts`、`tests/compile.test.ts`、`tests/context-edits.test.ts`、`tests/summary-global-indices.test.ts`。

允许为新纯模块新增 `tests/recall-full.test.ts` 和 `tests/brief-history.test.ts`；在实施前核对同类测试是否已有更合适归属。现有测试中“第 2000 字符之后默认搜索搜不到”的断言可继续保留，同时新增 scan 能搜到的断言，不能为了让新测试通过把旧默认行为无意改变。

新增混合段 golden：同一 assistant 段内 codemode 与直接工具交织且工具行超过 8 条。断言只保留旧 `buildBriefSections` 已保留的直接工具行（不恢复被 8 条规则淘汰者），codemode 行按 §6.3 重新入场；建议落在 `tests/codemode-brief.test.ts` 与 `tests/brief.test.ts` 的现有夹具旁。

### 9.3 审计指标与停止调参规则

生产和审计共用候选分类、选择、截断与最终渲染函数。至少记录：

- 每会话 user/assistant 的完整率、摘录率、折叠率和实际保留字符比例。
- mutation/readonly/unknown/observed-error 的保留率，及被挤掉的类别。
- goal 正文存续与 goal 存在加分分开统计；blocked 采用量、加分量、拒绝量。
- 头部截断率：Files 与 Outstanding Context 分开统计被折叠/截断的条目占比；单会话超过 25% 记为头部退化，必须带省略标记并进入 S5 对照，不得在发布说明中宣称头部完整。硬门是“所有折叠都有标记且计入预算”。
- 单轮重建耗时：2000 个历史块的会话，重建＋渲染 p95 < 1.5s；超阈值先定位候选构造/排序，不以删功能绕过。
- read 单页耗时：2 万行会话的单页 read < 300ms。read 每页都从文件头定位记录，复杂度为 O(页数 × 文件)；若超阈值，在 S1 增加可复用的字节/编号提示（复用返回的下一位置），不新增公开参数。
- 实际总字符与预算对照：每会话记录 `usedChars + reservedChars`、生效 budget，以及相对 1100/2000 token × charsPerToken 换算上限的占比；任何一轮超过生效预算即发布门失败。
- 提示/出处开销、连续压缩增长、history limited 次数、`historyBlockCount` 与实际生效预算（见 §7.1）。
- scan 的完成/部分/失败覆盖状态，read 分段完整性；不是只统计第一页命中。
- 配对场景中的召回次数、重读次数与任务结果；真实会话只输出聚合，不输出正文。

先冻结合成场景门，再在调参样本上比较；独立验证集报告每会话差异和退化，不只 pooled 比例。数据不足时给敏感性结果，不编造“统计显著”。

参数裁决限于表中注释权重与既定角色比例的单独对照，不增加新声明补救。若候选未通过硬门，继续修正确性；若只是不显示收益，采用更简单的通过版本，并在发布说明降低效果宣称。不能删掉全文访问或预算硬门来赶版本。

### 9.4 S5 实施记录（2026-10-28，完成）

**审计接线（已完成）**

- `src/core/summarize.ts` 增 `compileRankedWithDetail`（`compileRanked` 委托其 `.summary`，输出逐字相同），返回与正文同一 selection 的 `BriefPlanDetail`：`budgetChars/usedChars/reservedChars/noteChars/headerChars/headerTruncated/headerOmittedItems/headerSections[{name,lines,omitted}]/limited/counts`。审计不再另算近似成本。
- `src/core/rank.ts` 的 counts 扩展为完整率/摘录率/折叠率、各角色保留字符、mutation/readonly/unknown 与 observed-error 的保留/淘汰、goal/blocked 总量与保留量、注释拒绝量；`src/core/brief.ts` 增 `hintRejected`（只有计数，无正文）。`RankedCompileInput.briefCandidateOptions` 为内部消融注入口，生产不传。
- `scripts/codemode-brief-audit.ts`：`--synthetic` 改用生产新路径（`buildBriefHistory` → `compileRankedWithDetail`），记录预算、`usedChars+reservedChars`、note 一次、头部省略；`--timing` 记录 2000 块重建 p95、2 万条记录 read 单页 p95、read 分段拼合与 scan 连续覆盖；`--adjudicate` 跑权重对照。默认真实会话统计与输出格式未改，仍只写计数与长度。

**发现并修复的分配器缺陷**

- 合成 160 块场景在生产预算（8000 字符）下返回 `budget-too-small`：`rank.ts` 的正文成本按换行前长度记账，`wrapLongLines` 后正文膨胀，外层 6 次“减少最后一次增量”无法收敛。修复：`textCost`/`toolCost`/标记均按换行后长度记账；`allocateBriefBudget` 用上一次实测的 `[user]/[assistant]` 结构开销做保留，最多 8 次收敛；仍不满足才返回 `budget-too-small`。回归测试见 `tests/brief-history.test.ts` “long lines are costed after wrapping”。typecheck 通过；`bun test` 621 pass/0 fail。

**合成场景门与计时（`--sessions <空目录> --synthetic --timing`）**

- 新路径合成窗口：40 轮 / 160 条消息 / 160 个历史块；budget 8000；`usedChars 7508 + reservedChars 402 = 7910 ≤ 8000`；`kind ok`；`HISTORICAL_NOTE` 恰好一次；旧路径同窗口为 13434 字符（对照，不作预算保证）。
- 2000 个历史块重建＋渲染：20 次，p95 194.47ms（门 ≤1500ms；note 改动后重跑）。
- 20,001 条记录会话：read 单页 5 次，p95 32.27ms（门 ≤300ms）；4 页拼合 12,036 字符与规范视图完全一致；scan 8 页、40 命中/40 个不同消息、`complete`、0 malformed。

**权重裁决（§6.3，冻结的 5 个合成场景 × 4 配置，budget 4400）**

| 配置 | mixed_goals（100 个有 goal） | all_goals | blocked_recent（15 个 blocked） | observed_errors（34 个错误） | annotated_reads（100 个带 goal 的只读） |
|---|---|---|---|---|---|
| goal4_blocked2 | 80 工具 / 56 goal | 112 / 112 | 43 工具 / 15 blocked | 35 工具 / 34 错误 | 47 写入 / 0 只读 |
| goal0_blocked2 | 67 / 34 | 112 / 112 | 43 / 15 | 35 / 34 | 47 / 0 |
| goal4_blocked0 | 80 / 56 | 112 / 112 | 45 / 9 | 35 / 34 | 47 / 0 |
| goal0_blocked0 | 67 / 34 | 112 / 112 | 45 / 9 | 35 / 34 | 47 / 0 |

- 错误保留率在所有配置均为 1.0；给只读加 goal 不会挤掉写入（只读基础分 6 + 4 仍低于写入 30）；`all_goals` 下 0/4 完全相同，符合“所有脚本都有 goal 时加分无区分能力”。
- **裁决：保留 goal=4、blocked=2。** 理由：goal +4 在同预算下多保留 22 条 intent 导航且无错误/类别退化；blocked +2 多保留 6 条最近 blocked 注释，代价是 2 条普通近期写入（已记录，不隐藏）。没有“同等”情形，故不触发“同等时选 0”；若后续真实会话显示净退化，再按 §6.3 改 0。
- 证据强度：上述权重表仅来自冻结合成夹具；真实会话审计只跑生产权重（见下），不含 0/4 对照，不宣称统计显著。真实会话 0/4 对照与逐会话退化比较未执行。

**真实会话收尾（2026-10-28，完成）**

- 命令：`bun run scripts/codemode-brief-audit.ts --sessions ~/.pi/agent/sessions --synthetic --timing --adjudicate --out research/codemode-brief-audit-s5.json`。只写聚合计数；`research/` 未提交，会话正文未打印或引用。
- 数据：91 个会话，15 个含 codemode，3 个含 compaction，1 个含 context edit。newBrief 15 个会话全部成功；`skippedNoEffectiveCodemode=0`、`skippedNoHostProjection=0`、`skippedErrors={}`；`limitedEditedCheckpoint=0`、`limitedMissingHistory=0`。
- 硬门：`overBudget=0`、`noteViolations=0`、`headerUnmarked=0`、`headerTruncatedSessions=0`、`headerDegradedSessions=0`。中位 `historyBlocks=55`、中位 `budgetChars=4400`、`medianRatio=0.988`、`maxRatio=0.999`；逐会话 ratio 0.347–0.999；`medianRebuildMs=33.96`。
- 保留率（pooled）：userFull=1.0；assistantFull=0.621 / excerpt=0.379；mutation=0.706、readonly=0.369、unknown=0.453、observedError=0.796；goal=0.667（414 个），blockedTotal=0；注释拒绝 0。
- 计时：2000 块重建 p95 194.47ms（门 1500ms）；20,001 条 read 单页 p95 32.27ms（门 300ms）；4 页拼合 12,036 字符一致；scan 8 页、40 命中/40 个不同消息、`complete`、0 malformed。
- 合成 160 块：`used 7508 + reserved 402 = 7910 ≤ 8000`；note 一次；`kind ok`；旧路径同窗口 13434 字符。
- 权重：真实会话 blocked 总数为 0，goal 保留 0.667；没有与 §9.4 合成裁决冲突的净退化证据，保持 goal=4、blocked=2。真实会话未做 0/4 对照，故不宣称真实数据上的权重优势。
- note 成本：本轮 `HISTORICAL_NOTE` 新增 74 字符（reserved 328→402）；当前开发会话在两次审计间继续写入 codemode 消息（goalTotal 315→414），pooled 比例不宜跨轮直接比较；硬门与 overBudget 仍为 0。

**审计缺陷（已修复）**

- 主循环构建 `buildBriefHistory` 与 `compileRankedWithDetail.sourceIndices` 时引用了未定义的 `indexById`，15 个真实会话全部抛 `ReferenceError`，却被 catch 误记为 `skippedNoHostProjection`。改用 `session.indexById`；catch 只在错误信息含 `buildSessionProjection` 时计投影缺失，其他错误按 `name|source frame` 聚合到 `skippedErrors`（不含正文）。证据：修复前 `newBrief.sessions=0 / skippedNoHostProjection=15`，修复后 `15 / 0`。
- 分配器重试停滞：真实 75 块 / 4500 预算会话返回空简报（`budget-too-small`），失败带很窄。`structure = used - total + structure` 在代数上等于用上一次超量替换估计，预算下降而选择粘滞时无法继续收缩；改为 `structure += used - (total - structure)`（相对当前正文预算累积超量）。回归测试 `tests/rank.test.ts` “does not stall on narrow sticky budget bands...” 在旧公式下于 2050/2051/2076/2077 返回 `budget-too-small`，修复后全部 `ok` 且不超预算。该真实会话修复后为 `ok`，15/15 note 一次。

**S5 交付边界**

- T01–T26 覆盖汇总见 §12.1。真实会话只跑了生产权重；真实任务结果/逐会话权重对照未执行。read 的 2 万条性能只在合成文件上完成。

## 10. S6：契约文档、版本与交付

代码行为稳定后才修改：

- `README.md`：简报是历史导航；分角色预算与折叠例外；scan/read 示例；默认 query/expand 的限制；scope、原始记录与投影区别；不保证恢复未保存数据。
- `CHANGELOG.md`：先在 `[Unreleased]` 记录用户可见变更，发布时遵循项目现有格式。
- `AGENTS.md`：历史门控与 active 门控、真实字符预算、注释不认证事实、旧直接工具路径保留、新 codemode 路径替代局部额度、scan/read 与全局 #N 契约、审计不泄漏正文。
- `package.json`：全部门通过后改为 `0.1.3`；核对锁文件是否有根版本元数据，不重新解析或升级依赖。版本语义经用户确认：保持 `0.1.3`，不升 `0.2.0`；CHANGELOG 必须逐项列出已知变化（新增 `scan`/`read` 动作、codemode 简报行为变更、长会话有效预算上浮、非 codemode 路径保持），不得把它描述为“无行为变化的补丁”。

支持范围保持 `>=1.0.0 <2.0.0`。最低版本验证在独立临时工作副本中完成，避免降级当前工作区依赖：复制必要源码/测试/清单到临时目录并排除 .git、node_modules、research，在该目录执行仓库既定 1.0.0 安装与检查命令；不要把临时会话或依赖差异带回仓库。

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.0.0 @earendil-works/pi-codemode@1.0.0
bun run typecheck
bun test
```

锁定 1.4.0 检查使用当前工作区的 frozen-lockfile 安装；两组结果分别记录。若需要改动已有依赖或安装环境，先确认影响，不静默降级。

交付摘要必须包含：完成阶段、自动验证结果、人工冒烟步骤、已知限制、未执行的真实会话实验。不要把仅通过类型检查说成全部功能验证通过。

## 11. 依赖、执行顺序与工期口径

```text
S0 基线与逐改动核验
 ├─ S1 完整字段访问
 └─ S2 关联与注释 → S3 角色预算
S1 + S3 → S4 跨轮接入 → S5 集成与参数裁决 → S6 文档与版本
```

S1 与 S2 可由两个执行者处理，但 request/run 的共享接口和 types/normalize 的更改分别设负责人，避免并行改同一文件。S3/S4 先顺序实施，不把未验证 hunk 同时铺开。

本次为单次发布：S1–S4 全部通过 S5 门后统一以 `0.1.3` 交付（用户已确认版本口径，见 §10）。不拆分为两次发布；若执行中决定拆分，必须先回改本计划的版本与验收口径，不能在半途自行改号。

不沿用第五稿的 4.8 天，也不把前审的 8–12 人日当新范围的承诺。新增完整扫描、分段读取和历史重建是实际功能工作；S0 后按通过的 hunk 数与宿主边界再估算，不因版本号小而跳过闭环。

## 12. 执行状态与阶段交接模板

| 阶段 | 状态 | 本次已完成内容 |
|---|---|---|
| 文档与必要源码核实 | 完成 | 两份新文档；已核实主要入口与已知截断/合并问题。 |
| 计划修订（P0/P1 六项） | 完成 | 2026-10-28 落位：§0.2/§2（基线、HEAD 与复核命令）、§3.4（固定行格式）、§7.4/§8.5（预算接缝与 S4 hunk）、§3.1/§9.2（混合段 golden）、§9.3（指标阈值）、§7.1/§1.2/§10/§11（有效预算上浮与版本口径）。证据：HEAD `0fe9c2f`；修订前 `git status --short` 仅未跟踪的同内容 `.bak`，修订后多出本计划的未提交修改（预期）；Bun 1.4.4；上述源码锚点（build-sections/format/summarize/rank/search-entries/codemode summary/before-compact/session-manager）直读核对。typecheck/test 沿用上一窗口 517 pass，本轮只改文档未重跑。 |
| S0 | 完成（2026-10-28） | 基线：HEAD `0fe9c2f`，d8d511d..HEAD 仅文档；Bun 1.4.4；宿主 1.4.0；typecheck 通过；`bun test` 517 pass/0 fail。图谱 generation `2026-10-26T20:24:33Z`，依赖路径无 recorded issue；Tier 3 审计确认无未列出的生产调用方。宿主投影、CustomEntry、NestedToolCalls、branchEntries 均直读核实。H1–H7 判定可行，H8 延后。S0 接缝：`scripts/codemode-brief-audit.ts` 增加 `compileBriefWindow`/`buildSyntheticWindow` 与 `--synthetic`，默认权重与统计未改；合成 12 轮验证通过。计划文件新增 §4.1/§4.2。未解决：Pi 1.0.0 实机验证留待 S6；真实会话审计非必需。 |
| S1 | 完成（2026-10-28） | 新增 `src/core/recall-full.ts`（规范字段视图、字素窗口、scan 游标、read 配对）；`jsonl.ts` 增加起点/固定上界/字节位置并保持旧签名；`recall-request.ts` 增 scan/cursor/read 解析与显式冲突错误；`recall-run.ts` 增派发、`IGNORED_REASON` 与格式化；`tools/recall.ts`/`commands/vcc-recall.ts` 增 schema、说明与继续提示，删除 expand 的 full 宣称。测试：新增 `tests/recall-full.test.ts`（深字段/2000 后命中、60 命中连续扫描、零命中 partial+cursor、追加消息固定上界、非法 cursor/分支/损坏 JSONL、字素/EOF/越界/病态字素、配对、自回声、compaction 不占 #N）；扩展 `tests/recall-request.test.ts`、`tests/vcc-recall-command.test.ts`。结果：typecheck 通过；`bun test` 556 pass/0 fail。未完成：2 万行 read 单页 <300ms 的实测留到 S5 审计；scan 3s 为软预算。 |
| S2 | 完成（2026-10-28） | `types.ts` 增 `toolCallId`/`nestedCalls`/`isError` 与 `ActivityClass`/`ScriptHint`/`ActivityEvidence`；`normalize.ts` 保留关联字段；`intent.ts` 改为前 3 行注释区、goal/blocked、空/超长拒绝计数、重复取首条；`codemode/summary.ts` 增工具名分类与嵌套活动分类（写优先、完整只读才 readonly、缺失/不完整/bash/未知为 unknown，错误可观测）。测试更新 `normalize.test.ts`、`codemode-intent.test.ts`、`codemode-visibility.test.ts`，新增活动分类用例于 `codemode-brief.test.ts`。结果：typecheck 通过；`bun test` 567 pass/0 fail。T08（关联字段）、T09（声明不覆盖观测）、T10（注释边界）已覆盖；T11 的跨轮 blocked 计分与渲染留到 S3/S4。 |
| S3 | 完成（2026-10-28） | `brief.ts` 增 `buildBriefCandidates`（文本/工具候选、toolCallId 配对、§6.3 评分、重复活动扣分）与 `renderTextCandidate`/`renderToolCandidate`/折叠标记；`rank.ts` 增 `allocateBriefBudget`（user 40%/assistant 30%/tool 30%、20% 错误保留通道、短版先入/余量升级、未用额度借用、内部 wrap 与超限重试、budget-too-small）；`build-sections.ts` 增 `briefText`/`headerBlocks`/`outstandingBlocks` 及优先级；`format.ts` 增固定 `HISTORICAL_NOTE` 与 `trimHeaderToBudget`（整行裁剪、超长单行字素安全截断、计数标记）。测试：`brief.test.ts`（T07 交错顺序、工具行格式、intent/blocked、复用 id 配对、重复扣分、字素安全摘录），`rank.test.ts`（T03/T04/T05/T06/T12/T13、100 条短消息、中文无标点、组合字符、budget-too-small），`build-sections.test.ts`（briefText/三套来源），`format.test.ts`（头部 20% 裁剪）。结果：typecheck 通过；`bun test` 591 pass/0 fail。未接线：`compileRanked`/`briefHistory`、note 拼装与剥离、头部 20% 的实际调用、预算公式与 `historyBlockCount`、编辑分支 Files 重建均留到 S4；新路径尚未进入生产，旧非 codemode 测试全部保持通过。 |
| S4 | 完成（2026-10-28） | `src/core/brief-history.ts`（新）：从当前分支原始 message 构建有效历史，排除 system/`!!` bash/非 message/skipCustomTypes/保留尾部；有 context_edit 时保留节点 id 与 parentId、把 compaction 换成不产生上下文的 custom 影子节点后调用宿主 `buildSessionProjection`，按 sourceEntry 位置排除尾部（尾部中的 edit 仍作用于其目标）；编辑 compaction 时以最近被编辑 checkpoint 为下界并标记 `edited-checkpoint`；边界 id 缺失 fail-closed 为 `missing-history`；无编辑不触碰投影接口（Pi 1.0 路径）。`src/core/summarize.ts`：`RankedCompileInput` 增 `briefHistory`/`briefBudgetChars`；`compileRanked` 在 `briefHistoryHasCodemode` 且预算存在时走 `compileWithEffectiveHistory`——历史候选重建正文、不合并旧 brief/不 capBrief，头部无编辑时按既有规则合并、有编辑时从有效历史重建且不继承旧 header，Outstanding 只取本轮，`HISTORICAL_NOTE` 只出现一次，新旧 note 均从旧摘要剥离；分配器超预算返回 `""`（不生成假摘要）。`src/core/format.ts`：`formatHeaderSections`（formatSummary 复用，输出不变）与 `LIMITED_HISTORY_NOTE`。`src/core/filter-noise.ts`：`keepUserSourceIndex` 选项（仅新路径启用，旧路径逐字不变）。`src/hooks/before-compact.ts`：`historyBlockCount` 取有效历史 normalized blocks，`budget = round(clamp(15*count,1100,2000)*charsPerToken)`；编辑分支 fileOps 改由有效历史 nested 记录重建；`previousSummaryUsed` 在编辑分支为 false，details 增 `briefHistoryMessageCount`/`briefHistoryLimited`，debug 只记计数。测试：新增 `tests/brief-history.test.ts`（25 个用例：排除/尾部/compactAll/缺失边界、无编辑不投影、分支重试与全局 #N、最新 replace/omit、尾部 edit、checkpoint 下界、T02/T14/T15/T16/T17/T24/T26、note 一次、预算上限、budget-too-small、旧路径剥离新 note），`tests/context-edits.test.ts` 增 T15/T16/T26/T24 hook 集成并更新“有编辑不继承旧 header”的旧断言。结果：typecheck 通过；`bun test` 620 pass/0 fail（S3 结束 591）。与 §7.5 的偏差：新路径在 `summarize.ts` 内直接拼装头部/正文/note 以取得 §7.1 要求的精确 reservedChars（头部先按 20% 裁剪再分配），`buildSections` 只用于三套块来源且不再二次 cap；`briefText` 接口保留给旧调用。未完成：S5 审计接线与场景门、真实会话指标、read 性能实测；S6 文档/版本/Pi 1.0.0 临时副本。 |
| S5 | 完成（2026-10-28） | 审计接线与合成门见 §9.4。收尾修复两处审计缺陷：主循环误用未定义 `indexById`（15 个会话被误记为 `skippedNoHostProjection`；改用 `session.indexById`，catch 只对 `buildSessionProjection` 计投影缺失，其他错误按 `name\|frame` 聚合到 `skippedErrors`），以及分配器重试在窄预算带停滞（75 块/4500 会话曾返回空简报；改为相对当前正文预算累积超量，回归测试在 `rank.test.ts`）。真实会话审计（91 会话/15 含 codemode）：overBudget=0、noteViolations=0、headerUnmarked=0、headerTruncated=0、headerDegraded=0、limited=0；medianBlocks=55、medianBudget=4400、medianRatio=0.988、maxRatio=0.999；pooled goal=0.667、mutation=0.706、readonly=0.369、error=0.796、blockedTotal=0；2000 块重建 p95 194.47ms、20,001 条 read p95 32.27ms、scan 8 页 40/40 complete。真实数据无净退化证据，保持 goal=4/blocked=2。T01–T26 汇总见 §12.1。结果：main 1.4.0 typecheck 通过、622 pass/0 fail；临时 1.0.0 typecheck 通过、622 pass/0 fail。 |
| S6 | 完成（2026-10-28） | README：简报为历史导航、角色预算/折叠、有效预算上浮、非 codemode 旧路径不变，scan/read 示例保留未改写；CHANGELOG `[Unreleased]` 增补 codemode 简报行为、有效预算上浮、非 codemode 不变与空简报修复；AGENTS 更新布局与规则（历史/active 门控、UTF-16 字符预算、注释不认证事实、旧直接工具路径、scan/read 与全局 #N、审计不泄漏正文）；`package.json` 0.1.3，`bun.lock` 根工作区无版本字段故未改。Pi 1.0.0 临时副本（排除 .git/node_modules/research）：npm 安装 1.0.0/1.0.0，typecheck 通过，622 pass/0 fail；删除临时目录。主工作区 frozen-lockfile 1.4.0：install 无变更，typecheck 通过，622 pass/0 fail。未执行：真实会话任务结果/权重对照、Pi 1.0.0 交互实机。 |

每个阶段结束更新本节，记录实际修改文件、对应 T 编号、命令与结果、未解决问题；遵守技能要求的状态转换测试和改后重新建索。不能仅写“完成”而不附证据。

### 12.1 T01–T26 覆盖汇总（2026-10-28）

证据以测试名或审计聚合为准；“部分/仅合成/未实测”在备注列标明。

| T | 覆盖 | 证据与备注 |
|---|---|---|
| T01 | 覆盖（单元/golden） | `brief-history.test.ts` “no codemode anywhere: output is byte-identical with and without briefHistory”；旧 `compile.test.ts`/`format.test.ts`。无真实会话逐字对照。 |
| T02 | 覆盖 | `brief-history.test.ts` “T02: historical codemode keeps the new brief even when this window is plain”。 |
| T03 | 覆盖 | `rank.test.ts` 短文本全文/顺序/#N；100 条短用户消息不因条数淘汰。 |
| T04 | 覆盖（合成） | `brief.test.ts` 头尾摘录；`recall-full.test.ts` 深层字段 scan/read 找回。中段找回为合成夹具。 |
| T05 | 覆盖 | `rank.test.ts` “T05” 与新增 “does not stall on narrow sticky budget bands”。 |
| T06 | 覆盖 | `rank.test.ts` “T06” 折叠最旧连续区间与计数边界。 |
| T07 | 覆盖 | `rank.test.ts` “T07” 文本/工具交错顺序。 |
| T08 | 覆盖 | `brief.test.ts` 调用/结果配对与复用 id 不跨消息；`normalize.test.ts` 关联字段。 |
| T09 | 覆盖 | `codemode-brief.test.ts` 写优先、只读需完整记录、未知/缺记录、错误可观测且不造状态。 |
| T10 | 覆盖 | `codemode-intent.test.ts` 空/超长/重复/正文伪标签/未知标记。 |
| T11 | 部分 | blocked 解析、最近性 +2、正文隐藏已覆盖；跨 3 轮压缩与 Outstanding 的显式断言未单独实测。 |
| T12 | 覆盖 | `rank.test.ts` “T12” 错误保留通道与普通旧只读退让。 |
| T13 | 覆盖 | `rank.test.ts` “T13” note 一次、reserved 计费、wrap 幂等。 |
| T14 | 覆盖 | `brief-history.test.ts` “T14” ×2：插入 compaction/多轮不改变选择与 #N。 |
| T15 | 覆盖 | `brief-history.test.ts`/`context-edits.test.ts` “T15” omit/replace、原编号稳定。 |
| T16 | 覆盖 | `brief-history.test.ts`/`context-edits.test.ts` “T16” checkpoint 下界与 limited 提示。 |
| T17 | 覆盖 | `brief-history.test.ts` “T17” ×2：system/custom 不造伪索引；无索引不输出 ref。 |
| T18 | 覆盖 | `recall-full.test.ts` 深层对象/2000 后/nested；端到端 scan 命中后 read 展开。 |
| T19 | 覆盖 | `recall-full.test.ts` “enumerates more than 50 matches...”；审计 scan 8 页 40/40 complete。 |
| T20 | 覆盖 | `recall-full.test.ts` “returns partial + cursor even when the page has no hits”。 |
| T21 | 覆盖 | `recall-full.test.ts` “a fixed maxBytes excludes recall messages appended during the scan”。 |
| T22 | 覆盖 | 非法/损坏 cursor、跨 query/scope/session/branch、malformed JSONL 覆盖不完整。 |
| T23 | 覆盖 | 多页拼合、字素边界、EOF/越界、length-too-small、病态字素拒绝。 |
| T24 | 覆盖 | `brief-history.test.ts`/`context-edits.test.ts` “T24” 无用户锚点 compact-all。 |
| T25 | 覆盖 | 主工作区 1.4.0：typecheck 通过、622 pass；临时副本 1.0.0：typecheck 通过、622 pass。非交互实机。 |
| T26 | 覆盖 | `brief-history.test.ts`/`context-edits.test.ts` “T26” 编辑清除 codemode 后不回退旧合并。 |

未执行/仅合成：真实会话任务结果与逐会话权重对照（真实审计只跑生产权重）；read 的 2 万条性能只在合成文件上；Pi 1.0.0 只做临时副本自动测试，未做交互实机。

### 12.2 真实会话副本复测（2026-10-28）

- 来源：`PI_SESSION_FILE` 复制到 `research/real-session-current.jsonl`（git 忽略）；189 个条目、188 个分支条目、174 条 codemode 消息，0 compaction。未改原会话。
- 方法：用生产 `buildOwnCut`/`applyTailBudget`/`buildBriefHistory`/`compileRankedWithDetail` 模拟 keep:1/2/3/5；每档连续编译两次比较输出。
- 结果：keep:1 → 179 块，budget 8000，used 7275 + reserved 653 = 7928（ratio 0.991）；keep:2/3/5 → 154 块，used 6066 + 653 = 6719（0.84）。全部 `ok`，note 一次，无超预算、头部截断、limited；两次编译的 `used/counts/summary` 一致。
- 保留：keep:1 mutation 32/32、observed error 7/7、goal 57/84、readonly 0/12、unknown 25/40；keep:2+ 工具 72/72（mutation 27/27、readonly 12/12、unknown 33/33、error 7/7、goal 72/72）。keep:1 的更紧工具额度下只读被挤出，是当前 30% 工具预算的真实结果。
- 访问：`headerDegradedSessions`/`CODEMODE_0.1.3_EXECUTION_PLAN`/`skippedErrors` 分别 10/19/12 命中，均 1 页 `complete`、0 malformed、扫描 185 条；宽查询 `e` 为 10 页、182 命中/182 唯一、`complete`、0 malformed。最长命中 read 11 页、total 41,494 字符、reassembled 41,494、remaining 0、连续。
- 简报结构：`research/real-session-brief-keep1.txt`（含正文，未提交）7,928 字符/167 行，最大行 119，note 一次、无旧 note，含 `Session Goal is a condensed excerpt` 提示，4 个 user/4 个 assistant 段、58 条工具行、1 个 omission marker、1 个 header 段。
- 边界：单会话、非任务结果或权重 0/4 对照；副本没有 compaction 后新增轮次，故未把追加 compaction 的跨轮实验当作有效结论（T14 由合成夹具覆盖）。

## 13. 附录：下一窗口可直接使用的任务说明

> 请执行 `docs/plans/CODEMODE_0.1.3_EXECUTION_PLAN.md`，先读配套 FINAL_REVIEW 和 AGENTS，确认工作区仅有本计划的未提交修订与修改前备份 `.bak`，从 S0 开始。产品取舍已确定，不重开注释可信性等方向讨论；先确认既有文件的备份许可，再完成逐改动静态核验与状态矩阵，逐阶段实施和测试。不得跳过 scan/read、跨轮候选来源、极端预算降级与非 codemode 兼容门；不改 CI，不提交、推送或发布。某项源码前提不成立时记录具体证据并重新核验相应 hunk，不臆造兼容行为。

## 14. S3 后的下一窗口交接提示词（2026-10-28）

> 历史记录：本节描述 S3 结束时的状态，已由 §15 取代；“尚未接入”等表述仅在当时成立。

本轮已完成 S0–S3；S4–S6 尚未开始。以下提示词可直接用于下一窗口：

```text
请继续执行 docs/plans/CODEMODE_0.1.3_EXECUTION_PLAN.md，先读该计划（尤其 §3、§7.5、§8、§9、§12）和配套 CODEMODE_0.1.3_FINAL_REVIEW.md、AGENTS.md，并核对 git status --short 与 git rev-parse HEAD。S0–S3 已完成：基线 517→591 个测试全绿（typecheck 通过），scan/read 已接入生产，S3 的候选构造与角色预算分配器已落位但尚未接入 compileRanked。产品取舍已确定，不重开注释可信性、next、分角色预算等方向讨论。

工作区已有多处未提交修改和同位置 .bak 备份；备份许可已获准，不要覆盖已有 .bak。继续从 S4 开始，按顺序完成：
1) 新建 src/core/brief-history.ts：从当前分支原始 message 构建有效历史 candidates/sourceIndices，排除 system/非 message/skipCustomTypes 与保留尾部；用内存影子路径替换 compaction 节点后调用宿主 buildSessionProjection，处理普通 omit/replace；检测被编辑 checkpoint 并设置保守下界与 limited 提示；无编辑时不依赖投影接口。
2) summarize.ts：RankedCompileInput 增 briefHistory；compileRanked 有该输入且 codemode 门控成立时走新路径——不再合并旧 brief/capBrief，头部按 §8.1 合并或重建，outstanding 只取本轮，briefText 交给 buildSections，HISTORICAL_NOTE 只拼装一次，剥离旧 RECALL_NOTE 与新 note；previousSummaryUsed 按实际 header 继承设置。
3) before-compact.ts：按 §7.1 计算 historyBlockCount 与 budget = round(clamp(15*count,1100,2000)*charsPerToken)；用实际头部+note+分隔符成本调用 allocateBriefBudget（头部先过 trimHeaderToBudget 的 20% 上限）；编辑分支的 Files 从有效候选/nested 重建，不复用 preparation.fileOps；保留 buildOwnCut/resolveSmartKeep/applyTailBudget 切点。
4) 测试与门：T02、T14–T17、T24、T26；确认无 codemode 时 compileRanked 输出逐字不变，原始分支有 codemode 但编辑后有效为零时不得回退旧合并；节点缺失/分支重试/compactAll/Pi 1.0 无编辑路径都要有明确输出。完成后更新计划 §12 S4，再按 §9–§11 做 S5（合成场景、审计、goal/blocked 权重裁决）与 S6（README/CHANGELOG/AGENTS、0.1.3、Pi 1.0.0 临时副本验证）。不改 CI、不提交、不推送、不发布；某项源码前提不成立时记录证据并重核 hunk，不臆造兼容行为。
```

本轮交接的已知事实与接口：

- 基线：HEAD `0fe9c2f`；锁定宿主 1.4.0；`bun run typecheck` 通过；`bun test` 591 pass/0 fail。
- 已完成文件：`src/core/recall-full.ts`（新）、`src/core/brief.ts`、`src/core/rank.ts`、`src/core/build-sections.ts`、`src/core/format.ts`、`src/core/jsonl.ts`、`src/core/recall-request.ts`、`src/core/recall-run.ts`、`src/core/normalize.ts`、`src/codemode/intent.ts`、`src/codemode/summary.ts`、`src/tools/recall.ts`、`src/commands/vcc-recall.ts`、`scripts/codemode-brief-audit.ts`。
- 新路径接口：`buildBriefCandidates` → `allocateBriefBudget(candidates, { maxChars, reservedChars })` → `BriefSelection { kind, text, usedChars, reservedChars, counts }`；`trimHeaderToBudget`；`HISTORICAL_NOTE`。
- 尚未接入：`compileRanked`/`briefHistory`、头部 20% 的实际调用、note 拼装与剥离、hook 预算公式、编辑分支 Files 重建。新 codemode 简报目前不会在生产中触发；非 codemode 旧路径保持不变。
- 未完成验证：真实会话审计与 read 单页性能实测（S5）；Pi 1.0.0 实机（S6）；README/AGENTS 用户文档（S6，行为稳定后再改）。

## 15. S6 完成后的最终交接（2026-10-28）

S0–S6 已完成；0.1.3 行为与文档已落位，未提交、未推送、未发布，CI 未改。当前 HEAD 仍为 `0fe9c2f4ed89106cdb6bca4d91a47db581c89913`，所有改动都在工作区。

**验证结果**

- 主工作区（锁定 1.4.0）：`bun install --frozen-lockfile --ignore-scripts` 无变更；`bun run typecheck` 通过；`bun test` 622 pass / 0 fail（47 files / 1770 expect）。
- Pi 1.0.0 临时副本：复制 `index.ts`、`src/`、`tests/`、`scripts/`、`package.json`、`bun.lock`，排除 `.git`、`node_modules`、`research`；`npm install --no-save --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.0.0 @earendil-works/pi-codemode@1.0.0` 后宿主与 codemode 均为 1.0.0；`bun run typecheck` 通过；`bun test` 622 pass / 0 fail；临时目录已删除，依赖未带回仓库。
- 审计：`research/codemode-brief-audit-s5.json`（未提交）15 个 codemode 会话，`overBudget`/`noteViolations`/`headerUnmarked`/`headerTruncated`/`headerDegraded`/`limited` 均为 0，`medianRatio 0.988`、`maxRatio 0.999`；2000 块重建 p95 194.47ms，20,001 条 read 单页 p95 32.27ms，scan 8 页 40/40 `complete`。

- 真实会话副本复测（2026-10-28）：当前会话复制到 `research/real-session-current.jsonl`（189 条/188 分支/174 条 codemode）；keep:1 生产路径 179 块、budget 8000、used 7275 + reserved 653 = 7928、ratio 0.991；keep:2/3/5 为 154 块、6719（0.84）；均 note 一次、无超预算/头部截断/limited；keep:1 保留 32/32 mutation、7/7 error、57/84 goal，readonly 0/12；keep:2+ 保留全部 72 工具。scan 10/19/12 命中、complete、0 malformed；宽查询 `e` 10 页 182 命中；最长记录 read 11 页 41,494 字符完整拼合。单会话，不是任务结果或权重对照。

**未执行项（必须随交付说明）**

- 真实会话任务结果与逐会话权重对照；真实数据没有 goal 0/4 的消融，只有生产权重审计。
- read 的 2 万条性能只在合成文件上；真实超大会话未实测。
- Pi 1.0.0 只有临时副本自动测试，没有交互实机运行。
- 未做真实会话逐字旧/新摘要对照；T01 的“既有 golden 不变”由单元/golden 覆盖。

**0.1.3 关键接口**

- 门控：有效历史含 codemode 或 `hadCodemodeHistory`；编辑清除后不回退旧合并。prompt 仍随 active tools。
- 预算：`historyBlockCount` 为全有效历史；`budget = round(clamp(15 * count, 1100, 2000) * charsPerToken)`；UTF-16 单位；note/header 先计费；user 40 / assistant 30 / tool 30；折叠最旧连续区间。
- 简报：`* <tool> intent: ...`/`code: ... (#N)`；单一 `HISTORICAL_NOTE`；旧 RECALL_NOTE 剥离；observed error 仅后缀。
- 访问：`scan`/`read` 与 `#N` 同空间；scan 固定上界＋版本 cursor；read 字素窗口/EOF/越界/病态字素。
- 审计：只写聚合，不输出正文；修复 `indexById` 与分配器重试停滞。

**发布前仍需单独授权**

- 提交、推送、npm 发布、CI 修改；`CHANGELOG` 目前仍是 `[Unreleased]`，发布时按现有格式改写为 `0.1.3` 并加日期。
- 若发布前再改行为，需同步 README/AGENTS/CHANGELOG 与对应 T 测试。
