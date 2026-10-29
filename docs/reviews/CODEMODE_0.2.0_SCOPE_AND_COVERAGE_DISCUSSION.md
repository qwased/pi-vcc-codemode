# pi-vcc-codemode 0.2.0 范围、[Session Goal] 与压缩覆盖讨论记录

- 日期：2026-10-30
- 性质：**讨论记录，不是实施计划**。本文只新增本文件，不修改源码、设置、版本或测试，不提交、不发布。
- 代码基线：`8d8e668`，package 版本 `0.1.4`。本次只读取源码与文档，未运行测试；文中优先引用符号名，行号仅作定位参考。
- 关联文档：[0.1.5 升级计划](../plans/CODEMODE_0.1.5_UPGRADE_PLAN.md)、[围栏截断缺陷报告](./CODEMODE_BRIEF_FENCE_TRUNCATION_BUG.md)、[0.1.4 现场复核](./CODEMODE_0.1.4_FIELD_REVIEW.md)、[0.1.2 讨论记录](./CODEMODE_0.1.2_DISCUSSION_RECORD.md)。
- 数据边界：不引用任何真实会话正文、路径或会话文件名；文中示例均为合成文本或结构描述。

## 0. 结论摘要

1. **0.1.5 应完成 6 项**：计划 R1–R5（H1–H5）加围栏配平（P0）。围栏不是"顺手修"：它吞掉的正是 H2/H3/H4 要提供的 `result #N`、`* codemode goal:` 行、省略标记与 `HISTORICAL_NOTE`，因此必须排在 H2/H3 之前，并补计划 T 矩阵缺失的围栏用例。计划 §5 的冻结 golden 差异契约仍需先获批准。
2. **[Session Goal] 建议在新 codemode 路径删除，而不是改成"用户发言头尾摘录"。** 删除的改动面（过滤 catalog、从 `previousSummary` 剥离、改写 note、迁移测试）严格小于摘录方案；摘录方案还要新增提取器、header 的 `#N` 通道、合并语义和配额上限，并且**没有解决去重**——正文的 `[user]` 块本来就是同一段文本的第二个窗口。
3. **语义推断章节有三个，不是一个。** `[Session Goal]`、`[Outstanding Context]`、`[User Preferences]` 分别依赖 `TASK_RE`/`SCOPE_CHANGE_RE`、`BLOCKER_RE`、`PREF_PATTERNS` 等英文启发式；中文会话中三者基本全空。只删一个会留下"声明不推断语义、却在推断状态"的契约不一致。
4. **职责划分成立**：压缩器只描述"发生过什么"和"原文在哪"，"现在要做什么、做到哪一步"由 /GOAL、/plan 一类状态插件在每轮自给。压缩器不需要、也不应该认识这些插件；唯一官方接触点是配置项 `skipCustomTypes`，不是代码分支。
5. **多轮压缩后的召回可发现性，靠"覆盖声明 + 分区不变式"，不靠再加一句提醒。** 当前新路径的折叠标记会在"被折叠段里有一条没有 `#N`"时整体丢掉范围；legacy 路径的 `...(N earlier lines omitted)` 从来不带 `#N`；标记建议的 `scan saved history #a..#b` 也不是可执行调用。0.1.2 讨论记录第 3 条早已提出"应加覆盖声明"，至今未实现。

## 1. 方法与边界

本次讨论的证据来源只有三类：

1. **源码核对**：`src/extract/*`、`src/core/{summarize,brief,rank,format,brief-history,global-indices,normalize,settings}.ts`、`src/hooks/before-compact.ts`、`src/details.ts`、`scripts/audit-sessions.ts`。
2. **既有文档复核**：0.1.4 现场复核的分块数字（如 `[Session Goal]` 475 字符、占摘要 7.3%）来自该报告，本次未独立复算。
3. **合成推演**：`#N` 分区、折叠标记、`custom_message` 注入形态等均按当前代码路径推演，未做运行时实验。

**没有做的事**：未重放或复算任何真实会话、未运行 `bun test`/`bun run typecheck`、未修改 `tests/fixtures/allocator-golden.json`、未评估性能、未对 TUI 做人工验证。文中所有"应"均为设计判断，不是已验证行为。

