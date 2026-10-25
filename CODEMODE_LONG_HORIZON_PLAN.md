# pi-vcc × Pi codemode 长程任务改进计划

- 日期：2026-10-25
- 文档状态：实施计划；P0 已完成（2026-10-25），P1 尚未开始。P2 及以后暂缓，待 P1 的 codemode 收益验证通过后再决定。
- 上游：`sting8k/pi-vcc` v0.10.2，基线提交 `733e872bf39be627b1b9eb387f964256c77d3cb3`。
- 本机环境：Bun 1.4.4；Pi CLI 1.4.0。P0 在 locked 0.85.1 与 Pi 1.4.0 上完成；0.85.1 是 P0 历史记录，不再是目标支持范围。
- 支持范围（2026-10-25 决定）：本 fork 目标为 Pi `>=1.0.0 <2.0.0`。codemode 实际首次出现在 `@earendil-works/pi-codemode` 0.99.0；选择 1.0.0 作为 1.x 稳定下限。peer range、lockfile、CI、AGENTS 和 fixture 的迁移在 P1 影响讨论中单独确认，尚未实施。
- 行为口径（2026-10-25 决定）：两层门控。无 codemode 记录的会话保持上游 v0.10.2 行为；codemode 历史按消息内容只读渲染；当前激活只控制提示、意图指令和状态写入。详见 §3.4。
- 本地依据：`pi-vcc-codemode-patch.md`、`pi-vcc-codemode-long-horizon-review.md`、已复跑的补丁检查、冻结会话反例，以及上述讨论。真实会话内容不进入本仓库；可提交的回归证据使用合成夹具。

## 0. 结论与总路线

目标不是让压缩简报装下更多历史，而是让 LLM 在多次压缩后仍能回答并正确行动：

1. 当前要做什么，哪些约束仍然有效？
2. 已经做过什么，哪些结果已经过期？
3. 需要追查时，历史是否真实存在、可知其存在并能继续取回？
4. 所见结论是原始事实、模型声明，还是启发式推测？
5. 为恢复这些信息付出的 token、调用次数和时间是否合理？

采用以下分工：

> **主模型生成少量“声明意图”和显式当前状态；codemode 提供原生持久化、恢复和分支隔离；pi-vcc 不调用 LLM，只负责确定性提取、校验、简报投影、执行事实整理和召回。**

这里的“简报投影”是指：完整数据保存在上下文外，简报只按预算显示当前需要的一小部分及检索入口。

本计划只改变 codemode 激活或含 codemode 记录的会话。无 codemode 记录的会话保持上游 pi-vcc 行为；debug 快照路径修复是明确例外。P2-P5 不是当前承诺，必须等 P1 在真实 codemode 会话上通过收益验证。

不实现一个试图用正则理解所有自然语言的完整任务状态机。首版 Current Task State 只保留少量显式字段，语义正确性由真实任务测试衡量，不能由插件自行宣称保证。

## 1. 目标与非目标

### 1.1 目标

以下目标只对 codemode 激活或含 codemode 记录的会话承诺；无 codemode 记录的会话保持上游行为。

- **G1：目标与约束可续接。** 压缩、恢复和分支切换后，已显式记录的当前目标与约束仍可见，旧目标不冒充当前目标。
- **G2：工作事实可追查。** 能区分“打算执行”“实际执行”“验证结果”，减少重复调查、重复写入和重复命令。
- **G3：已持久化内容可完整取回。** 列表和 expand 可以有界，但每个被截断的已持久化字段都必须有分页、按 ID 取回或明确的覆盖缺口说明。
- **G4：证据层级清楚。** 原始记录、模型声明和算法推测不混写；`Script completed` 不等于业务成功。
- **G5：真实任务效果更好。** 最终以任务完成率、正确下一步、约束遗漏、重复工作和总 token 成本评价，而不是只看简报字符数。

### 1.2 非目标

- 不在 pi-vcc 压缩链路中增加 LLM 调用。
- 不把全部工具结果正文塞回简报。
- 不做“所有用户消息永久 pin”“无限状态进入固定预算”或字节级旧简报回注。
- 不承诺算法能自动理解任意中文目标、完成状态、冲突和替代关系。
- 不改变现有 `#N` 的定义：`type:"message"` 条目按会话文件顺序计数。
- 不把临时文件路径或已被宿主截断的字段称为可完整恢复。
- 不在无 codemode 记录的会话中改变上游行为；P0 的 debug 快照路径修复是明确例外。
- 不在 P1 收益验证前实施 P2-P5。
- 不在第一阶段同时重写通用 summarizer、全部 recall API 和任务状态系统。

## 2. 第一性原理约束

