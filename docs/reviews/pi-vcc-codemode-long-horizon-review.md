# pi-vcc codemode 长程任务审阅：可寻回性、工作记录与目标保持

- 日期：2026-10-25
- 审阅对象：[pi-vcc-codemode-patch.md](../patches/pi-vcc-codemode-patch.md)、本机已安装的 `@sting8k/pi-vcc` 0.10.2 补丁，以及 [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc) 上游源码。
- 目标：判断现有补丁是否正常，并从“codemode 长程任务反复压缩后仍能续跑、寻回历史、保留工作记录和当前目标”的角度审查改进提案。
- 审阅方式：源码核对、现有检查复跑、冻结会话复算，以及临时目录中的最小反例探测。未修改原补丁、上游源码或本机安装包。

> 归档说明（2026-10-26）：本文件从仓库根目录移入 `docs/reviews/`。正文中指向 `pi-vcc-codemode-patch/` 和 `sting8kpi-vcc/` 的链接属于当时的本地工作副本，不随仓库提供；补丁说明已归档为 [`../patches/pi-vcc-codemode-patch.md`](../patches/pi-vcc-codemode-patch.md)。

## 1. 总结论

**现有补丁通过当前 smoke checks，但“长程任务历史完整可寻回”尚不通过。**

它已经有效解决三个可见性问题：codemode 脚本不再只显示为 `code`，嵌套工具调用能够显示和参与搜索，简报中的 codemode 成本也比 v1.1 明显下降。这些改动有保留价值。

但当前方案仍缺少两个基础保证：

1. **完整取回保证**：长脚本、较早的嵌套调用、参数后部的关键词以及部分搜索结果，仍可能被截断或无法通过现有 API 取到。
2. **当前任务状态保证**：目标、约束、决定、未完成事项、产物和验证状态仍主要依赖启发式简报，没有独立、可更新、可恢复的结构化状态。

因此，下一步不应优先继续压缩脚本头或向简报塞入更多结果摘要，而应调整为：

> **先做到“任何保留下来的历史都能分页取回”，再建立“独立于压缩简报的任务状态”，最后用真实续跑行为调节预算。**

第一性原理上，固定大小的上下文不可能让无限增长的历史全部同时可见。能够保证的是：

- 历史在上下文之外持久存在；
- 模型知道历史存在以及去哪里查；
- 每一处截断都有可继续读取的入口；
- 当前目标与未完成事项不会被静默淘汰；
- 已解决事项不会仅因“永不删除”而反复复活；
- 找回历史所花的 token 和时间仍然可接受。

## 2. 验证范围与限制

### 2.1 已实际复跑

在 `<patch-workdir>` 下运行 `bash tools/checks.sh`，结果如下：

| 检查 | 结果 |
|---|---|
| 4 个改动文件的 `node --check` | 4/4 通过 |
| 本机安装包的补丁状态 | 4 个目标文件均为已补丁状态 |
| 合成夹具 | 8/8 通过 |
| 冻结真实会话 A/B | 248 个渲染条目一致；脚本显示 0 → 114；嵌套记录 0 → 107（官方另有 3 个文本假阳性） |
| 嵌套记录额外换行 | 0 |
| 与备份相比的实际变更文件 | 仅预期的 4 个文件 |

冻结快照上的成本数字也可以复现：ranked brief 中 codemode 占用为 14.8%，非 codemode 字符比官方少 5.2%。这证明 **v1.2 相对 v1.1 的精简方向有效**，但不自动证明长程任务续跑效果更好。

### 2.2 未能完成的验证

- 上游 `bun run typecheck` 与 `bun test` 未能执行，因为当前环境没有 `bun`；这属于未验证，不是测试失败。
- 本次没有重新启动 PI、执行 `/reload` 或触发一次新的真实压缩，因此实时 UI 路径没有重新复验。
- 工作区只有压缩后的 [pi-vcc-codemode-patch.md](../patches/pi-vcc-codemode-patch.md)，没有压缩前版本可供逐字比较。因此可以检查文档内部一致性和命令可执行性，但不能证明文档压缩本身毫无内容损失。