## 2. 0.1.5 应完成的工作

| 序 | 工作 | 来源 | 验收要点 |
|---|---|---|---|
| 0 | **围栏配平（P0）** | 围栏缺陷报告方案 A+B+C | `excerptText` 围栏状态机；拼装末尾不变量；`capBrief`/`capBriefToLineBudget` 的孤立收尾行；`attachRef` 不落进 info string。golden 围栏数为 0，预期零差异；若出现差异只记 `amended`，不重生成 |
| 1 | **H2 中性结果导航** | 计划 §4 H2 | 已配对就输出 `{result #N}`，不写 success/verified；后缀计入 short/normal 成本 |
| 2 | **H3 直接工具有限通道** | 计划 §4 H3 | 两条通道各占 `floor(toolQuota*0.2)`；收缩时先降 normal，再按 普通→直接→错误 删行 |
| 3 | **H1 最近长文本深度** | 计划 §4 H1 | 最近 6 条中取 2 条 ≥256；`allowance = min(384, quota/4)`；每次借额/重试按当次 quota 重算 |
| 4 | **H4 header 来源说明** | 计划 §4 H4 | 计入 20% header 成本；重复压缩不叠加；0.1.4↔0.1.5 双向切换 |
| 5 | **H5 预算落库 + 审计指标** | 计划 §4 H5 | `briefBudget` 记真实字符率/块数/上限；指标取最终 keep/selected/omitted，旧记录不倒填 |
| 6 | **R5 兼容与发布** | 计划 §9 | §5 差异契约先获批；Pi 1.0.0/1.4.0 双跑；README/CHANGELOG；版本 0.1.5 |

两项排序结论：

- 围栏修复只动渲染层，`textCost` 用 `renderTextCandidate` 的结果计费，围栏插入引起的长度变化会自动进入成本，因此不影响 H1 的分配器设计；但必须在 H2/H3 之前完成，否则导航会被代码块吞掉。
- 计划的状态矩阵缺围栏用例，应补三条：head 切在围栏内、tail 起点仍在同一围栏内、源文本本身未闭合。

## 3. [Session Goal]：三个方案与推荐

### 3.1 三个方案的改动面

| 方案 | 改动点 | 是否解决去重 | 是否解决中文 | 主要风险 |
|---|---|---|---|---|
| **A. 新路径删除本节** | 过滤 header catalog；从 `previousSummary` 主动剥离旧块；改写 `HISTORICAL_NOTE`；迁移测试；legacy 路径不动 | 是（正文 `[user]` 是唯一副本） | 是（不再做语言相关提取） | 原始任务降级为"recall 一次可见" |
| **B. 摘录首条用户发言** | A 的全部 + 新提取器 + header 的 `#N` 通道 + 合并改"fresh 覆盖 prev" + 长度受 `headerCap` 约束 + 围栏感知 | **否**（正文与 header 各有一份不同窗口） | 是 | 多出第二个带"目标"标题的截断副本 |
| **C. 修好提取器** | 重写 `extractGoals`（语言无关、保留 `[Scope change]`）+ 全部 A 的兼容与迁移工作 | 否 | 部分（只能靠启发式，无法覆盖中文改写） | 工作量最大，且仍然在"猜意图" |

推荐 **A**。理由是改动面严格更小，且它把"这是任务契约"的语义从压缩器里移出，与后续的职责划分一致。

### 3.2 方案 B 的隐藏成本（逐项核验）