| 原理 | 对设计的直接约束 |
|---|---|
| 上下文有限，历史可无限增长 | 简报只能是当前状态和导航的有界视图，不能承担完整历史存储。 |
| “已保存”“能取回”“曾经发生”是三个不同概念 | 已保存的数据要可分页取回；宿主未保存的数据不能靠 recall 事后还原，只能在执行时补记录或明确标记缺口。 |
| 当前状态会变化，历史事实不应被改写 | 历史条目追加保存；当前状态允许整体替换、纠正和清空，旧状态退出 active 简报。 |
| 自然语言语义无法由确定性规则完全恢复 | 目标和下一步可以由主模型显式声明，但必须标为声明；插件不猜测完成、修复或替代关系。 |
| 工具宿主成功不等于任务成功 | 分开记录脚本状态、nested call 状态、结构化工具结果、文本错误信号和真正的验证事实。 |
| 找不到的信息等同于不存在，但错误信息可能比缺失更危险 | 每个省略都要给入口或覆盖说明；引用无法确认时宁可不发，也不能发错。 |
| 上下文优化最终服务于行为 | 简报更小或字段更多都不是最终成功，必须通过真实续跑任务验收。 |

### 2.1 三类数据，分别处理

| 类别 | 例子 | 可以承诺什么 |
|---|---|---|
| 原始已持久化记录 | assistant 中的完整脚本参数、会话消息、store custom entries、已保存的 nested 元数据 | 可以建立确定性索引、分页和分支隔离；完整性只覆盖实际保存的字节。 |
| 模型声明 | 首行 `// goal:` 意图注释、store 中的当前目标/下一步、模型写下的验证结论 | 可以保留和投影，但必须标为声明，不能仅凭存在就视为事实。 |
| 算法派生信号 | 静态工具名提取、错误样正则、文件工作集统计 | 只能作为导航或启发式信号，必须说明口径，不能改名为实际执行次数或结果真值。 |

## 3. 已确认事实与尚未证明的假设

### 3.1 上游和既有补丁事实

- 上游采用确定性提取、结构化 sections、ranked brief、previousSummary 合并和原始会话 recall，不在压缩时调用 LLM。
- 真实压缩窗口与 `firstKeptEntryId`、本次 cut 和 previousSummary 有关，不能用“两个 compaction 条目之间的消息”替代。
- 工具结果正文默认不进入 compact brief；新设计不应以恢复全部结果正文为方向。
- 既有 v1.2 补丁在冻结快照的检查中，使 codemode 调用显示脚本正文从 0/116 变为 114/116，nested 结果记录从 0/113 变为 107/113；现有合成检查为 8/8 通过。
- 这 8/8 是运行时夹具，不是类型检查：补丁的 `search-entries.ts` 使用 `NestedToolCalls` 却没有导入。0.85.1 的 `pi-ai` 没有这个类型；新的支持范围 `>=1.0.0` 已包含该类型。P1 只需正确导入并以 `bun run typecheck` 为准，不再为旧宿主做结构兼容。
- 同一冻结样本的 ranked brief 测量中，v1.2 的 codemode 占用为 14.8%，v1.1 为 39.5%；这支持“精简脚本摘要”的方向，但不证明长程任务成功率提高。
- 已复现的缺口包括：expand 的脚本仍有 1500 字符上限、参数搜索只覆盖头部、nested expand 只显示最后 32 条、真实 codemode recall 存在外层脚本和聚合输出自匹配、nested write/edit 未完整进入 touched 和文件 drill-down。
- 静态正则统计 `tools.name(...)` 只是源码形态计数，不等于实际执行次数。
- 既有“目标保留率”“17% 假成功”等测量口径不能作为本计划的真值指标；新测试必须分别测量字面出现、错误信号和人工/测试标注的任务结果。

### 3.2 Pi codemode 事实（以 1.4.0 核对）

版本下限：`@earendil-works/pi-codemode` 从 0.99.0 开始发布，Pi 0.99.0 的扩展目录已经包含 codemode。0.99.0 已具备 `NestedToolCalls`、`context_edit`、可变 `systemPromptOptions`、`getActiveTools` / `getExposure`；本 fork 选择 `>=1.0.0` 作为 1.x 稳定下限。下表的行为细节仍以 1.4.0 文档和运行代码核对，P1 实施时在最低版本 1.0.0 上复验。