## 3. 新发现的功能与测量问题

### 3.1 `expand` 和搜索仍不能完整寻回长 codemode 脚本

补丁把脚本预览限制为列表 300 字符、expand 1500 字符，见 [tool-args.ts:25](pi-vcc-codemode-patch/patch/files/src/core/tool-args.ts#L25)。`renderMessage(..., full=true)` 仍然调用这个受限摘要，见 [render-entries.ts:18](pi-vcc-codemode-patch/patch/files/src/core/render-entries.ts#L18)。

本次用一个超过 2400 字符、末尾带唯一标记的脚本做最小探测，结果为：

- `expand` 中没有末尾标记；
- expand 渲染结果只有 1544 字符；
- 搜索该末尾标记也是 0 命中，因为工具参数搜索只索引前 2000 字符。

上游已经明确说明参数索引是 head-only，2000 字符之后不保证可搜索，见 [search-entries.ts:254](sting8kpi-vcc/src/core/search-entries.ts#L254)。补丁又给 nested 文本增加了独立的 2000 字符头部预算，见 [search-fulltext.replace.txt:7](pi-vcc-codemode-patch/patch/edits/search-fulltext.replace.txt#L7)。

**结论：原始 JSONL 仍在，不等于模型能通过 `vcc_recall` 取回。** 当前“可寻回达标”的表述过强。

### 3.2 嵌套调用也存在不可继续读取的截断

nested 列表只显示最后 12 条，expand 只显示最后 32 条，整行还分别受 1500/6000 字符限制，见 [render-entries.ts:36](pi-vcc-codemode-patch/patch/files/src/core/render-entries.ts#L36)。

当一项 codemode 结果有 40 条嵌套调用时，expand 仍只给最后 32 条，却没有 nested 专用分页或按调用 ID 取回的入口。“expand for more”只能从未展开视图进入展开视图，并不意味着展开后能够取全。

此外，上游 `mode:"touched"` 只扫描 assistant 消息中的直接 `toolCall`，见 [search-entries.ts:328](sting8kpi-vcc/src/core/search-entries.ts#L328)；`#N:path` 也只从该消息的直接 toolCall 中找文件内容，见 [drill-down.ts:243](sting8kpi-vcc/src/core/drill-down.ts#L243)。因此 codemode 的 nested write/edit 仍不会完整进入 touched 和文件 drill-down。

### 3.3 codemode 中的 recall 自匹配过滤不完整

补丁只过滤 `nestedCalls` 中名为 `vcc_recall` 的项，但外层 codemode 脚本仍包含查询字符串，聚合 stdout 也可能包含 recall 输出。

本次用真实结构的合成消息探测：

```js
const r = await tools.vcc_recall({ query: "zz-self-recall-token" });
```

搜索该唯一词仍命中两条：

- 外层 assistant codemode 脚本；
- codemode toolResult 的聚合输出。

现有第 6 项夹具没有覆盖这个结构：它的外层脚本并不包含 nested `vcc_recall` 的查询词，所以无法发现该问题。

### 3.4 `apply.mjs --verify` 不是只读验证

[apply.mjs:77](pi-vcc-codemode-patch/patch/apply.mjs#L77) 对整文件替换目标只判断 `!check`，没有排除 `verifyMode`。因此在官方未补丁树上运行 `--verify`，也会进入写入分支。

本次在官方备份的临时副本中复测，实际结果为：

- `tool-args.ts` 与 `render-entries.ts` 被写入；
- 另外三个精准替换锚点报告 `TODO`；
- 进程以失败状态退出，但目录已经处于部分补丁状态。

当前已补丁树上运行 `--verify` 不会产生写入，所以本次主检查不受影响；但这个命令不能作为通用的只读验证器。应让它在任何不匹配时只报告并失败，绝不能修改文件。

[checks.sh:5](pi-vcc-codemode-patch/tools/checks.sh#L5) 还只有 `set -u`，没有 `-e` 和 `pipefail`，且中间命令经过管道过滤。即使前面某项失败，脚本也可能继续并最终以最后一个命令的状态退出。它目前适合打印报告，不适合直接充当 CI 通过门禁。

### 3.5 “同一压缩窗口”测量并不使用真实窗口

[measure-brief-cost.mjs:183](pi-vcc-codemode-patch/tools/measure-brief-cost.mjs#L183) 直接用“上一次 compaction 后到下 compaction 前”的消息作为重渲染窗口。

上游实际逻辑从上次压缩的 `firstKeptEntryId` 开始收集 live messages，再按本次 cut 截断，见 [before-compact.ts:312](sting8kpi-vcc/src/hooks/before-compact.ts#L312) 和 [before-compact.ts:648](sting8kpi-vcc/src/hooks/before-compact.ts#L648)。实际编译还会合并 `previousSummary`，见 [before-compact.ts:829](sting8kpi-vcc/src/hooks/before-compact.ts#L829)。

冻结快照最近一次压缩的实测对照为：

| 项目 | 数值 |
|---|---:|
| 测量脚本选取的消息数 | 98 |
| compaction details 记录的实际 `sourceMessageCount` | 85 |
| 按 `firstKeptEntryId` 重建的窗口 | 85 |
| `previousSummaryUsed` | true |

所以不同渲染器在这 98 条消息上的 A/B 仍有相对比较价值，但不能称为真实压缩的严格同窗口复现，也不能直接据此解释实际存下简报的构成。

该脚本打印的 compaction `#230` 还是 **JSONL 原始条目下标**，而 recall 的 `#N` 是只对 `type:"message"` 计数的会话级消息序号，见 [global-indices.ts:16](sting8kpi-vcc/src/core/global-indices.ts#L16)。两种编号应使用不同名称，避免生成无法解析或指向错误消息的引用。

### 3.6 当前“丢失度”和“结果真值”指标名过强

[loss-audit.mjs:27](pi-vcc-codemode-patch/tools/loss-audit.mjs#L27) 的实际口径是：

- 把每条 user 消息的第一条较长行当作一个“目标”；
- 截取最多 100 字符；
- 检查该字符串是否逐字出现在简报中。

这不是目标保留率。它会把“选项 C”“已经克隆到本地”等过程消息也当成必须永久保留的目标，同时无法识别换行、改写、结构化状态或仍保留在 keep-tail 中的目标。更准确的名称应是 **用户消息首行字面出现率**。

同一脚本的文件统计来自正则提取和 basename 聚合，不等于“当前活跃工作集”；工具结果保留 0 是直接写死的输出，不是独立测量；引用收集后也没有真正逐一解析，不能单独支撑“ref 可解析率 100%”的实测结论。

[result-truth-audit.mjs:6](pi-vcc-codemode-patch/tools/result-truth-audit.mjs#L6) 检查的是：

- 顶层 `isError` 未标记；
- 输出任意位置出现错误样文本；
- 首行是否为 `Script completed`。

这能证明 **首行不足以代表内部执行结果**，但不能证明这些任务都失败，更不能推出“任何结果摘要都有 17% 假成功”。命令可能本来就是为了复现错误，错误文本也可能来自读取的文件或搜索内容；`Script completed` 只说明脚本宿主执行结束，不等于业务任务成功。

建议把它改名为“错误信号共现审计”，并分别标注：

1. 顶层工具状态；
2. nested call 状态；
3. 文本中的错误样信号；
4. 经人工或测试真值标注的任务结果。

## 4. 对上游设计思想的再认识

### 4.1 上游做对了什么

上游的核心不是“让一份摘要装下全部历史”，而是：

- 压缩过程不调用 LLM，以确定性提取避免摘要生成的不确定性；
- 用结构化 section 保存高价值事实，用 ranked brief 在预算内选择信息；
- 用稳定的全会话 `#N` 把简报和原始历史连接起来；
- recall 默认沿当前 lineage，必要时显式扩大到 edited/retried branches；
- 重复压缩时合并既有 section，而不是让模型重新自由发挥；
- 工具结果正文有意不进入 compact brief，源码和测试都明确固定了这一行为，见 [brief.ts:317](sting8kpi-vcc/src/core/brief.ts#L317) 与 [brief.test.ts:218](sting8kpi-vcc/tests/brief.test.ts#L218)。

这些设计值得保留。尤其是 **“简报是视图，原始会话用于追查”** 和 **“引用错误时宁可不发，也不能发错号”**，对长程任务非常重要。

不过，源码只明确说明工具结果“有意省略”，测试也只证明这是固定行为。把省略的正式理由进一步归结为“防止幻觉”属于与上游价值观一致的解释，不是源码中明确写出的完整理由。

### 4.2 上游优化目标与本次目标不同

上游 benchmark 主要衡量文件、命令、提交和工具调用等事实的 weighted recall、density、precision 与大小，见 [benchmarks/README.md:49](sting8kpi-vcc/benchmarks/README.md#L49)。它并没有直接衡量：

- 10～20 次压缩后能否继续完成原任务；
- 当前目标和约束是否仍然正确；
- 已解决 blocker 是否被错误复活；
- 是否重复执行已经完成的写入或命令；
- 为找回历史额外消耗多少 recall token。

因此，“fact density 更高”是有用指标，但不能替代本次需要的 **长程续跑成功率**。

### 4.3 中文会话还有额外的提取风险

上游后续目标/范围变化识别主要依赖英文正则，见 [goals.ts:5](sting8kpi-vcc/src/extract/goals.ts#L5)。首条用户消息可以被提取，但后续中文“改做……”“不要……”“接下来……”不一定被识别为新任务或 scope change。

Outstanding Context 也使用英文 blocker 正则，并要求句子以英文大写、代码标识符或引号等开头，见 [build-sections.ts:21](sting8kpi-vcc/src/core/build-sections.ts#L21)。中文 blocker 很容易不进入这一节。

这意味着不能把“增加更多英文启发式规则”当作目标保持的根本方案。中文 scope change、约束和 blocker 必须进入回归测试；更可靠的方向是显式状态更新，而不是猜测每句话的语义。

## 5. 对 §11 改进提案的具体修正

### 5.1 “两个产物”应改成“三层记忆”

当前提案把会话 JSONL 视为完整事实来源，把简报视为索引。建议改为：

| 层 | 回答的问题 | 应保存的内容 |
|---|---|---|
| 历史与产物层 | 当时发生了什么 | 原始会话、完整工具记录、外部日志、文件与哈希、稳定引用 |
| 当前任务状态层 | 现在什么仍然成立 | 当前目标、active constraints、决定、open/done/blocked/superseded 任务、下一步、验证状态 |
| 简报与目录层 | 此刻该看什么、去哪里查 | 当前状态的有界投影、coverage map、检索键、ref/cursor |

原始会话是“已持久化记录的来源”，不应笼统称为绝对完整：补丁本身已经处理 `nestedCalls.complete === false`，说明宿主记录也可能不完整。重要产物应落在文件或日志中，会话里保存路径、哈希和来源引用。

### 5.2 不要用“所有用户消息首行台账”代替当前目标

所有用户消息都值得留在历史里，但不是所有消息都应永久占用当前上下文。目标也会变化，因此需要区分：

- 历史上的用户请求：追加保存，可按 users/epoch 查询；
- 当前目标：可被后续明确指令替换；
- 仍然有效的约束：独立记录，不能因为目标替换而隐式消失；
- 已完成或已废弃目标：保留历史，但退出 active projection。

建议的状态记录至少包含：

```text
id / kind / text / status / sourceRefs / lineage / updatedEpoch / supersededBy
```

目标原文应尽量逐字来自用户；模型声明的决定、任务和下一步要标明来源，不能把模型推断伪装成用户事实。压缩时不需要额外调用 LLM，只需确定性地投影已经显式写入的状态。

### 5.3 `vcc_pin` 不能“单调、永不淘汰”地进入固定简报

“永不淘汰”和“固定 8k/120 行”不能同时作用于无限增长的内容。正确做法是：

- pin 的历史记录可追加、可审计；
- active pin 必须有界，并可显式取消、完成或被新版本取代；
- 超出 active 预算时保存数量、状态版本和检索入口，而不是静默丢弃；
- 合并守卫检查 active record ID、状态和来源是否连续，不要求上一份简报的所有字节逐字保留。

“所有台账行字节级回注”会阻止纠正错误、替换过期目标，也会与行预算冲突。应改为 **带生命周期的结构化记录 + 状态版本/哈希校验**。

### 5.4 工作集不能只从 head 改成 LRU

`keep:"tail" + touchOnDup:true` 能缓解“最早文件永久占位”，但“最近使用”仍不等于“对当前任务重要”。大量近期读取可能挤掉一个较早修改、但仍决定任务成败的文件。

而且这不是只改 [summarize.ts:149](sting8kpi-vcc/src/core/summarize.ts#L149) 的两三行：fresh section 在合并前已经按 head 截到每类 10 个，见 [build-sections.ts:48](sting8kpi-vcc/src/core/build-sections.ts#L48)。只改 merge 无法恢复 fresh 阶段已经溢出的路径。

建议区分：

- Modified/Created：带 sourceRef、最后操作和可用的哈希，优先级高于普通 Read；
- Read：按近期和当前目标相关性淘汰；
- 显式 active 文件：由任务状态引用，不参与普通 Read 的 LRU；
- 溢出项：进入 map/touched，不以 `(+N more)` 结束所有可寻回性。

### 5.5 失败计数和原文片段必须区分事实层级

“24 failed results”如果混合了 `isError`、nested status 和文本正则，就不再是纯粹的计数事实。建议接口和输出分别使用：

- `harnessErrors`：顶层 `isError === true`；
- `nestedErrors`：nested call 明确记录的非 ok 状态；
- `errorSignals`：正文命中错误样模式的启发式结果。

`errors:true` 可以统一入口，但必须分组显示，不应给一个无条件的“失败总数”。

逐字片段也不是“不可能误导”：`No such file or directory` 可能来自一次预期失败、旧 epoch，或后来已经修复的问题。原文引用只能保证“这句话确实出现过”，不能保证“它描述当前状态”。片段必须带 ref、epoch 和来源类型，不得自动附带“仍未解决”的含义。

§11.5 的“错误签名保留率 ≥60%”也与默认不把结果正文放入简报的 T0/T1 策略冲突。应改成：

- 权威错误记录可取回率；
- 错误信号标注准确率；
- 失败入口与 ref 可解析率；
- 未标注来源的状态断言数量应为 0。

### 5.6 omitted marker、map 和 episode 必须基于真实 provenance

不能简单把 `...(N earlier lines omitted)` 改成一个猜测的 `#a-#b`：

- 被删的是格式化后的文本行，不一定每行都有 sourceIndex；
- user block 在 `filterNoise` 中重建时会丢失 sourceIndex，见 [filter-noise.ts:26](sting8kpi-vcc/src/core/filter-noise.ts#L26)；
- 分支和 context edit 下，保留的消息不一定构成一个简单连续区间；
- 当前 fresh ranked 选择会先挑块，再与 previous brief 合并。

应先保留块到消息 ID/#N 的 provenance，再输出准确的首尾 ref、离散 ref 或 epoch 入口。map/episode 应使用真实 compaction ID、`firstKeptEntryId`、selected IDs、lineage 和 previousSummary 关系，而不是 JSONL 下标加一。

### 5.7 codemode 适配要复用统一的“执行事件”视图

脚本正则统计的是 **源码中出现的 `tools.name(...)` 次数**，不一定是实际执行次数：条件分支可能未执行，动态调用可能漏掉，注释或字符串也可能误命中。因此简报不应把它写成“实际跑了哪些工具”。

建议把直接 toolCall 和 nestedCalls 规范化成同一种执行事件，再让以下功能共同消费：

- commits 与 tracked commands；
- touched 与 `#N:path`；
- 简报中的实际执行工具名和明确状态；
- map 的文件、工具和错误统计；
- 搜索索引与 drill-down。

对 tracked commands，读取 nested bash 参数比较直接。对 commits，nested 记录未必包含 git stdout，可能只能恢复提交命令和消息，不能承诺同样恢复 hash；需要输出关联或明确标为未知。

嵌套执行元数据可以替代部分脚本头，而不是在脚本头之上继续叠加成本。`CODE_BRIEF_CHARS` 80 → 48 可以作为后续实验，不应先于完整取回和任务状态。

## 6. 建议的实施顺序

### P0：先修验证器和审计口径

1. 修复 `apply.mjs --verify` 的写入行为，并增加“官方树、已补丁树、部分补丁树、漂移树”测试。
2. 让 `checks.sh` 在任何关键检查失败时可靠返回非零。
3. 用 `firstKeptEntryId`、selected IDs 和 previousSummary 重建真实压缩输入。
4. 区分 JSONL entry index、compaction ID 和 recall `#N`。
5. 将“目标保留率”“结果真值”“17% 假成功”等表述改为实际测量口径。
6. 给 `result-truth-audit.mjs` 增加正常参数解析；当前脚本直接读取 `process.argv[2]`，文档中的 `--session <jsonl>` 形式不适用。

### P1：补齐“每一处截断都能继续读”的召回 API

1. 为 code、完整 args、nested calls 增加通用 drill-down 和 offset/limit/cursor。
2. expand 可以继续默认有界，但所有截断必须给出总大小和下一页入口。
3. 为 nested call 提供按稳定 call ID 取回的入口。
4. 让 touched、`#N:path`、commits、tracked commands 支持 nested 执行事件。
5. 搜索要么覆盖完整参数，要么提供明确的 deep 模式及索引覆盖说明；不能只在头部静默停止。
6. 搜索输出仍可按 5 条分页，但分页应能访问全部匹配，或提供 epoch/tool/role/path 等过滤来缩小集合。当前 50 条 cap 会明确提示截断，但后续页仍只能访问 cap 内结果。
7. 增加真实 codemode → nested `vcc_recall` 的自匹配回归测试，覆盖外层脚本和聚合输出。

### P2：建立独立的 Current Task State

建议提供显式状态工具或命令，而不是只依靠压缩时猜测。状态中至少包括：

| 状态 | 内容 |
|---|---|
| Goal | 当前目标、来源用户消息、是否已被新目标取代 |
| Constraints | 仍有效的限制、偏好、禁止事项 |
| Decisions | 已确认方案及其 sourceRef，可被新决定 supersede |
| Tasks | open/done/blocked/superseded、下一步和 blocker |
| Artifacts | 文件或日志路径、操作、哈希、来源 ref |
| Verification | 实际命令、原始结果 ref、验证时间、被验证产物版本 |

状态更新应在工作发生时进行，并在压缩前落盘；写操作需要原子性，且与 session/lineage 关联。当前投影有界，历史事件追加保存，能够从事件和归档重建。

为避免重复工作，不能只记“以前运行过测试”或“以前写过文件”。如果文件哈希后来变化，旧测试结果应自动视为过期，而不是永久显示为当前成功。

### P3：加入真实 coverage map 和分层错误入口

map 至少展示：

- epoch/compaction ID；
- 真实输入范围和 lineage；
- previousSummary 的继承关系；
- 消息、工具、文件和明确错误状态数量；
- 索引或渲染不完整的标记；
- 可继续查询的 ref/cursor。

episode 负责按真实 epoch 重取，errors 负责按权威状态和启发式信号分层查询，users 负责查看历史用户请求；它们都不能替代 Current Task State。

### P4：最后再做预算和展示优化

当前 ranked 字符预算主要作用于 fresh blocks，之后还会合并 previous brief 和结构化 sections，见 [rank.ts:219](sting8kpi-vcc/src/core/rank.ts#L219) 与 [summarize.ts:243](sting8kpi-vcc/src/core/summarize.ts#L243)。新增状态区之前，应先明确最终总预算如何分配，而不是假定 fresh budget 就是整份简报的严格总上限。

建议顺序为：先保留 active state 和 coverage，再把剩余预算分给 ranked transcript。脚本头长度、nested 行数、是否按工具签名折叠，都通过总 token 成本与续跑效果共同调整。

## 7. 新的验收标准

不要再只用“简报里出现了多少字符串”判断成功。至少需要以下四类测试。

### 7.1 状态完整性

- 1、5、10、20 次压缩后，active goal/constraints/tasks 的 ID 和内容保持正确；
- scope change 后旧目标可检索但不冒充当前目标；
- done/superseded 不错误复活，open/blocked 不静默消失；
- 中文目标、中文约束和中文 blocker 有专门用例；
- active state 超预算时有明确溢出入口，而非静默截断。

### 7.2 召回完整性

- 超过 1500/2000 字符的脚本，首尾内容都能通过分页取回；
- 超过 32 条 nested calls 时，每一条都能按页或 ID 取回；
- nested write/edit 能进入 touched 和文件 drill-down；
- 超过 50 个搜索命中时，目标命中仍有可达路径；
- active lineage 与 `scope:"all"` 不串分支；
- 简报中的每个 ref 都实际调用解析器验证，而不是只收集数字。

### 7.3 结果与状态真实性

- 顶层错误、nested 错误、文本错误信号分别统计；
- `Script completed` 不被当作任务成功；
- 预期失败、已修复失败和读取到的错误文本不会自动变成当前 blocker；
- 所有“当前成功/已修复/仍阻塞”的结论都有来源和验证时间。

### 7.4 真实续跑行为与成本

构造包含长脚本、nested 写入、重复压缩、scope change、分支回退和已解决 blocker 的任务，让 PI 在压缩后继续执行，衡量：

- 正确下一步比例；
- 重复写入、重复命令和重复调查率；
- 目标偏离和约束遗漏率；
- 找回指定历史所需调用次数；
- 简报 token + recall token 的总成本；
- 最终任务完成率，而不仅是简报字符数。

## 8. 原补丁文档需要同步清理的地方

1. §4 仍写夹具 6 项、§6.5 仍写 7 项，实际均为 8 项。
2. §6.2 第 5 项和 §7 压缩测试清单仍期待旧的 `* codemode "code: …"`，与 v1.2 的 `* codemode -> … | code: …` 不一致。
3. §6.4、§6.5、§6.6 的顺序和交叉引用需要整理。
4. “recall 列表视图 3.1 倍”统计的是全部渲染条目的总字符，不等于一次实际 recall 返回的 token；query、range、recent 分别只返回 5、20、25 条。应改成按实际操作测量输出成本。
5. “同窗口重渲染”需要按真实 cut 和 previousSummary 修正。
6. “目标保留率”“结果真值”“17% 假成功”“ref 可解析率已实测 100%”需要改名或补充真正的验证。
7. §11.5 的错误签名目标与 T0/T1 策略冲突，应替换。
8. `result-truth-audit.mjs --session <jsonl>` 的文档命令与脚本实际参数解析不一致；当前应传位置参数，或先修脚本。

## 9. 最终建议

保留当前 v1.2 的可见性改进，但把项目目标从“让简报包含更多 codemode 信息”升级为：

> **持久历史可完整取回，当前状态可明确更新，简报只负责呈现当前工作集和导航。**

如果只能先做两件事，建议依次选择：

1. **补齐全量 drill-down、搜索覆盖和 nested 文件操作支持**，消除“归档存在但 API 取不到”的硬缺口；
2. **建立有生命周期、带来源引用、可重建的 Current Task State**，替代“所有用户消息首行 + 永不淘汰 pin + 字节级合并守卫”的组合。

这两项完成后，再用多次真实压缩下的续跑任务评估 `CODE_BRIEF_CHARS`、结果片段和折叠策略。否则，继续优化简报外观很可能只是让模型更自信地看到一个仍然不完整、也可能已过期的世界。