1. **摘录来源会冻结。** 新路径的 `headerBlocks` 是本轮窗口的 blocks（`compileWithEffectiveHistory` 中 `blocks`/`historyBlocks` 二选一），首条用户消息在第一次压缩后就不在窗口里；重新提取得到空，`mergeHeaderSection` 会把上一版摘录留下来，摘录停在生成那一刻。要修必须改用 `historyBlocks`。
2. **header 没有 `#N` 通道。** `SectionData` 各字段都是 `string[]`，引用只在 `renderTextCandidate` 里追加；把 ref 编进 header 文本后，还要保证 `trimHeaderToBudget` 的单行 clip 不会切掉它。
3. **列 0 的 `[omitted …]` 会被当成章节名。** `sectionLineCounts` 用 `/^\[(.+?)\]$/` 扫 header，独占一行的标记会被记成一个假章节，并把真正章节的续行算到它名下——与 0.1.3 era 的 `details.sections` 已知问题同形。
4. **合并语义要单独改。** `mergeHeaderSection` 对 Session Goal 做行级去重 + 8 行尾截断，摘录会逐轮累积；必须改成 fresh 覆盖 prev，并定义"本轮没有 user block"时的行为。
5. **20% header 的优先级倒挂。** `trimHeaderToBudget` 从尾部整行丢弃，Session Goal 在 catalog 第一位，因此摘录先活、`[Files And Changes]`/`[Commits]` 先死；H4 的前置提示行还要再占一行。摘录长度必须按 `headerCap` 定额。
6. **围栏缺陷会直接污染它。** 复用 `excerptText` 意味着 head 可能切在代码围栏内，标记与 `(#N)` 一起被吞（见围栏缺陷报告）。必须先做配平。
7. **次要：偏好去重键退化。** `dedupPreferencesAgainstGoals` 用整行精确匹配；目标是长摘录后几乎匹配不到，`[User Preferences]` 与用户正文的重复会变多。

### 3.3 如果仍要保留"意图锚点"，最小且诚实的写法

- 只取**有效历史**里第一个通过噪声门（`NON_GOAL_RE` 一类：跳过 skill 块、粘贴输出、命令模板）的 user block；去掉 `TASK_RE`/`SCOPE_CHANGE_RE` 与 `>200` 字拒绝——中文失效主要死在这三条（0.1.2 讨论记录实测：258 字单段中文首消息 → 全空）。
- **单条、不跨压缩合并**（fresh 覆盖 prev）。
- 标记内联或行首带 `#N`，格式与正文一致：`[omitted 1800 of 2400 chars; recall #12]`；只写"省略 N 字"没有可执行性。
- 长度按 `headerCap` 定额，先围栏配平再复用 `excerptText`。
- 廉价去重：若正文对同一 user block 已整段保留（keep == 全文），不渲染这条 header 摘录。
- 这仍然是一个"新增原文窗口"，不是"Session Goal 的替换实现"；标题语义与 `HISTORICAL_NOTE` 的 395 单元需要同步改写。

### 3.4 与既有规则的关系

- AGENTS.md 已写明 `[Session Goal]` 是"用户文本的压缩摘录，不是任务契约"；方案 A 是把这句话落实到渲染层。
- `HISTORICAL_NOTE` 原文含 "Session Goal is a condensed excerpt; recall the original for constraints"，其措辞与 395 单元被 AGENTS 与 `tests/rank.test.ts` 钉住；删节必须**有意改写**并更新 pin，不能顺手改。
- `mergeHeaderParts` 会从 `previousSummary` 复活已删除的章节，因此 0.1.4→新版迁移必须主动剥离，并测试"两次压缩后不重现"。
- legacy（非 codemode）路径必须保持上游一致，删除只作用于新编译分支。

## 4. 语义章节不止一个：只删 Session Goal 会留下契约不一致

| 章节 | 机制 | 性质 | 中文表现 |
|---|---|---|---|
| `[Session Goal]` | `extractGoals`：`TASK_RE`/`SCOPE_CHANGE_RE` 英文动词、行级 `>200` 字拒绝 | 意图推断 | 长段落全空；后续改动不识别 |
| `[Outstanding Context]` | `extractOutstandingContext`：`BLOCKER_RE` + 近 20 块 + 行首需为大写字母、反引号、引号或代码标识符 | **状态推断**（"未解决"是最强的状态断言） | 基本不命中 |
| `[User Preferences]` | `extractPreferences`：`PREF_PATTERNS` 全英文、`>200` 字拒绝 | 偏好推断 | 基本不命中 |
| `[Files And Changes]` | 工具名白名单 + 宿主 `fileOps` | 记录的操作，不是 diff | 语言无关 |
| `[Commits]` | git 输出解析 | 事实 | 语言无关 |
| `[Tracked Commands]` | 用户配置的命令名匹配 | 事实 | 语言无关 |

两点补充：