| 宿主能力 | 已确认行为 | 设计后果 |
|---|---|---|
| 原始 JavaScript | 脚本不是 JSON 或 markdown，可以使用 `//` 注释。 | 首行 `// goal:` 意图注释可直接提取。 |
| `@options` | 若存在，必须位于第一行；放到其他行会在执行前失败。 | `// goal:` 意图注释默认在首行；有 options 时在第二行。 |
| `store/load` | 成功脚本可写入 JSON；写入追加为 `codemode-store` custom entry；恢复会话后仍在，并按当前分支重放。 | 可复用原生持久化和 lineage，不自建状态文件。 |
| store 容量 | 单值最多 262144 个 JSON 字符，全部值最多 1048576。 | 只适合小型当前状态和游标，不适合完整历史或大结果。 |
| store 提交条件 | 只有脚本成功才保留写入；脚本失败前已经发生的工具副作用不会回滚。 | store 不能成为唯一工作台账。 |
| 结构化工具结果 | bash 返回 `exit_code`、`truncated` 等；MCP 返回 `isError` 和 `structuredContent`。 | 可以减少对错误文本正则的依赖，但业务结论仍需明确验证。 |
| nested 记录 | nested 调用经过工具管线；结果消息保存的是有界记录，类型声明中的 args/error 是展示用截断字段。 | 可以整理实际调用名和状态；不能承诺事后恢复完整 nested 参数。 |
| 输出截断 | 脚本输出保留首尾，完整文本可能只写入临时文件；文档建议大数据通过工具写文件。 | 重要全文应写入稳定产物，并在状态中保存路径/引用。 |
| 系统提示词接口 | `before_agent_start` 提供可变的 `systemPromptOptions`；active tools 可识别，tool guidelines 可追加。 | 只在 codemode 激活时追加规则，不替换完整系统提示词。 |
| 压缩输入 | pi-vcc 的 `session_before_compact` 已提供当前 `branchEntries`。 | 可在现有 hook 中重放白名单 store 键并投影，无需改会话编号。 |

### 3.3 仍需实验验证的假设

- 主模型是否能足够稳定地遵循 `// goal:` 意图注释和状态更新约定。
- 英文 `// goal:` 标记在中英文会话中的遵循率和解析稳定性。
- 意图注释是否比 80 字符代码头更能提高正确下一步比例，同时降低简报成本。
- store 中的状态在真实 pi-vcc 压缩、会话恢复和分支回退后，是否能被正确重建并显示。
- 当前状态简报能否在不显著增加 token 的情况下减少目标偏离和重复工作。
- 中文目标文本在现有搜索实现中的检索效果；显示价值和搜索价值需要分别测量。

以上均未通过前，不写成“已经保证”。

### 3.4 支持范围与两层门控（2026-10-25 决定）

支持范围：

- 本 fork 目标为 Pi `>=1.0.0 <2.0.0`。0.85.1 的兼容代码、CI 行和测试跳过不再属于目标范围；P0 的双宿主记录保留为历史。
- codemode 实际首次出现在 0.99.0。0.99.0 已具备本计划需要的类型和接口；选择 1.0.0 是为了以 1.x 稳定线作为下限，不是因为 1.0.0 才引入 codemode。
- 支持范围迁移涉及 peer range、`bun.lock`、CI、`AGENTS.md` 和 P0 fixture，属于 P0-P1 有影响的部分，实施前单独讨论，不在本次文档提交中改动。

两层门控：

| 层 | 依据 | 行为 |
|---|---|---|
| 提示与写入 | codemode 当前在 active tools 中 | 追加 §4.1 guideline；要求 `// goal:`；允许 P2 状态更新 |
| 历史只读渲染 | 消息内容是 `codemode` 或带 `nestedCalls` | 保持脚本、nested、意图和搜索可见；不因当前关闭 codemode 而退回不可读的上游摘要 |
| 其他历史/简报路径 | 无 codemode 记录 | 简报、recall 和搜索保持上游 v0.10.2；debug 快照路径修复是明确例外 |

一致性契约：

- **无 codemode 记录**：简报、recall 和搜索与上游 v0.10.2 一致；如果 codemode 激活，只有系统提示 guideline 不同。
- **有 codemode 记录但当前未激活**：只读渲染/搜索/简报仍按 codemode 内容处理；不注入 fork guideline，不写新状态。
- **codemode 激活**：`mode:"on"` 和 `mode:"only"` 都启用 fork 提示、意图、状态和执行事实；`mode:"on"` 下的普通直接工具调用仍走上游路径。
- **关闭 codemode 不重写历史**：旧简报和旧消息保持原样；`pi-vcc.current-task` 等 store 状态在重新激活后恢复可见。
- 该契约把“与上游一致”定义为“没有 codemode 记录的会话”，而不是“codemode 当前未激活的所有会话”。如果要求后者，关闭 codemode 后旧历史会退回上游的不可读摘要，本计划不采用。

## 4. 目标架构

§3.4 的两层门控是本节实现前提：提示、意图指令和状态写入按当前激活判断；已有 codemode 记录的渲染、搜索和简报按消息内容判断；无 codemode 记录时走上游路径。

```text
主模型
  ├─ 脚本中的声明意图（`// goal:` 注释）
  └─ 必要时更新一个白名单 current-task store 键
                 │
                 ▼
Pi codemode / Session
  ├─ 实际工具执行与有界 nested 记录
  ├─ codemode-store：持久化、恢复、分支隔离
  └─ 稳定工作区产物：需要完整保留的大输出
                 │
                 ▼
pi-vcc（无 LLM 调用）
  ├─ 确定性解析和 schema/大小校验
  ├─ 当前分支 store 重放与有界简报投影
  ├─ 直接/nested 执行事件的统一只读视图
  ├─ 已持久化内容的搜索、分页和 drill-down
  └─ 来源、覆盖缺口和证据层级标注