- **`[User Preferences]` 与 AGENTS.md 重复。** Pi 每轮注入 system prompt/AGENTS.md，压缩只动消息不动系统提示；把偏好再抄进摘要，是既冗余又会过期的副本。偏好与约束的正确归宿是 AGENTS.md 或状态插件自己的持久文件。
- **`[Outstanding Context]` 比 `[Session Goal]` 更危险。** 它读取的只是本轮窗口的最后 20 块（`outstandingBlocks: blocks`），却以"未解决"的名义呈现；旧错误不会残留，新错误可能只是暂时输出。读者会把它当成当前状态。

## 5. 职责划分：LLM-free 压缩器与状态插件

### 5.1 一句话契约

> **压缩器只描述"发生过什么"和"原文在哪"；"现在要做什么、做到哪一步"由 /GOAL、/plan 一类状态插件在每一轮自己供给。** 状态插件管 now，压缩器管 then，`vcc_recall` 是两者之间的桥。

这条契约同时约束两边：

- **压缩器不做**：写状态指针行、读 /plan 文件、识别 /goal 或 `/goal` 类名字、把插件状态复制进摘要、出现 done/verified/success 字样、为任何 customType 写特殊代码。
- **状态插件不依赖**：不依赖摘要内容、不依赖 tail 一定保留自己、不把状态只存在某次工具结果里（压缩后与只读文本一样会丢）、在 pi-vcc 被禁用或换成 Pi core 压缩时仍要能工作。

### 5.2 五种"非自愿接触"（现存，且已被代码确认）

1. **注入内容会进摘要。** `before-compact.ts` 的注释与实现表明：`custom_message` 经 `convertToLlm` 转成 user 内容后才 `normalize`。每轮注入的目标文本会作为 `[user]` 块进入 brief，反复注入反复占用 user 角色 40% 配额；而最新副本本来就在 tail 里活着，摘要是冗余副本。
2. **`custom_message` 不占 `#N`。** `global-indices.ts` 的 `isCountedMessageEntry` 只数 `type === "message"`。同一段目标文本，用 custom_message 注入时在摘要里没有 `(#N)`（无法 recall 回原文），用 user 角色注入时占 `#N`。这是一个不对称。
3. **`keep:N` 只数 `role === "user"`。** `buildOwnCut` 的 `userIndices` 与 `keptUserTurns` 都按 role 过滤。若 /GOAL 在 EOF 后以 user 角色注入，`keep:1` 的 tail 起点会落在这条注入上，用户上一条真实请求被压缩掉，统计仍显示 `kept 1/1 turns`。改用 `custom_message + triggerTurn` 注入可避免计入用户轮。
4. **重复注入污染召回。** query 每页 5 条，同文反复命中会挤掉相关条目，`touched` 也会重复。可确定性修正（精确去重），但会改返回文本，需版本化。
5. **/plan 的写文件可能不进 `[Files And Changes]`。** `extract/files.ts` 的 `FILE_WRITE_TOOLS` 是固定名单；自定义写工具只能靠宿主 `fileOps` 兜底。事实层面漏记，不影响 /plan 自身（它重读文件）。

另外，`// goal:` 这个 codemode 注解仍只是"脚本声称要做什么"的导航提示；既然状态插件才是权威，就不应让注解向状态方向演化。

### 5.3 唯一官方接触点：配置，而不是代码

`skipCustomTypes`（`src/core/settings.ts`）只在摘要输入前过滤，文档明确说明它**不影响**切点选择、token 校准、`firstKeptEntryId` 与 kept-user-turn 计数。因此：

- 每轮注入的状态若不想进摘要，用户把它加进 `skipCustomTypes` 即可，压缩器无需认识该插件。
- README 用一个不带插件名的例子说明（"per-turn injected state, e.g. a goal loop"），避免把 pi-vcc 绑定到具体插件名。
- 状态插件若要"触发 turn 又不被当成用户轮"，应使用 `custom_message + triggerTurn`；若要能被 recall，则应使用普通 user 消息（占 `#N`）。二者取舍由插件作者决定，压缩器不替它选。

## 6. 多轮压缩后如何让 agent 知道还能召回早期记录

### 6.1 现状诊断（三个具体缺口）