```

### 4.1 声明意图：先做低成本、高收益的元数据入口

codemode 激活时追加两条工具规则。系统提示词本身是英文；固定标记统一为 `// goal:`（英文小写、半角冒号），只让标记后的内容跟随用户语言。定稿文案：

```text
- Use `vcc_recall` to recover compacted or earlier session context before concluding it is unavailable; if it is not listed, call `tools.vcc_recall` from a codemode script.
- Start each codemode script with a one-line `// goal: <intended outcome>` in the same language as the user's request, describing intent rather than success; if you use `// @options:`, keep it first and put the intent on line 2.
```

追加条件：codemode 位于 active tools，且 `vcc_recall` 仍可调用；如果 `vcc_recall` 被禁用，只保留意图规则。两条规则在 `mode:"on"`（直接工具声明仍可见）和 `mode:"only"`（直接工具声明隐藏、由 codemode 目录列出）下都必须可见；后者尤其不能依赖 `vcc_recall` 自己的工具段，因为目录预算可能把它整段省略。

实现要求：

- 只检查首行，或 `@options` 后的第二行；使用固定前缀，不做自由文本语义解析。
- 固定标记不随语言切换；解析器可容忍 `goal` 大小写和冒号后的空白，但文案只展示 `// goal:` 一种规范形式。
- 提取结果命名为 `declaredIntent`，不命名为 `goalFact` 或 `taskResult`。
- 简报优先显示意图，例如 `* codemode goal: 验证长脚本可按页取回 (#N)`；意图正文仍使用用户语言。
- 没有合法注释时回退到现有短代码摘要；首阶段保留 `CODE_BRIEF_CHARS=80`，避免同时改变多个变量。提示词只要求 `one-line`，具体截断由插件端完成。
- 意图应替换部分代码头成本，而不是在代码头之上新增一层长文本。
- 缺失、重复、过期或与实际代码不一致都属于必须测试的情况；插件不根据注释判定完成。
- P1 开始时把 `tests/codemode-fixtures.ts` 和 baseline 断言中的旧 `// 目标：` 示例改为 `// goal:`。P0 基线只固定上游可见性，不依赖标记语义；当前旧文本不参与解析。

### 4.2 最小 Current Task State：一个键、整体替换、明确标注

首个垂直切片只使用一个白名单键，例如 `pi-vcc.current-task`，避免多键合并和部分更新：

```json
{
  "version": 1,
  "goal": "当前目标，尽量保留用户原意",
  "constraints": ["仍然有效的约束"],
  "next": "模型声明的下一步",
  "sourceRefs": ["#123", "#140"]
}
```

首版语义：

- 单个 JSON 对象最后写入生效；纠正目标时写入完整新对象，删除状态使用宿主支持的删除方式。
- `goal` 和 `constraints` 只在用户明确设定或改变时更新；`next` 始终是模型声明，不是用户事实。
- `sourceRefs` 只填已经确认的 recall 引用；没有引用就留空，不能编造。
- 首版不加入自动 done/superseded 推断、复杂任务 DAG、自动 blocker 解决或验证成功推断。
- pi-vcc 从当前 `branchEntries` 顺序重放 `codemode-store` 的 set/delete，只读取白名单键。
- 对字段类型、数量和投影长度设上限；溢出必须显示计数和检索/查看入口，不能静默截断。
- 不投影其他扩展或用户任意 store 内容，避免把敏感数据或大对象带入上下文。
- 状态缺失或格式错误时跳过该状态区并给出诊断，不阻断正常压缩。
- 状态区只在 codemode 激活且存在白名单键时出现；无 codemode 记录或未激活的会话不增加该区段。
- 没有 `codemode-store` 能力的宿主不启用此功能，保持现有摘要路径。

保证边界：只能保证“已显式写入且通过校验的状态”被持久化、按分支恢复和有界投影；不能保证模型总会写入，也不能保证其语义永远正确。

### 4.3 执行事实与稳定产物

建立统一的只读执行事件视图，供 codemode 的 touched、drill-down、commits、tracked commands 和简报共同使用。普通直接工具路径保持上游，不因统一视图而改变渲染或统计：

```text
parentCallId / callId / toolName / argsCoverage / status /
error / durationMs / sourceRef
```

规则：

- 直接 toolCall 与 nestedCalls 分开适配，再统一消费；不能用静态脚本正则代替实际执行。
- `argsCoverage` 明确区分完整参数和宿主已截断参数。
- nested bash 的 `exit_code`、MCP 的 `isError`、nested status 和文本错误信号分别保留，不能合并成一个无条件“失败数”。
- `Script completed` 只表示脚本宿主结束；脚本失败前的写入仍要留在工作记录中。
- 大型输出、测试日志和需要长期追查的结果写入稳定工作区文件；会话和状态只保存路径、必要哈希与来源引用。
- 如后续确需保存宿主未持久化的完整 nested 参数，只能在执行时通过工具钩子或显式产物补录。该能力单独评估容量和敏感信息风险，不默认记录全部参数与结果。

### 4.4 简报：当前状态优先，结果正文仍默认省略