1. **折叠标记会整体丢范围。** `allocateTextRole` 在折叠最老连续前缀时维护 `allNumeric`：只要被折叠的候选里有一条 `sourceIndex` 不是数字，标记就退化为 `[N older user messages omitted]`，不再带 `#a..#b`。`custom_message` 注入的条目不占 `#N`，正好能触发这一点。范围提示一旦消失，就没有第二种表达补上。
2. **legacy 路径的省略标记从来不带 `#N`。** `capBrief`（`format.ts`）与 `capBriefToLineBudget`（`summarize.ts`）在 120 行上限处写 `...(N earlier lines omitted)`。第二次压缩后第一次的正文被挤出，只剩这句无指向的省略语——这正是"第二次压缩后不再提示第一次之前内容"的典型形态。
3. **标记建议的动作不可执行。** `formatTextOmissionMarker` 生成 `scan saved history #a..#b`，但 `scan` 必须带 query；按范围读原文的调用是 `range:[a,b]`。照抄会得到参数错误。

补充：新路径本身**没有忘记**。`buildBriefHistory` 取的是分支上 `firstKeptEntryId` 之前的全部消息（含第一次压缩之前），`compileWithEffectiveHistory` 直接把 `buildBriefCandidates(historyBlocks)` 交给分配器，不经过 `selectRankedBriefBlocks` 的 `maxBlocks` 裁剪。问题不在"看不到旧内容"，而在"看不出来还有多少旧内容"。

### 6.2 根因：摘要是选集，没人声明它是不是封面

现有提示全是**局部**的：某条被截断 → 有标记；某个角色被折叠 → 有标记；全局只有文末一句固定 note。agent 真正要判断的是**全局问题**："我看到的最早一条之前还有没有记录？"局部标记答不了，文末 note 也不答，且它在最后——0.1.4 现场复核已指出警示来得太晚。

一旦局部标记失效（6.1 的第 1、2 条），摘要就出现**静默缺口**，而静默缺口与"本来就没有更早内容"无法区分。

### 6.3 0.2.0 设计：覆盖率是一等公民

**A. 顶部一行覆盖声明**（沿用 H4 的前置位置；纯算术、零语义）：

```text
[History] saved #2–#214; brief covers #2–#180; #181–#214 live. vcc_recall range:[2,180]
```

约 95 字符，进入 `reservedChars`。同时回答三件事：有没有更早的、摘要到哪、用什么调用去取。数据已经现成：`briefHistory.sourceIndices` 给 min/max，`firstKeptEntryId` 给 live 起点，`globalIndexById` 给最大索引。

**B. 分区不变式 + 测试**（比任何提示语可靠）：

```text
有效历史的所有 #N ⊆ 正文渲染的 #N ∪ 折叠标记的区间 ∪ live 区间 ∪ 显式声明的不可重建区间
```

补集非空时必须渲染 `[gap #a..#b; recall range:[a,b]]`，不允许静默。用三连压缩 fixture 直接断言 `gapCount === 0`；建议把 `coverage:{from,to,liveFrom,total}` 与 `gapCount` 落进 `details`（H5 的 `briefBudget` 扩展），审计只做计数、不含正文。

**C. 范围提示要容错、要可执行**：

- `allNumeric` 不成立时不要丢掉整个范围，退化为"已引用条目的 min..max + 无引用条目数"，例如 `[6 older user messages omitted; recall range:[3,47]; 1 without #N]`。
- 标记文本统一为真实调用：`recall range:[3,47]`；单条继续用 `(#N)`（`read`/`expand` 已验证可用）。
- `limitedReason: "edited-checkpoint"` 目前只有裸的 `history limited by edited checkpoint; use recall`；应带上被跳过的区间（`prefix #2–#60 not rebuilt; recall range:[2,60]`），否则它只是"有东西丢了"的模糊告警。

**D. legacy 路径二选一**（需明确决定）：

- 保守：不动。AGENTS 要求非 codemode 与上游一致，则承认该路径在多次压缩后仍有静默缺口。
- 推荐：在 `...(N earlier lines omitted)` 后补上被丢弃行里 `(#N)` 的 min/max。只改一处标记文本，可测、不泄漏正文；但属于对外接口变更，需在 CHANGELOG 与测试中明确记为有意变更。

**E. 文案净成本可接近零**：删掉 `HISTORICAL_NOTE` 中的 Session Goal 子句（随章节删除），文末 note 收敛为"scan 与 read 的区别"，把"有没有更早记录"交给顶部覆盖行。提示从"每轮相同的废话"变成"每轮不同的具体数字"，才不会被忽略。

### 6.4 为什么这样在多轮压缩下成立

- 新路径不依赖上一份摘要的正文，覆盖率每轮从分支重算，第 10 次压缩与第 2 次同样准确；不会出现 legacy 那种"摘要里套摘要"的衰减。
- 前提是不把旧摘要正文重新合并进来（0.2.0 保持现状即可），也不从 `previousSummary` 复活已删除章节。
- live 区间必须一起写：tail 未压缩、随时可读；否则 agent 会把"摘要没写"误当成"没发生"。

### 6.5 反模式

- **无条件打印固定提醒**（"history exists, use recall"）会退化成和当前 note 一样的背景噪音；覆盖行必须是具体数字。
- **让标记承担多种含义**（同时表示"被截断""被折叠""不可重建"）会让 agent 无法判断该读哪一段；三种缺口应各有明确措辞。

## 7. 0.2.0 拟定范围

| 做 | 不做 |
|---|---|
| 删除新路径的 `[Session Goal]`/`[Outstanding Context]`/`[User Preferences]`（或至少先删 goal） | 不写状态指针行、不读 /plan 文件、不识别插件名 |
| 加一行覆盖声明，计入 `reservedChars`、**不参与 `headerCap` 裁剪** | 不新增用户开关、不引入 LLM 摘要或语义分类器 |
| 分区不变式 + `gapCount`/`coverage` 落库 + 三连压缩测试 | 不做 exitCode 解析、不宣布成功、不声称完成 |
| 标记文本改为可执行调用（`range:[a,b]`/`(#N)`） | 不断言"当前 HEAD/版本/状态"、不用正则删除旧状态 |
| `limitedReason` 带上被跳过的区间 | 不提高总预算、不改 1100–2000 的上限与 40/30/30 规则 |
| legacy 省略标记补 `#N`（二选一，见 6.3-D） | 不为测试保留一套旧分配器 |

一点实现细节：覆盖行若放进 20% header，最窄预算下会被 `trimHeaderToBudget` 从尾部整行丢弃——正好在最需要它的时候消失。因此它应与 note 同属固定成本（`reservedChars`），顺序为：覆盖行 → H4 来源提示 → 各章节 → 正文 → note。

## 8. 验收矩阵（0.2.0）

| 用例 | 断言 |
|---|---|
| 连续 3 次压缩 | 覆盖行 `from` 始终是有效历史最早条目；`liveFrom` 随 tail 变化；`gapCount === 0` |
| 折叠段含 1 条无 `#N` 条目 | 仍输出范围（或"1 without #N"），不静默 |
| 折叠段跨第一次压缩边界 | 范围连续（一个 `#a..#b`），不出现两个互不相连的区间 |
| edited-checkpoint | 声明被跳过的区间，而不是只说 "limited" |
| legacy 两次压缩 | 若采用 6.3-D 推荐：省略标记含 `#a..#b`；否则文档明确说明该路径无范围提示 |
| 标记中的每个建议调用 | 用真实参数解析器跑一遍，必须能原样执行成功 |
| 极窄预算 | 覆盖行仍完整出现，或显式说明被省略；不允许被 header 裁剪吞掉 |
| 0.1.4→新版→新版迁移 | 旧 `[Session Goal]` 不复活；`HISTORICAL_NOTE` 只出现一次且为新措辞 |
| 纯非 codemode 会话 | 输出与 0.1.4 逐字相同（除非 legacy 标记变更被明确批准） |
| 围栏（前置项） | 围栏行数为偶；`[user]`/`[assistant]`/note/覆盖行都在围栏外 |

另需重跑：H1 的 §8.1 合成基线。删章节会让 `reservedChars` 回落、正文变大，旧收益数字与新版不可比。

## 9. 未验证事项与风险