建议的优先级：

1. 已显式记录的当前目标、约束和声明下一步；
2. 当前活跃文件、blocker 和验证入口；
3. 覆盖范围、缺口及 ref/cursor；
4. 剩余预算内的 ranked transcript。

要求：

- 当前状态区只在 codemode 激活且存在白名单状态时出现；标明 `declared` 和来源，不能把模型声明渲染成已验证事实。
- 状态超预算时保留状态版本、数量和取回入口，不能简单尾部截断后假装完整。
- 工具结果正文仍默认不进入简报；增加的是结构化执行事实、验证引用和召回入口。
- 省略区间只有在 provenance 真实可追踪时才输出 `#N` 范围，不能从格式化后的行号猜测。

### 4.5 recall：完整性的边界必须明确

以下改动只针对 codemode 记录或显式 opt-in；无 codemode 记录的默认 recall / search 行为保持上游。需要覆盖：

- 脚本正文按 offset/limit 或 cursor 分页，长脚本末尾不再不可达。
- nested calls 按页和稳定 call ID 取回；同时说明参数是否为宿主截断副本。
- 搜索覆盖完整已保存参数，或提供显式 deep 模式和覆盖声明；不能只搜索头部却称为全文搜索。
- query 的 50 个命中硬上限需要可继续访问，或提供 tool/role/path/epoch 等过滤以到达目标命中。
- touched、`#N:path`、commits 和 tracked commands 支持 nested 执行事件；无法恢复的 commit hash 标为未知。
- 修复 codemode 内调用 `vcc_recall` 时，外层脚本和聚合输出造成的自匹配。
- `codemode-store` custom entries 不占用现有消息 `#N`；当前状态通过 store 重放获得，来源引用仍指向可解析的消息 ref。

## 5. 分阶段实施与阶段门

每个阶段独立可合并；阶段门未通过，不扩大下一阶段范围。

### P0：基线、测试口径与真实压缩重放

工作：

1. 按仓库约定运行 `bun install --frozen-lockfile --ignore-scripts`、`bun run typecheck` 和 `bun test`。本机 Bun 1.4.4 可用；locked 0.85.1 与 Pi 1.4.0 均已实际运行，不能把未运行写成通过。
2. 固定上游 v0.10.2 基线，并建立当前 Pi 1.4.0 的 codemode 测试层；CI 矩阵从 `locked + 1.1.0` 扩为 `locked + 1.1.0 + 1.4.0`，旧宿主继续跑原有测试（P0 历史；P1 迁移支持范围后改为 1.0 / 1.4）。
3. 新增合成 codemode 夹具：`@options`、中文目标、长脚本、超过 32 条 nested、脚本失败但已有副作用、store set/delete、分支和多次压缩。
4. 真实压缩重放使用 `firstKeptEntryId`、实际 cut 和 previousSummary；区分 JSONL 下标、compaction ID 与 recall `#N`。
5. 不直接搬入本机补丁的 `--verify` 写入行为和宽松退出码；fork 中直接修改源码并使用正常测试门禁。

阶段门：上游测试无回归；夹具可重复；测量脚本能够解释输入窗口和指标口径。

### P0 执行记录（2026-10-25）

- **运行环境**：Bun 1.4.4；locked 0.85.1 与 Pi 1.4.0 均可用。计划原先“本机没有 Bun”的描述已过时。
- **调试路径**：`debug` 快照从硬编码 `/tmp/pi-vcc-debug.json` 改为 OS 临时目录；源码与测试共享 `DEBUG_SNAPSHOT_PATH`。这消除了 Windows 非系统盘上的 8 个环境性测试失败。
- **CI**：矩阵加入 Pi 1.4.0；非 locked 行同时安装同版本 `pi-codemode`。
- **合成夹具**：`tests/codemode-fixtures.ts` + `tests/codemode-baseline.test.ts`（6 项）覆盖 `@options`、中文目标、长脚本、40 条 nested、失败脚本但保留副作用、store set/delete，以及 store 条目不占 `#N` 的数组/流式两条路径。
- **回放测试**：`tests/context-edits.test.ts` 新增 context_edit + previousSummary + codemode-store 回放；断言 `firstKeptEntryId`、`sourceMessageCount`、`previousSummaryUsed`、`#N` 与 compaction ID / custom entry 的区别。
- **结果**：0.85.1 为 450 pass / 6 skip / 0 fail；1.4.0 为 456 pass / 0 fail；两套宿主 `bun run typecheck` 均通过。
- **未做**：真实会话的测量脚本仍在 `research/` 本地步骤中，不进入仓库；P1 实现尚未开始。

### P1：现有可见性改进 + 声明意图

工作：

1. 将既有 v1.2 的脚本显示、nested 记录、搜索文本和精简简报有测试地迁入 fork。v1.2 的通用 unknown-tool fallback 只用于 codemode / nested 上下文，不改变非 codemode 输出。
2. 在 `before_agent_start` 中仅当 codemode 位于 active tools 且 `vcc_recall` 可调用时追加 §4.1 的两条 guideline；在 Pi `>=1.0` 上修改 `systemPromptOptions.promptGuidelines`，不替换完整 system prompt，不为 0.85.1 做 fallback。
3. 实现首行/第二行 `// goal:` 意图解析，合法时替代代码头，非法时回退。
4. 按 §3.4 两层门控实现：无 codemode 记录的会话保持上游；含 codemode 历史的只读渲染按消息内容；`mode:"on"` 的普通直接工具调用保持上游。
5. 首阶段不调整其他预算常量，不新增 `vcc_recall` 参数或工具。

支持范围迁移（peer range、`bun.lock`、CI、`AGENTS.md`、P0 fixture、旧宿主兼容代码和自动续跑 fallback 的删除）属于 P0-P1 有影响的部分，实施前单独讨论；本次文档提交只记录目标口径，不改这些文件。

阶段门：

- 无 options、有 options、无注释、多行注释、中文意图、错误前缀和 `// goal:` 大小写/空白容错均有测试。
- `@options` 仍在有效位置，提示不会诱导生成不可执行脚本。
- 冻结夹具中意图可见，缺失意图时行为与 v1.2 一致。
- codemode 激活/未激活、`vcc_recall` 启用/禁用四种组合下 guideline 的出现符合预期；`mode:"on"` 与 `mode:"only"` 均可见。
- 无 codemode 记录的会话与上游 v0.10.2 黄金对照一致（debug 快照除外）。
- 有 codemode 记录但当前未激活时，脚本/nested/意图仍可读，且不注入 guideline、不写新状态。
- `mode:"on"` 的直接工具调用与上游一致；只有 codemode 消息及其 nested 记录进入 fork 渲染。
- 支持范围迁移完成后，最低版本 1.0.0 与当前 1.4.0 都通过 `typecheck` 和测试。

### P1 收益验证门（进入 P2 前）

在固定 codemode 任务上对比上游 v0.10.2 与 P1，至少覆盖：长脚本可读性、nested 状态可追性、意图可读性、压缩后正确下一步、重复调查/写入、目标偏离和总 token。

- 至少出现一项稳定、可复现的可见收益，且没有严重回归；否则停止 P2-P5，保留 P1 或回退。
- 验证使用真实 Pi 1.4.0 会话（本地 `research/`），支持范围迁移后在 1.0 复验；提交仓库只放合成夹具和汇总指标，不提交会话内容。
- 该收益门不能由简报字符数单独证明，也不能用单次 LLM 成功下结论。

> **实施暂停点（2026-10-25）**：P2-P5 暂不实施。只有 P1 收益验证门通过后，才讨论下一阶段。

### P2：原生 store 的最小状态垂直切片（暂缓）

工作：

1. 约定单键 schema 和简洁的模型更新规则；更新指令只在 codemode 激活时注入。
2. 在现有压缩 hook 中重放当前分支的白名单 store 数据，校验并有界投影；无 codemode 记录或未激活时不增加简报区段。
3. 在 Pi 1.4.0 中实测：压缩、会话恢复、分支回退、状态替换和删除；最低版本迁移完成后在 1.0 复验。
4. 测试缺失状态、畸形 JSON 值、超大状态、其他 store 键和 codemode 未激活时的降级。
5. 不扩展任务字段，直到最小闭环证明有实际收益。

阶段门：

- 1、5、10 次确定性压缩重放后，已写入的 active 状态不丢、不串分支；被替换状态不冒充当前状态。
- 真实 Pi 端到端确认 store 和 pi-vcc 简报均恢复正确，而不只是函数级 reducer 测试通过。
- 在固定续跑任务上，相比 P1 至少呈现“目标偏离或正确下一步改善”的一致趋势；否则保留实验状态，不继续堆叠状态字段。

### P3：已持久化内容的完整召回与统一执行事件（暂缓）

工作：

1. 为 codemode 的 code 和 nested 记录增加分页/ID drill-down，并在输出中标注覆盖范围。
2. 引入 codemode 直接/nested 执行事件的统一只读视图，让 touched、文件 drill-down、commits 和 tracked commands 共用；普通直接工具路径保持上游。
3. 修复 codemode 搜索的头部截断、query cap 和真实自匹配问题；非 codemode 默认搜索/recall 行为保持不变。
4. 对宿主已经截断的 nested 参数显示明确缺口，不伪造“完整恢复”。
5. 任何 `vcc_recall` schema/description 变化都必须保证无 codemode 记录的会话仍与上游一致；优先使用 codemode 专用入口或显式 opt-in，而不是改变默认工具清单。

阶段门：

- 超过 1500/2000 字符的脚本首尾均可通过公开 API 取回。
- 超过 32 条 nested 时，每条已保存记录均可按页或 ID 到达。
- nested write/edit 能进入 touched 和文件 drill-down；分支隔离保持不变。
- 超过 50 个搜索命中时，目标命中存在可达路径。
- 非 codemode 记录的默认简报、recall 和搜索与上游一致。
- 每个简报 ref 都实际调用解析器验证，而不是只统计 ref 字符串。