- **未运行任何测试**：本文的覆盖行、分区不变式、`gapCount` 都只是设计，未验证成本、未验证在 `charsPerToken = 2/4/6` 下的表现。
- **覆盖口径需要定义**：`system` 条目占 `#N` 但不渲染；`custom` 不占 `#N`；`filterNoise` 会丢弃噪声块。若以"全部保存消息"作分母，`gapCount` 会长期非零并变成噪音。建议以"有效历史消息"（`briefHistory.messages` 的索引范围）为分母，并在文档里写清。
- **header 顺序风险**：H4 来源提示 + 覆盖行都在顶部，合计约 200 字符；窄预算下会挤压 `[Files And Changes]`。需要一次字符扫描确认两者的收益仍为正。
- **legacy 标记变更**会与 AGENTS 的"非 codemode 与上游一致"条款冲突，必须作为显式例外记录，否则后续维护者会把它当回归修掉。
- **删除章节的连带影响**：`dedupPreferencesAgainstGoals`、goal 的 8 行 CAP、`scripts/audit-sessions.ts` 的 goal 正则、`tests/support/report.ts` 的 `SECTION_HEADERS` 都要同步清理；漏掉任一处会留下"测试通过但行为未变"的假象。

## 10. 对现有规则与文档的影响

- `AGENTS.md`：`HISTORICAL_NOTE` 的 395 单元说明需随措辞改动更新；"`[Session Goal]` 是压缩摘录"一条改为"新路径不渲染该节"；新增覆盖行与分区不变式；若改 legacy 标记，需写明例外。
- `README.md`：章节表删三行；"`[Session Goal]` 是摘录"段落替换为"摘要不含当前目标/状态"；`skipCustomTypes` 增加"每轮注入状态"的非插件名示例。
- `CHANGELOG.md`：先记 `[Unreleased]`，按"删除语义章节 / 覆盖声明 / 标记可执行 / legacy 标记"分条。
- `tests/`：`brief-history.test.ts` 的 `headerNames`、`compile.test.ts`、`format.test.ts`、`report.test.ts`、`rank.test.ts` 的 note pin、`before-compact-hook.test.ts` 的 `details.sections` 断言。

## 11. 文件地图（本次涉及的符号）

| 位置 | 作用 |
|---|---|
| `src/extract/goals.ts` | `extractGoals`/`isSubstantiveGoal`/`TASK_RE`/`SCOPE_CHANGE_RE` |
| `src/core/build-sections.ts` | `extractOutstandingContext`、章节装配 |
| `src/extract/preferences.ts` | `PREF_PATTERNS`、`dedupPreferencesAgainstGoals` |
| `src/core/summarize.ts` | `compileWithEffectiveHistory`、`mergeHeaderParts`、`mergeHeaderSection`、`sectionLineCounts`、`capBriefToLineBudget` |
| `src/core/brief.ts` | `excerptText`、`attachRef`、`formatTextOmissionMarker`、`scanSuffix`、`renderTextCandidate` |
| `src/core/rank.ts` | `allocateTextRole`（`allNumeric`）、`allocateToolRole`、`allocateBriefBudget` |
| `src/core/brief-history.ts` | `buildBriefHistory`、`briefHistoryHasCodemode` |
| `src/core/global-indices.ts` | `isCountedMessageEntry`（`#N` 计数规则） |
| `src/core/format.ts` | `capBrief`、`trimHeaderToBudget`、`HISTORICAL_NOTE`、`HEADER_NAMES` |
| `src/hooks/before-compact.ts` | `buildOwnCut`（`keep:N` 计数）、`skipCustomTypes` 过滤点、`briefBudgetChars` |
| `src/core/settings.ts` | `skipCustomTypes` 语义（只影响摘要输入） |
| `src/extract/files.ts` | `FILE_WRITE_TOOLS` 固定名单 |

## 12. 待决策项

1. 是否批准 0.1.5 计划 §5 的冻结 golden 差异契约（这是 H1/H2/H3 的启动前置）。
2. `[Session Goal]`：删除（方案 A）还是保留"原文锚点"（方案 B）。
3. 语义章节删三个，还是只删 `[Session Goal]`（决定 `Outstanding Context` 是否继续以状态口吻出现）。
4. legacy 省略标记是否补 `#N`（收益明确，但打破"与上游一致"的既有条款）。
5. 覆盖行放固定成本区（推荐）还是放进 20% header（会被裁剪）。