### P4：验证事实、稳定产物与必要的执行时补录（暂缓）

工作：

1. 将 codemode 的 harness 错误、nested 状态、结构化业务状态、文本错误信号和人工/测试真值分层。
2. 建立小型验证记录：实际命令、被验证产物版本、结果来源和验证时间；文件变化后旧验证标为过期。
3. 重要大输出写稳定文件，状态中只保存引用；临时文件不作为长期保证。
4. 只有在 P3 证明“宿主未保存的信息”确实阻碍任务时，才增加执行时补录；采用字段白名单、容量限制和敏感信息策略。
5. 只作用于 codemode 记录和状态；无 codemode 记录的会话保持上游行为。

阶段门：

- 预期失败、已修复失败、读取到的错误文本和真实失败不会混成当前 blocker。
- 脚本失败前已发生的写入仍出现在工作记录中。
- 文件变化后，旧测试不会被显示为当前有效验证。
- 默认配置不批量保存完整敏感参数或全部工具结果。

### P5：真实长程任务基准与最后的预算优化（暂缓）

工作：

1. 建立固定任务集：多步骤代码修改、长脚本调查、nested 写入、显式 scope change、中文约束、预期失败、分支回退和会话恢复。
2. 进行配置对照：上游、P1、P1+P2、P1+P2+P3/P4；使用相同模型、设置、任务初始状态和工具权限。
3. 确定性重放用于 1/5/10/20 次压缩的不变量测试；真实 LLM 任务重复运行并报告波动，不能用单次成功下结论。
4. 最后才实验 `CODE_BRIEF_CHARS`、nested 展示行数和折叠策略；优先测试“意图替代代码头”，而非继续叠加文本。

阶段门：真实任务效果有稳定改善，并且总成本可解释；否则回退只带来噪声或成本的功能。

## 6. 验收指标

### 6.1 确定性正确性门禁

这些是必须通过的测试，不用 LLM 概率结果替代：

- `#N` 计数与旧行为一致，重复 ID 继续 fail-closed。
- active lineage 与 `scope:"all"` 不串分支。
- 已保存状态在压缩、恢复和分支操作后正确；非白名单 store 不进入简报。
- 所有已持久化且声称支持完整取回的字段都能到达末尾。
- 未持久化或被宿主截断的内容有明确覆盖标记，不作完整性的虚假承诺。
- 无 codemode 记录的会话与上游 v0.10.2 黄金对照一致（debug 快照除外）。
- 有 codemode 记录但当前未激活时，历史仍按内容只读渲染；不注入 guideline、不写新状态。
- 无注释、无 store 和 codemode 未激活的路径均正常；`mode:"on"` 的普通直接工具调用保持上游。
- 同一会话与同一实现产生相同确定性简报；压缩链路没有 LLM 调用。

### 6.2 长程行为指标

- 最终任务完成率。
- 压缩后的正确下一步比例。
- 目标偏离率与约束遗漏率，包含中文用例。
- 重复调查、重复写入和重复命令率。
- 已解决 blocker 或旧目标错误复活率。
- 找回指定历史所需的调用次数和输出 token。
- 系统提示词开销 + brief token + recall token + 状态/产物读取 token 的总成本。
- 压缩延迟、召回延迟和失败率。

“用户消息首行字面出现率”“错误样文本数量”“简报中 ref 字符串数量”只能作为诊断指标，不能分别改名为目标保持率、任务失败率或 ref 可解析率。

### 6.3 P1 收益门（进入 P2 前）

- 可见性：长脚本、nested 记录和 `// goal:` 意图在 recall / brief 中实际可读，而不是只统计字符。
- 行为：压缩后的正确下一步、重复调查/写入、目标偏离是否有稳定改善。
- 成本：system prompt + brief + recall 的总 token 与上游对照，不能只优化简报大小。
- 至少一项稳定、可复现的可见收益，且无严重回归；否则不进入 P2。

## 7. 主要风险与护栏

| 风险 | 护栏 |
|---|---|
| 模型不写注释或状态 | 缺失时回退；把遵循率纳入实测，不把提示词当作保证。 |
| 注释或状态过时、与代码不一致 | 标为声明，保留来源；实际执行和验证走独立证据链。 |
| store 状态在脚本失败后缺失 | 工作记录不依赖 store；测试“有副作用但脚本失败”的夹具。 |
| 支持范围外的旧宿主 | 只承诺 Pi `>=1.0.0`；1.0 与当前 1.4 都跑 `typecheck` 和测试；不使用 1.4 独有 API 而不做探测。 |
| 两层门控泄漏到非 codemode 路径 | 独立 codemode 模块；共享函数只加 no-op 分支；非 codemode 黄金对照测试。 |
| 关闭 codemode 后旧历史退回不可读摘要 | 读路径按消息内容门控；只读渲染不写状态；关闭不重写旧简报。 |
| P1 没有可见收益 | §6.3 收益门；未通过就停止 P2-P5，保留 P1 或回退。 |
| recall 承诺超过实际持久化范围 | 输出 coverage；需要完整数据时在执行时显式保存，不做事后臆造。 |
| 状态或补录泄露敏感参数 | 只投影白名单键；默认不保存全部参数/结果；补录单独评估脱敏和容量。 |
| 简报再次膨胀 | 意图替换代码头；状态有界投影；同时计算 prompt、brief 和 recall 总成本。 |
| 方案重新膨胀为复杂状态机 | P2 只验证单键最小闭环；无行为收益就不增加字段和生命周期推断。 |

## 8. 预计涉及的代码边界

| 区域 | 计划改动 |
|---|---|
| `src/codemode/`（新增） | 集中 codemode 检测、两层门控、`// goal:` 解析、nested 渲染和简报格式化；共享文件只留条件调用。 |
| `index.ts` / `src/hooks/before-compact.ts` | 注册 codemode 提示；在当前分支读取白名单 store 并传入摘要投影；无 codemode 时保持上游路径。 |
| `src/core/tool-args.ts` / `render-entries.ts` / `brief.ts` | 脚本与意图显示、nested 渲染；只对 codemode 消息生效，通用 fallback 不扩散到非 codemode。 |
| `src/core/search-entries.ts` / `drill-down.ts` | codemode 搜索覆盖、自匹配处理、code/nested/文件 drill-down；默认路径不变。 |
| `src/core/recall-request.ts` / `recall-run.ts` / `format-recall.ts` | codemode 分页、cursor、过滤和覆盖说明；保持上游默认 schema/描述。 |
| `src/extract/` | 在实际执行事件视图建立后，适配 codemode 的 commits 与 tracked commands。 |
| `tests/` | 合成 codemode、store、分支、截断、失败副作用、两层门控、非 codemode 上游黄金对照和引用解析测试。 |
| `package.json` / `bun.lock` / CI / `AGENTS.md` | 支持范围迁移到 `>=1.0.0`；属于 P0-P1 影响项，实施前单独确认。 |
| `benchmarks/` | codemode 真实压缩重放与长程续跑任务；真实会话数据仍放在 git-ignored 的 `research/`。 |
| `README.md` / `CHANGELOG.md` | 只在功能实际实现并验证后更新用户文档和 Unreleased 记录。 |

新模块只在出现多个真实消费者时提取，例如统一执行事件视图；不预先搭建大型状态框架。

## 9. 当前决策与下一步

已决定（2026-10-25）：

- 支持范围收窄为 Pi `>=1.0.0 <2.0.0`；0.85.1 不再在目标范围内。
- 采用两层门控：提示与状态写入按当前激活，codemode 历史渲染按消息内容，其他路径保持上游。
- 意图固定标记改为英文 `// goal:`；意图正文仍跟随用户语言。
- P2-P5 暂缓，必须先通过 P1 收益验证门。

P0 已完成（见 §5 执行记录）。下一次实施只处理 **P1**：

1. 先单独讨论并确认 P0-P1 的影响项：peer range、`bun.lock`、CI、`AGENTS.md`、P0 fixture、旧宿主兼容代码/自动续跑 fallback 的删除和最低版本测试；确认后再改这些文件。
2. 把 v1.2 的 codemode 可见性改进以正常源码和测试迁入 fork；通用 fallback 只用于 codemode / nested。
3. 加入 `// goal:` 提示、首行/第二行解析和 `@options` 位置保护。
4. 用合成夹具验证两层门控、显示、搜索、成本和降级路径。
5. 在真实 codemode 会话上执行 §6.3 收益门；通过后才讨论 P2。

这样先得到一个小而可验证的改进，不会一开始就把召回、状态、产物和预算全部耦合在一起。

> 2026-10-25 更新：P0 已完成；P1 尚未开始。支持范围迁移和 P1 文件级改动需要单独确认，之后才进入实现。

## 10. 参考事实来源

- codemode 官方文档：<https://pi.dev/docs/latest/codemode>。
- 上游设计、recall 契约与配置：`README.md`。
- 仓库兼容和测试约定：`AGENTS.md`。
- 消息 `#N` 定义：`src/core/global-indices.ts`。
- 真实压缩窗口和 previousSummary：`src/hooks/before-compact.ts`。
- 现有工具参数、搜索和 drill-down 限制：`src/core/tool-args.ts`、`src/core/search-entries.ts`、`src/core/drill-down.ts`。
- Pi 1.4.0 本机随包 `docs/codemode.md`、`docs/extensions.md` 与 codemode 类型/运行代码；这些宿主文件不作为本 fork 的源码依赖复制进来。
- 版本事实：npm 包 `@earendil-works/pi-coding-agent` / `@earendil-works/pi-codemode` 0.99.0–1.4.0 的 tarball 与 `pi-ai` 类型（2026-10-25 核对）；codemode 首次出现在 0.99.0。
