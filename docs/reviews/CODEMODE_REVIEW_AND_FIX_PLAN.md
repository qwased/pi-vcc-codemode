# pi-vcc-codemode 0.1.1 评估复核与修正计划

- 日期：2026-10-26
- 对象：pi-vcc-codemode 0.1.1（仓库 HEAD `ae24f6b`，复核时工作区干净）
- 输入：用户真实反馈《pi-vcc-codemode 0.1.1 真实工作测试与行为核对报告》（同目录 `PI-VCC-CODEMODE-EVALUATION-REPORT.md`，2026-10-25，下称"评估报告"）
- 对照：上游 `@sting8k/pi-vcc` v0.10.2 源码（评估报告用 `git archive` 解包的副本，位于与仓库同级的评估目录 `.pi-eval/upstream`）；宿主 `@earendil-works/pi-coding-agent` 1.4.0（`bun.lock` 锁定版本）
- 状态：复核结论与修正计划。A–H 已实施，G3/I 未完成，实施状态见 [`../plans/CODEMODE_LONG_HORIZON_PLAN.md`](../plans/CODEMODE_LONG_HORIZON_PLAN.md) §11。本文件归档于 `docs/reviews/`。

> 归档说明（2026-10-26）：本文件从仓库根目录移入 `docs/reviews/`，正文保留起草时的判断与时点；文中引用的 `CODEMODE_LONG_HORIZON_PLAN.md` 现位于 `docs/plans/`。

> 引用约定
>
> - `路径:行号` 指本仓库 HEAD 中、或 `node_modules` 内宿主 1.4.0 dist 中已逐一核对过的位置；宿主文件以包名开头，例如 `pi-coding-agent/dist/core/system-prompt.js:65`。
> - 标注"评估报告实测"的数字来自评估报告，本文没有独立复测；标注"本文复现"的结果来自第 2.4 节的内存脚本。
> - 本文不引用任何会话内容，只使用汇总数字。

## 0. 摘要

**结论**

1. 评估报告的三项主要发现都属实，原因已在代码中定位：
   - `vcc_recall({ mode: "touched" })` 只看顶层工具调用，纯 codemode 会话永远返回空；
   - 简报每个 `[assistant]` 段只保留最后 8 条工具行（继承自上游），codemode 早期步骤的意图会被丢弃；而且在评估报告那次真实压缩中，丢弃与上下文压力无关；
   - 注入的两条规则自带 `- `，宿主渲染时再加一个，显示成 `- - `。
2. 评估报告有 3 处机制解释错误（Read 列表的来源、`firstKeptEntryId` 为空的原因、上游 8 行上限的调参依据），另有 5 处结论需要收窄或补充（成本对比依赖会话形状、README 第 275 行的问题性质、P2 修法的范围、"前 8 条不可达"、P0 是否改代码）。
3. 本文补充 5 项评估报告未覆盖的问题，其中两项影响较大：
   - 简报的 `#N` 引用覆盖相对上游回退（本文复现：17 次连续调用、调用之间没有正文时，上游简报保留 19 个引用，fork 只剩 10 个）；
   - 纯 codemode 会话的 `[Files And Changes]` 完全依赖宿主按自己切点计算的文件操作；pi-vcc 保留的尾部少于宿主时，中间一段的文件会漏列（代码推断，待复现）。
4. 评估报告 §8 的改进方向基本正确，但"改通用上限"会违反"无 codemode 记录的会话与上游一致"这一项目不变量；其 §8.4 中的两条成本标准与报告自身数据或继承的预算设计冲突，需要改写。

**修正计划一览**

| 编号 | 工作项 | 阶段 | 规模 | 是否改变 agent 读到的文本 | 依赖 |
|---|---|---|---|---|---|
| A | 去掉两条规则常量的 `- ` 前缀 | 0 | 很小 | 是（系统提示规则） | 无 |
| B | 文档口径修正（README、计划书） | 0 | 小 | 否 | 708/733 需作者确认 |
| C | codemode 段的可操作省略标记 | 1 | 小 | 是（简报） | 无 |
| D | 简报工具名去掉 `×N` 计数 | 1 | 很小 | 是（简报） | 无 |
| E | 压缩时补抽本段 nested 文件操作 | 1 | 小 | 是（摘要文件清单） | 无 |
| F | `touched` 与 `#N:path` 下钻支持 nestedCalls | 2 | 中 | 是（recall 输出、工具描述） | 无 |
| G | 真实路径测量（调试字段、回放脚本、真实续跑） | 3 | 中 | 否 | 无硬依赖 |
| H | codemode 简报行的字符额度 | 4 | 中 | 是（简报） | C、G |
| I | nested 记录中段可达（P3 分页） | 5 | 中 | 是（recall） | 计划书 P3 |

**建议的第一步**：作者核对 README 第 275 行中 708 与 733 的归属；随后用一个提交完成 A 和 B，再分别提交 C、D、E。

## 1. 依据与方法

### 1.1 依据

| 来源 | 版本 | 用途 |
|---|---|---|
| fork 源码 | HEAD `ae24f6b` | 被复核对象 |
| 上游源码 | v0.10.2 | 判断哪些行为继承自上游。逐文件 `diff` 结果：`src/core/brief.ts` 只多出 codemode 分支（`brief.ts:238-241`）；`src/core/rank.ts` 完全相同；`src/core/search-entries.ts` 只改了 `fullText` 的拼接（第 320-325 行，另加两行 import） |
| 宿主 dist | Pi 1.4.0 | 规则渲染、压缩准备、nested 记录上限、消息转换 |
| 评估报告 | 2026-10-25 | 真实会话的汇总数字 |
| `research/p1-bench/` | 本地，被 git 忽略 | 只有 5 个脚本、没有结果文件；只读取脚本逻辑 |

### 1.2 方法

- 只读复核：逐条打开评估报告引用的源码位置核对，再沿调用链检查上下游与宿主实现。
- 内存复现：用 `bun -e` 直接调用 fork 与上游的 `normalize`、`buildBriefSections`、`compileRanked`，不写任何文件（脚本见附录 B）。

### 1.3 未做的事

- 没有安装 Pi 1.0.0，因此 1.0.0 上的宿主行为都标为未验证（第 5 节）。
- 没有重新运行 `bun test`（评估报告已在 1.4.0 上运行：485 pass、0 fail）。
- 没有查看 CI 的实际运行记录，只确认了矩阵配置。

## 2. 复核结论

### 2.1 属实的结论

| 评估报告结论 | 证据 | 补充说明 |
|---|---|---|
| 每个 `[assistant]` 段最多保留最后 8 条工具行 | `src/core/brief.ts:355-378`；常量 `TOOL_CALLS_PER_TURN = 8` 在第 357 行 | "段"是两条用户消息之间全部 assistant 正文与工具调用合成的一节（`push` 在同一标题下追加，`brief.ts:259-266`），不是单条 assistant 消息 |
| 合并先于截断；省略数按合并后的行数计 | 合并在 `brief.ts:329-353`；计数与标记在 `brief.ts:364-372` | 一行 `(#12, #14) x2` 被丢弃时只计 1 条 |
| 被丢弃行的 `#N` 不再出现在简报里 | `brief.ts:370` 整行跳过；标记只有数量（`brief.ts:372`） | |
| `mode:"touched"` 在纯 codemode 会话为空 | `getFileIndicators`（`src/core/search-entries.ts:335-354`）只遍历 `msg.content` 中的顶层 toolCall；codemode 调用的参数只有 `{ code }`；nestedCalls 挂在 toolResult 上（`pi-ai/dist/types.d.ts:429`） | 该函数与上游完全相同。搜索用的 `fullText` 已经读取 nested（`search-entries.ts:320`），所以出现"搜得到、touched 列不出"的不一致 |
| 工具描述只提到两个盲区 | `src/tools/recall.ts:72`（apply_patch 与 bash 重定向） | |
| 注入规则渲染为 `- - ` | 常量以 `- ` 开头（`src/codemode/guideline.ts:4-8`）；宿主 `buildRules` 给每条规则统一加 `- `（`pi-coding-agent/dist/core/system-prompt.js:65`），宿主自带的规则都不带前缀 | 1.4.0 上同样成立。测试钉住了带前缀的原文（`tests/codemode-guideline.test.ts:38-45`）。来源很可能是计划书 §4.1 用 Markdown 列表书写规则（`CODEMODE_LONG_HORIZON_PLAN.md:170-171`），实现时把列表符号一起写进了字符串 |
| 摘要的文件清单来自宿主 fileOps，宿主会读 nestedCalls | 宿主 `pi-coding-agent/dist/core/compaction/utils.js:16-36`；插件转交在 `src/hooks/before-compact.ts:755-758` | 插件自己的抽取只看块里的路径参数（`src/extract/files.ts:68-76`），codemode 块没有路径 |
| 文件清单每类最多 10 条 | `src/core/build-sections.ts:53-60` | |
| 简报工具名是静态扫描，包括注释 | `src/codemode/summary.ts:57-69`（正则扫描 `tools.<name>(`） | |
| P3 缺口数字 | `CODE_FULL_CHARS = 1500`（`summary.ts:17`）；`NESTED_SHOWN = 12`、`NESTED_SHOWN_FULL = 32`（`summary.ts:140-141`） | |
| README 限制清单缺 touched 与 8 行上限 | `README.md:260-267` | |

**8 行上限与上下文压力无关的直接证据**（评估报告未给出）：

1. ranked 简报本来就有字符预算：下限 1100 token、上限 2000 token、每块 15 token 的斜率（`before-compact.ts:748-765`），按校准后的"每 token 字符数"换算；该值被限制在 2～6 之间（`src/core/token-estimate.ts:2-3`、`31-37`），所以预算下限不低于 2200 字符。
2. 8 行上限在预算选块之后才执行：`compileRanked` 先由 `selectRankedBriefBlocks` 按预算选块，再由 `buildSections` 调用 `buildBriefSections`（`build-sections.ts:66`）施加 8 行上限。
3. 评估报告中那次真实压缩，整份摘要只有 1376 字符（评估报告实测），低于预算下限的最小可能值。所以那 9 条意图完全是被行数上限丢掉的。
4. 本文复现：17 次 codemode 调用，按压缩钩子的真实参数生成的 ranked 摘要只有 701 字符（预算下限 2200～4400 字符），仍然省略 9 条。
5. 预算计费按单块单独编译（`src/core/rank.ts:246-248`），被 8 行上限丢掉的块已经扣过额度；预算紧张时，这部分额度等于白占。

### 2.2 需要更正、收窄或补充的结论

**(1) 报告 2.3 节"Read 是'读减写'过滤的结果"——机制错误。**

- 事实：pi-vcc 直接透传宿主的原始读集合（`before-compact.ts:756`），`formatFileActivity` 只把 Modified 从 Created 中去重（`build-sections.ts:51`）。"读减写"是宿主 `computeFileLists`（`pi-coding-agent/dist/core/compaction/utils.js:57-62`）的逻辑，只用于宿主自己的 LLM 摘要。
- 影响：同一文件既读又写时，会同时出现在 Read 和 Modified 中。评估报告那次结果吻合，是因为读和写的文件恰好没有重叠。这是继承自上游的行为，本文不列为修正项。

**(2) 报告 2.6 节"合成路径的 `firstKeptEntryId` 为空，合成夹具会失真"——归因错误。**

- 事实：评估报告所说的 `rpc-compact` 路径（仓库 `research/p1-bench/rpc-compact.ts`）只发一次提示就压缩（第 51、53 行）。没有可用的用户边界，或边界之前只有不产生内容的 system 条目时，`buildOwnCut` 都会全部压缩，并写入空字符串哨兵（`before-compact.ts:296-330`）；`applyTailBudget` 只在会话超过 25k token 时才按预算重切（`before-compact.ts:399-406`）。
- 正确结论：空值来自"单轮会话全部压缩"，与合成或真实路径无关；只要会话有两轮以上用户消息，就会得到非空值。
- 推论：按同一脚本和短任务推断，计划书 P1 收益记录中的两组配对也属于"全部压缩、不保留尾部"，从未测到保留尾部时的行为（各次运行的 `firstKeptEntryId` 可在原始输出中核对）。

**(3) 报告 3.2 节的成本对比（+116% 等）——需注明会话形状。**

- 事实：上游没有 codemode 分支，codemode 行是无参数的 `* codemode (#N)`；合并只与紧邻的上一行比较（`brief.ts:341-349`），中间夹着正文就不会合并。评估报告的合成脚本中，每条 assistant 消息只有一个 toolCall、没有正文，这是上游合并的最佳情形。
- 本文复现（17 次调用、每次意图不同）：

| 会话形状 | fork 简报中的 `#N` 数 | 上游简报中的 `#N` 数 | fork 省略 | 上游省略 |
|---|---|---|---|---|
| 调用之间没有正文 | 10 | 19 | 9 条 | 无 |
| 每次调用前有一句正文 | 27 | 27 | 9 条 | 9 条 |

- 影响：有正文时，上游同样丢 9 行，fork 只是每行信息更多；没有正文时，上游合并成一行并保留全部引用。成本和丢弃率都应按形状分别报告。

**(4) 报告 §4、§5 关于 README 第 275 行"意图没有成本"——问题性质不同。**

- 事实：README 已限定为 "in that pair"，第 279 行也写明只有两组配对、不是统计结论，并没有把它推广。真正的问题是先后顺序有歧义：原句先写 upstream、后写 fork，接着写 "708 vs 733 chars"，读起来是 fork 733 > 上游 708，与紧随其后的 "did not cost extra size" 矛盾；计划书 P1 记录（`CODEMODE_LONG_HORIZON_PLAN.md:332`）则是 P1 在前。`research/` 中没有结果文件，本文无法判定归属。
- 处理：见工作项 B2。

**(5) 报告 §8.1"上游 8 行上限按每行 113 字符调参"——不成立。**

- 事实：113 字符左右的无意图代码头行是 fork 自己加的（`summary.ts:92`，代码头截取 80 字符，`summary.ts:20`）。上游的 codemode 行只有十几个字符；上游 8 行上限针对的是普通工具行，例如 bash 命令最长可到 240 字符（`brief.ts:112`）。
- "行数上限不等于字符预算"这一结论本身成立，更有力的证据见 2.1 节末尾。

**(6) 报告 §5 P2"把 `isCodemodeMessage` 分支搬到文件指标里"——低估了范围。**

- `runTouched` 会附带一条 `query:'#N:file'` 下钻提示（`src/core/recall-run.ts:335-347`），而下钻 `expandEntryFile` 同样只读顶层 toolCall（`src/core/drill-down.ts:39-63`、`260-262`）。只改 `getFileIndicators`，这条提示会指向一个返回 "No file content found" 的入口。
- 宿主对 nested 记录有大小限制：单次调用参数超过 8KB，或同一脚本内累计超过 32KB 之后的调用，`arguments` 被整体省略，只留下 `argumentsBytes`（`pi-coding-agent/dist/core/nested-tool-calls.js:16-21`、`43-47`）。`path` 也一并丢失，因此这类大文件写入在修复后的 `touched` 和宿主文件操作中都看不到。
- 完整范围见工作项 F。

**(7) 报告 3.3 节"40 条 nested 中前 8 条不可达"——说得略重。**

- 事实：nested 搜索文本按调用顺序拼接后，用 `clip` 保留开头 2000 字符（`src/codemode/search.ts:11`、`33`；`clip` 从尾部截断，`src/core/content.ts:4`）；列表和展开保留的却是末尾 12/32 条（`summary.ts:161`）。
- 影响：早期调用仍可能通过 `query` 命中并出现在片段里；真正既不显示、也搜不到的是中间段（超出搜索前 2000 字符、又不在最后 32 条内）。README 第 265 行没有说明两者方向相反。

**(8) 报告 §5 的 P0 自称"不改代码"，但其中第 5 条（规则前缀）是代码加测试的改动。** 不影响结论，本文归入工作项 A。

### 2.3 评估报告未覆盖的问题

**N1. 简报的 `#N` 引用覆盖相对上游回退（已复现）。**

- 机制：上游把连续的 `* codemode` 行合并成一行，列出全部引用；fork 每条意图都不同，无法合并，8 行上限丢行时引用一起消失。
- 范围：只在"连续 codemode 调用、中间没有正文"的形状下出现；有正文时两边一致（见 2.2(3) 的表格）。
- 影响：违背计划书 §2"每个省略都要给入口或覆盖说明"的原则。工作项 C 可以补回。

**N2. 纯 codemode 会话的文件清单依赖宿主切点，可能漏列（代码推断，待复现）。**

- 机制：宿主 `prepareCompaction` 按 `keepRecentTokens`（默认 20000，`pi-coding-agent/dist/core/compaction/compaction.js:56`）自行切分，只从它要摘要的消息中抽取文件操作（`compaction.js:628-651`）。pi-vcc 按自己的规则切分：默认保留最后一轮用户消息；这段尾部不超过 5k token 时，向前扩展到最多 25k；尾部超过 25k 的 2.5 倍时，按 25k 重切（`before-compact.ts:39`、`423-424`、`474-504`、`371-419`）。两个切点相互独立，这是 AGENTS.md 明确规定的行为。
- 漏列条件：pi-vcc 保留的尾部少于宿主时（默认设置下，大致是最后一轮用户消息的尾部在 5k～20k token 之间），pi-vcc 会摘要掉一段宿主视为"保留"的消息，这段消息里的文件操作不在 `preparation.fileOps` 中。普通会话由插件自己的块抽取补上（`extract/files.ts:68-76`）；codemode 会话没有这个补充，相关文件就从 `[Files And Changes]` 中消失，而原始消息已经被摘要掉。
- 评估报告那次压缩的文件清单与摘要区间完全吻合，只能说明那次宿主切点不早于 pi-vcc 切点，不能推广。
- 附带收益：工作项 E 让插件自己从 nestedCalls 抽取，同时消除了对"宿主是否支持 nested 文件操作"的依赖（Pi 1.0.0 上未验证）。

**N3. 工具名后的 `×N` 容易被读成执行次数。**

- 机制：`×N` 是源码中 `tools.<name>(` 出现的次数（`summary.ts:79`）。循环里只写一次的调用显示为 `bash`；三个分支各写一次、实际只执行一个的脚本却显示为 `bash×3`。
- 冲突：计划书 §2.1 要求算法派生信号"不能改名为实际执行次数"（`CODEMODE_LONG_HORIZON_PLAN.md:73`）；README 第 266 行只说明了工具名是声明，没有说明计数。
- 处理：工作项 D。

**N4. 收益门的覆盖不足比评估报告所说的更具体。**

- 计划书 §5 要求对照"至少覆盖"7 项：长脚本可读性、nested 状态可追性、意图可读性、压缩后正确下一步、重复调查/写入、目标偏离、总 token（`CODEMODE_LONG_HORIZON_PLAN.md:323`）。P1 记录实际覆盖了意图可读性、nested 状态和一次压缩后召回，约 3 项（`CODEMODE_LONG_HORIZON_PLAN.md:329-337`）。
- "通过"符合 §6.3"至少一项稳定可见收益"的门槛，但不符合 §5 的覆盖要求；再加上 2.2(2) 的推断（两组配对很可能都没有保留尾部），记录应改为"可见性通过（小样本），行为与成本未测"。

**N5. 多保留简报行会挤占多次压缩时的合并额度。**

- 机制：ranked 路径下新简报本身不截行（`src/core/summarize.ts:267`）；与上一次摘要合并时，总共 120 行，新简报优先，旧简报只能使用剩余行数（`summarize.ts:197-204`；`BRIEF_MAX_LINES = 120`，`src/core/format.ts:31`）。
- 影响：评估报告 §8 只计算了字符成本。放宽每段行数后，多次压缩的会话会更早挤掉旧简报。工作项 H 必须测这一项。

### 2.4 内存复现记录

- 设置：1 条用户消息 + 17 次 codemode 调用（每次意图不同、各嵌套 1 次 bash）+ 1 条结尾正文。分两种形状："调用之间没有正文"和"每次调用前有一句正文"。ranked 摘要使用压缩钩子的真实参数（1100/2000/15 token），每 token 字符数分别取 2 和 4。
- 结果：

| 检查项 | 结果 |
|---|---|
| 无正文：简报中的 `#N` 数 | fork 10，上游 19 |
| 无正文：省略标记 | fork 省略 9 条，上游无省略 |
| 有正文：简报中的 `#N` 数 | 两边都是 27 |
| 有正文：省略标记 | 两边都省略 9 条 |
| ranked 摘要长度（2 或 4 字符/token） | 都是 701 字符 |
| 对应的预算下限 | 2200 / 4400 字符 |
| ranked 摘要中的省略 | 仍省略 9 条 |

- 未写任何文件。脚本与原始输出见附录 B。

## 3. 对评估报告建议的意见

### 3.1 优先级（报告 §5）

同意"先文档、后 touched、store 投影靠后"的总体顺序，调整两点：

1. 可操作省略标记（报告 §8.3 第 3 条）提前到第一批代码修正：成本低，不涉及预算，还能补回 N1 的引用回退。
2. 测量（报告的 P1）只需放在"改简报预算"之前，不必阻塞 C、D、E、F，因为这几项都不改变预算。

### 3.2 报告 §8 的改进建议

| 建议 | 意见 | 理由与调整 |
|---|---|---|
| 1. 行数上限改为字符预算 | 方向同意，实现方式调整 | 不能改通用上限，否则会改变非 codemode 会话，违反 AGENTS.md 与上游黄金对照测试。应让现有 8 行规则对非 codemode 行的结果保持不变，只把被丢弃的 codemode 行按单独的字符额度"补回"（工作项 H）。补回的块在 ranked 选块时已经计过费，不会突破 ranked 预算 |
| 2. 每段永远保留最早 1～2 行 | 暂不做，作为 H 的可选实验 | 任务目标已在 `[user]` 行和 `[Session Goal]` 中；第一条意图往往只是探索。保留首行还会让被丢弃的行不再连续，省略标记中"earlier"的语义要随之改写 |
| 3. 让省略标记可操作 | 同意，最先做 | 只在被丢弃的行含 codemode 行时启用；保留原有前缀；拿不到引用时退回原文（工作项 C） |
| 4. 只对超长块启用退化摘要 | 同意放在最后 | 收益取决于块长分布，先看测量结果 |
| 8.5 不要把 8 直接改成 16 | 同意 | 理由同第 1 条 |

### 3.3 报告 §8.4 验收标准的修订建议

| 报告标准 | 意见 | 建议改为 |
|---|---|---|
| 意图丢弃率不高于 20% | 保留 | 按会话形状（有无正文）和每段步数分别报告 |
| 每段第一条意图 100% 保留 | 暂缓 | 只在 H 的锚点实验启用时适用 |
| 单段意图行不超过 1000 字符 | 保留 | 由 H 的额度保证 |
| 整份摘要不超过压缩前上下文的 1% | 不采用 | 上下文小于 11 万 token 时，1% 低于继承的 ranked 预算下限（1100 token），简报用满预算就会超标。改为"摘要不超过 ranked 预算上限 2000 token" |
| 相对上游 token 增量不超过 10% | 不采用原表述 | 评估报告在真实会话上测得 +116%，任何显示意图的设计都无法在摘要层面满足 10%。改为报告"压缩后整体上下文（摘要 + 保留尾部 + 新增规则）相对上游的增量" |
| 新增：引用覆盖 | 新增 | 被丢弃 codemode 行的 `#N` 100% 落在省略标记给出的范围内 |
| 新增：合并保留 | 新增 | 多次压缩时旧简报保留行数的中位数变化；阈值在 G 之后确定 |
| 新增：非 codemode 一致 | 新增 | 无 codemode 记录的会话与上游黄金对照逐字一致；`mode:"on"` 的直接工具行保留集合不变 |

## 4. 修正计划

### 4.0 共同约束

每个工作项都必须满足：

1. 无 codemode 记录的会话：渲染、简报、搜索、切点与上游 v0.10.2 逐字一致；`tests/codemode-gating.test.ts` 中的上游黄金对照只能新增用例，不能修改。
2. `mode:"on"` 下的直接工具调用保持上游行为；只有 codemode 调用及其 nested 记录走 fork 逻辑（AGENTS.md 的两层门控）。
3. 不改变哪些条目被编号，`#N` 保持稳定。
4. 摘要、recall 输出、工具描述和规则文案都是 agent 读取的接口：有意修改，同步更新钉住它们的测试，并记录在 `CHANGELOG.md` 的 `[Unreleased]` 下。
5. 锁定宿主 1.4.0 与最低支持宿主 1.0.0 都通过 `bun run typecheck` 和 `bun test`（1.0.0 的安装与恢复命令见 AGENTS.md）。
6. 测试读写设置时用 `PI_VCC_CONFIG_PATH` 指向临时文件；不提交 `research/`，不在提交或 PR 中引用会话内容。

### 4.1 阶段与依赖

| 阶段 | 工作项 | 进入条件 | 退出条件 |
|---|---|---|---|
| 0 | A、B | 无 | 两个宿主测试通过；README 的 708/733 经作者确认后改写 |
| 1 | C、D、E | 无（三项互不依赖，可分别合并） | 各自新增的测试通过；黄金对照不变 |
| 2 | F | 无（建议放在阶段 1 之后，复用 C 的夹具） | 同上 |
| 3 | G | 无硬依赖；E 合并后测得更完整 | 测量结果写入计划书 §5，注明样本量、模型和会话形状 |
| 4 | H | C 已合并；G 给出丢弃率、合并保留和成本基线 | 3.3 节修订后的验收标准全部满足 |
| 5 | I | 计划书 P3 启动 | 按计划书 P3 的门禁 |

### 4.2 工作项

#### A. 去掉规则常量的 `- ` 前缀

- 目标：系统提示里的两条 codemode 规则只显示一个列表符号。
- 改动：
  - `src/codemode/guideline.ts:4-8`：两条常量去掉开头的 `- `，其余文字不变。
  - `tests/codemode-guideline.test.ts:38-45`：更新钉住的原文；新增断言"常量不以 `- ` 开头"，测试名写明"列表符号由宿主添加"。
- 不受影响的部分：`appendCodemodeGuidelines` 按整串去重（`guideline.ts:29`），宿主 `addRule` 也会去掉首尾空白后去重（`pi-coding-agent/dist/core/system-prompt.js:34-40`）；规则每次运行都会重建，旧会话不需要迁移。
- 文档：`CHANGELOG.md` `[Unreleased]` 的 Fixed 下记一条；计划书 §4.1 补一句"列表符号由宿主添加，常量本身不带"。
- 验收：两个宿主测试通过。安装 1.0.0 时顺带查看其 `dist/core/system-prompt.js` 的 `buildRules`；若 1.0.0 不统一加前缀，需要重新评估（第 5 节）。
- 风险很低；规模约 2 行代码、5 行测试。

#### B. 文档口径修正

**B1. `README.md` 的 "Compatibility and limits"（第 260-267 行）新增或改写以下条目**（英文草稿见附录 C）：

1. 简报每个 assistant 段保留最后 8 条工具行（继承自上游），更早的 codemode 步骤会从简报中消失，可以用 `vcc_recall` 的 `range` 或 `query` 取回。C 合并后改为"省略行会给出可取回的范围"。
2. `mode:'touched'` 暂不列出 codemode 脚本写入的文件。F 合并后改为只剩"参数因大小限制被宿主省略"这一盲区。
3. nested 记录：搜索索引的是记录开头 2000 字符，列表与展开显示的是末尾 12/32 条，很长的记录中间段既不显示也搜不到。I 完成后更新。
4. 工具名后的 `×N` 是源码中的调用位置数，不是执行次数。D 合并后删除本条。

**B2. `README.md:273-279`**

1. 请作者用原始运行输出确认 708 与 733 的归属（`research/p1-bench/rpc-compact.ts:79` 会打印 `summaryLength`），改成"fork X vs upstream Y"的明确写法。若 fork 是 733，删去 "did not cost extra size"，改为写明多出的 25 字符。
2. 补一句成本随会话形状变化：每个不同意图占一行，相同意图会合并；调用之间没有正文时，上游会把所有 `* codemode` 合并成一行，此时 fork 的简报明显更长（评估报告在一个 13 轮会话上测得约 2.2 倍）。

**B3. `CODEMODE_LONG_HORIZON_PLAN.md`**

1. §5 的 P1 收益验证记录（第 329-337 行）补一张覆盖表，列出 §5 要求的 7 项各自"已测/未测"；注明两组配对是单轮会话、很可能全部压缩（待核对 `firstKeptEntryId`），没有测到保留尾部；结论改为"可见性通过（小样本），行为与成本未测"。
2. §6.3（第 433-438 行）拆成可见性、行为、成本三项，各自报告状态；进入 P2 的门槛仍是"至少一项"，但三项状态都要写明。
3. 增加指向本文件的链接，以及修正项 A～I 的状态。

- B 不改变运行行为，不需要 CHANGELOG 条目（作者愿意的话可以记在 Documentation 下）。规模小，无风险。

#### C. codemode 段的可操作省略标记

- 目标：8 行上限丢弃了 codemode 行时，省略标记直接给出可调用的取回范围，补回 N1 的引用回退。
- 改动位置：`src/core/brief.ts:355-378` 的截断循环。
- 设计：
  1. 计算被丢弃的工具行，即现有的 `toolIdxs.slice(0, dropCount)`。
  2. 门控：被丢弃的行里至少有一行是 codemode 行才启用。判断方法是取行首 `* ` 之后的第一个词，用 `isCodemodeToolName` 判断（`src/codemode/active.ts:7-8`，精确匹配、不区分大小写）。只有直接工具行被丢弃时（非 codemode 会话，或 `mode:"on"` 的直接调用），标记保持原文。
  3. 解析引用：只取行尾的引用组，兼容单引用 `(#12)` 和合并形式 `(#12, #14) x2`，写法与现有合并逻辑一致（`brief.ts:335-349`），正则为 `/\((#\d+(?:, #\d+)*)\)(?: x\d+)?$/`。
  4. 范围：起点是被丢弃行中最小的引用；终点是第一条保留工具行的最小引用减 1，这样最后一次被丢弃调用的结果条目也包括在内。第一条保留行没有引用时，终点取被丢弃行中最大的引用。
  5. 文本：`* (9 earlier tool-call entries omitted; recall range:[2, 19])`。保留原有前缀 "earlier tool-call entries omitted"；范围写法与 recall 现有提示一致（`src/tools/recall.ts:15`）；长度约 60 字符，低于 120 字符的换行阈值（`src/core/format.ts:32`）。
  6. 解析不到任何引用时（例如没有全局索引、按"宁可不发也不能发错"的原则不输出引用），退回原文。
- 语义核对：`#N` 是会话全局编号（摘要 `details.version: 2`，`before-compact.ts:795-805`），`range` 两端包含、每页 20 条，多次压缩之后仍可解析。
- 已知边界：某条意图文字恰好以 `(#123)` 结尾、而该行本身没有引用时，会被当成引用解析。这与现有合并逻辑的行为一致，不额外处理。
- 测试（加到 `tests/codemode-visibility.test.ts`，或新建 `tests/codemode-brief.test.ts`）：
  1. 17 次意图不同的 codemode 调用（带 `sourceIndex`）：标记含 `recall range:[a, b]`，a、b 符合上述规则；
  2. 12 次 bash 调用（现有 `tests/brief.test.ts:353-367`）：标记与原文完全一致，且不含 `range:`；
  3. 混合段：被丢弃的只有 bash 时保持原文；被丢弃的含 codemode 时带范围；
  4. 被丢弃的是合并行 `(#3, #5) x2`：范围覆盖两个引用；
  5. 没有引用：保持原文；
  6. 上游黄金对照不变。
- 文档：CHANGELOG 的 Changed 下记一条；README 同步 B1 第 1 条。
- 风险低；规模约 30 行代码、80 行测试。

#### D. 简报工具名去掉 `×N` 计数

- 目标：消除"调用位置数被读成执行次数"的误导（N3），并略微减少字符。
- 改动：`src/codemode/summary.ts:78-79` 只输出名字；排序（调用多的在前，再按首次出现）可以保留。
- 测试：`tests/codemode-visibility.test.ts:200` 的期望由 `read×2, bash` 改为 `read, bash`；新增"同名多次调用只显示一次"的用例。
- 文档：README 删除 B1 第 4 条；CHANGELOG 的 Changed 下记一条。
- 备选方案（不推荐）：保留计数，在每行加 `(declared)` 标注。每行多约 11 字符，也不能消除误读。是否把 `->` 改成更明确的写法，留给 G 的行为测量决定。
- 风险很低；规模约 2 行代码、5 行测试。

#### E. 压缩时补抽本段 nested 文件操作

- 目标：纯 codemode 会话的 `[Files And Changes]` 覆盖 pi-vcc 自己摘要的区间，不再依赖宿主切点（N2），也不依赖宿主版本是否支持 nested 文件操作。
- 先写失败用例：构造会话条目，使 pi-vcc 的摘要区间包含一个带 nested `write` 的 codemode 结果，同时传入空的 `preparation.fileOps`（模拟宿主切点把这段算作保留），断言摘要的 Modified 中出现该文件。当前代码下这个用例应当失败。
- 改动：
  1. 新建 `src/codemode/file-ops.ts`，提供 `nestedFileOps(messages)`：遍历 `isCodemodeMessage` 为真的 toolResult 的 `nestedCalls.calls`，规则与宿主 `addFileOp` 完全一致——只认 `read`、`write`、`edit` 三个名字和字符串 `args.path`（`pi-coding-agent/dist/core/compaction/utils.js:37-52`）；跳过没有 `arguments` 的记录。
  2. `src/hooks/before-compact.ts:755-758`：对 pi-vcc 自己的摘要区间 `agentMessages`（已按 skipCustomTypes 过滤，`before-compact.ts:655-663`）计算 `nestedFileOps`。结果非空时，与 `preparation.fileOps` 合并去重后传给 `compileRanked`；结果为空时，传入的数组与今天完全相同，保证非 codemode 会话逐字不变。
- 为什么在钩子里做：宿主的 `convertToLlm` 原样保留 toolResult（`pi-coding-agent/dist/core/messages.js:111-115`），但 `normalize` 生成的 tool_result 块不带 nestedCalls（`src/core/normalize.ts:28-35`），所以只能在 normalize 之前抽取。
- 测试：上面的失败用例转为通过；非 codemode 会话传给 `compileRanked` 的文件操作不变；nested `read` 只进入 Read；没有 `arguments` 的记录被跳过；`vcc_recall` 等非文件工具被忽略。
- 文档：CHANGELOG 的 Fixed 下记一条；README 与 F 共用一句大小限制说明。
- 回退条件：如果 G 发现补抽让 Read 明显膨胀，可以只补 Modified。
- 风险低；规模约 30 行代码、60 行测试。

#### F. `touched` 与 `#N:path` 下钻支持 nestedCalls

- 目标：消除"摘要文件清单列得出、`touched` 列不出"的不一致，并让 `touched` 附带的下钻提示真正可用。
- 改动：
  1. `getFileIndicators`（`src/core/search-entries.ts:335-354`）：顶层循环不变。之后，若消息是带 nestedCalls 的 toolResult（`isCodemodeMessage`），再遍历 `nestedCalls.calls`：跳过 `vcc_recall`；跳过没有 `arguments` 的记录；用现有的 `isContentBearing` 判断（`src/core/content.ts:62`，要求有路径键和内容字段）；路径键沿用 `PATH_KEYS`（`src/core/tool-args.ts:1`）。条目归到这个 toolResult 的 `#N`：`getTouchedFiles` 本来就使用 `rendered[i].index`，而 toolResult 有自己的条目（`src/core/render-entries.ts:41-43`）。
  2. 状态：`FileTouch`（`search-entries.ts:28-31`）增加可选的 `status`，nested 记录不是 `ok` 时填入。`formatTouchedOutput`（`src/core/format-recall.ts:59-65`）在有状态时输出 `#N (write, error)`，没有状态时与今天完全相同。`runTouched` 的下钻提示（`recall-run.ts:341`）跳过带状态的条目。
  3. 大小限制说明：`runTouched` 统计 codemode 结果中"名字匹配 `WRITES_FILE`（`recall-run.ts:332`）、但 `arguments` 被宿主省略"的记录。数量大于 0 时追加一行，说明有几次写入因大小限制无法列出，并给出最多 5 个条目编号，提示用 `expand` 阅读对应脚本。
  4. 下钻：`expandEntryFile`（`src/core/drill-down.ts:243-301`）在顶层调用之外，若消息是带 nestedCalls 的 toolResult，再加入 nested 中的内容型调用。同一条目内对同一路径有多次操作时（脚本中常见"先写再改"），按调用顺序合并展示，每段带 `--- k/K: write ---` 一类的标题，再沿用现有的预览、全文和分页规则。顶层调用的歧义处理保持原样。
  5. 工具描述（`src/tools/recall.ts:72`）：盲区说明补上"或参数因大小限制被 Pi 省略的 nested 调用"。这段静态文本对所有会话可见，按有意的接口修改记录在 CHANGELOG。
- 测试（沿用 `tests/recall-touched-drilldown.test.ts:12-56` 的 JSONL 会话写法，和 `tests/codemode-fixtures.ts:27-54` 的 `codemodeCall`、`codemodeResult`、`nestedCall`）：
  1. 纯 codemode 会话中的 nested `write` 与 `edit`：列出路径，编号为 toolResult 的 `#N`；
  2. 提示中的 `#N:file` 能下钻到 nested 内容；
  3. nested `read`（只有路径）不列出，与现有的形状规则一致；
  4. 只有 `argumentsBytes` 的记录不列出，并出现大小限制说明；
  5. `status: "error"` 的记录列出并带状态，下钻提示跳过它；
  6. 同一条目对同一路径两次操作：合并展示；
  7. 现有的 touched 与下钻测试全部不变；`scope:'all'` 与 lineage 行为不变。
- 文档：README 改写 B1 第 2 条；CHANGELOG 的 Changed 下记录输出与工具描述的变化。
- 风险低到中（下钻的合并展示是新逻辑）；规模约 100 行代码、150 行测试。

#### G. 真实路径测量

- 目标：为 H 提供基线，并把计划书的收益门从"可见性"补齐为"可见性 + 行为 + 成本"。
- G1 调试字段（不改变行为；调试快照不在黄金对照范围内）：
  - 在 `before-compact.ts:778-793` 的 `dbg` 中增加 `hostFirstKeptEntryId`（取 `preparation.firstKeptEntryId`）和宿主文件操作各集合的数量；E 合并后再加补抽的数量。
  - 快照每次压缩都会覆盖同一文件（`before-compact.ts:124-129`），测量时每次压缩后复制一份。
  - 用环境变量 `PI_VCC_CONFIG_PATH`（`src/core/settings.ts:6`）指向一份 `"debug": true` 的临时配置，不改动用户自己的配置。
- G2 离线回放脚本：新建 `scripts/codemode-brief-audit.ts`，与现有的 `scripts/benchmark-recall-quality.ts` 一样，只在本地读取会话，结果写入被 git 忽略的 `research/`。对每个含 codemode 记录的会话、每次压缩，统计：
  1. 每段的工具行总数、codemode 行数、保留数、丢弃数和丢弃率；会话形状（调用之间有无正文）；不同意图数；
  2. 简报字符数相对 ranked 预算下限和上限的比例，即"预算未触顶、但行数上限已生效"的比例；用压缩条目中保存的 `tokensBefore`，按 `before-compact.ts:546-559` 的方式校准；
  3. 引用覆盖：被丢弃 codemode 行的引用是否落在标记范围内（C 之后应为 100%）；与上游对照时，通过环境变量提供上游源码路径；
  4. 合并保留：多次压缩的会话中，旧简报的保留行数；
  5. 切点差异：用宿主导出的 `findCutPoint`（`pi-coding-agent/dist/index.d.ts:6`）按 `keepRecentTokens = 20000` 近似宿主切点，与 pi-vcc 的 `buildOwnCut` + `applyTailBudget` 比较，统计"被 pi-vcc 摘要、但不在宿主文件操作范围内"的 nested 文件数。含 context_edit 的会话单独标注，因为宿主实际使用投影后的切点。
- G3 真实续跑（行为与成本）：
  - 任务：固定 5 个任务，每个任务至少两轮用户消息（避免全部压缩），codemode `mode:"only"`。
  - 触发压缩：用 `/compact` 或 RPC 的 `compact()` 手动触发，保持宿主默认的 `keepRecentTokens`。不要再用"把 `keepRecentTokens` 设为 1"的办法：它会让宿主几乎摘要全部消息，恰好掩盖 N2。
  - 版本：上游 v0.10.2、当前 0.1.1、修正后（A～F），每个版本每个任务各跑 2 次。
  - 指标：压缩后的正确下一步（事先写好判定标准）；压缩后的重复写入（同一路径的 nested write 次数）与重复读取；`vcc_recall` 调用次数和输出 token；压缩后整体上下文 token（摘要 + 保留尾部 + 规则）。
  - 记录：写入计划书 §5，注明样本量、模型和会话形状；未达到阈值不写"通过"。
- 不改变运行行为（G1 只在 `debug: true` 时生效）。规模：脚本约 200 行；真实续跑需要模型额度。

#### H. codemode 简报行的字符额度（G 之后）

- 目标：降低意图丢弃率，同时保证非 codemode 行和直接工具行的结果不变。
- 设计（在 C 的截断循环上扩展）：
  1. 先按现有规则计算保留集合（最后 8 条工具行），非 codemode 行的保留结果因此与今天完全相同。
  2. 从紧挨着保留区的那条被丢弃行开始往前回补：只要它是 codemode 行，且该段 codemode 行的总字符数不超过额度 `CODEMODE_SEGMENT_CHARS`，就补回；遇到非 codemode 行或额度用完就停止。这样补回的行与保留行连续，被丢弃的行都在更早的位置，C 中"earlier ... omitted"的语义依然准确。
  3. 额度初值 1000 字符：约等于 8 条无意图代码头行（评估报告实测约 113 字符/行），所以全是代码头的段几乎不变；意图行（评估报告实测约 57 字符/行）可保留约 17 条。评估报告的仿真显示每段 16 行时丢弃率从 36% 降到 6%（评估报告实测，待 G2 复算）。最终取值以 G 的数据为准。
  4. 可选护栏：限制单次压缩补回的总行数，防止 N5 所说的合并挤占；是否需要，由 G2 第 4 项决定。
  5. 锚点（保留每段第一条意图）作为可选实验，单独开关；启用时省略标记改为不带 "earlier" 的写法，并同步更新测试。
- 预算一致性：补回的块在 ranked 选块时已经按单块计过费（`rank.ts:246-248`），补回不会让摘要超出 ranked 预算。
- 验收：3.3 节修订后的标准；非 codemode 黄金对照逐字不变；`mode:"on"` 的直接工具行保留集合不变。
- 风险中等（改变简报长度与合并行为，必须有测量支撑）；规模约 40 行代码、100 行测试。

#### I. nested 记录中段可达（P3）

- 现状：搜索取开头 2000 字符，显示取末尾 12/32 条，中间段不可达（2.2(7)）。只把搜索改成"头 + 尾"并不能覆盖中间段。
- 方向：按计划书 P3 为 nested 记录实现分页（展开时可以指定起点），并在列表行提示总条数和翻页方式；与长脚本分页一起设计，避免出现两套参数。
- 本轮只做 B1 第 3 条的文档说明。

### 4.3 发布建议

| 版本 | 内容 | 理由 |
|---|---|---|
| 0.1.2 | A、B | 修正与文档，不改变简报和 recall 行为 |
| 0.2.0 | C、D、E、F | 改变 agent 读到的简报、文件清单和 recall 文本，属于有意的接口修改 |
| 之后的次版本 | H（若 G 的结果支持） | 改变简报长度与合并行为 |

每次发布前都在两个宿主上运行 typecheck 和测试，并把 CHANGELOG 的 `[Unreleased]` 转为版本条目。

### 4.4 回退

每个工作项单独提交、单独可回退。C、D、F、H 修改的是文本接口，回退时同步回退对应的测试和 CHANGELOG 条目；E 的回退条件见工作项 E。

## 5. 未验证事项与验证方法

| 事项 | 现状 | 验证方法 | 影响的工作项 |
|---|---|---|---|
| README 中 708/733 的归属 | `research/` 中没有结果文件 | 作者查原始运行输出 | B2 |
| P1 两组配对的 `firstKeptEntryId` 是否为空 | 由脚本逻辑推断 | 作者查原始运行输出 | B3 |
| Pi 1.0.0 的规则是否同样显示为 `- - ` | 未安装 1.0.0 | 按 AGENTS.md 安装 1.0.0，查看 `dist/core/system-prompt.js` 的 `buildRules` | A |
| Pi 1.0.0 压缩时是否读取 nestedCalls | 宿主 CHANGELOG 只能确认 nestedCalls 早于 1.0.0 存在 | 同上，查看 `dist/core/compaction/utils.js` | E（E 合并后不再依赖） |
| 宿主与插件切点不一致造成的漏列 | 代码推断 | E 的失败用例；G1 调试字段；G2 第 5 项 | E |
| CI 在 1.0.0 上的实际结果 | 只确认了矩阵配置（`.github/workflows/ci.yml:24-25`） | 查看 GitHub Actions 记录 | 全部 |
| 评估报告 §8.2 的仿真数字（36% 到 6%） | 评估报告实测，本文未复算 | G2 第 1 项 | H |
| 行为收益（正确下一步、重复工作） | 未测 | G3 | H、计划书收益门 |

## 附录 A：关键常量

| 常量 | 值 | 位置 |
|---|---|---|
| 每段工具行上限 `TOOL_CALLS_PER_TURN` | 8 | `src/core/brief.ts:357` |
| 合并后简报行上限 `BRIEF_MAX_LINES` | 120 | `src/core/format.ts:31` |
| 换行阈值 `TUI_SAFE_LINE_CHARS` | 120 字符 | `src/core/format.ts:32` |
| ranked 简报预算 | 下限 1100、上限 2000、每块 15 token | `src/hooks/before-compact.ts:748-750` |
| 每 token 字符数 | 默认 4，限制在 2～6 | `src/core/token-estimate.ts:1-3` |
| 智能保留尾部 | 不超过 5k 时才扩展，最多 25k | `src/hooks/before-compact.ts:423-424` |
| 超大尾部重切系数 | 2.5 | `src/hooks/before-compact.ts:39` |
| 宿主默认 `keepRecentTokens` | 20000 | `pi-coding-agent/dist/core/compaction/compaction.js:56` |
| 简报代码头截取 `CODE_BRIEF_CHARS` | 80 字符 | `src/codemode/summary.ts:20` |
| 简报意图上限 `INTENT_BRIEF_CHARS` | 200 字符 | `src/codemode/summary.ts:22` |
| 脚本预览 / 展开 | 300 / 1500 字符 | `src/codemode/summary.ts:16-17` |
| nested 列表 / 展开条数 | 12 / 32 | `src/codemode/summary.ts:140-141` |
| nested 搜索文本预算 | 2000 字符（保留开头） | `src/codemode/search.ts:11` |
| 宿主 nested 记录上限 | 256 次调用；单次参数 8KB；累计 32KB | `pi-coding-agent/dist/core/nested-tool-calls.js:16-21` |
| 文件清单每类上限 | 10 | `src/core/build-sections.ts:58-60` |

## 附录 B：内存复现脚本

目录约定：评估目录 `.pi-eval/` 与仓库 `pi-vcc-codemode/` 同级，上游 v0.10.2 解包在 `.pi-eval/upstream/`。在 `.pi-eval/` 下保存为 `brief-ref-check.ts`，用 `bun run brief-ref-check.ts` 运行。本文复核时是用 `bun -e` 直接运行同一段代码，没有写文件；下面只补了类型标注，不影响输出。

```ts
import { normalize as fN } from "../pi-vcc-codemode/src/core/normalize";
import { buildBriefSections as fB, stringifyBrief as fS } from "../pi-vcc-codemode/src/core/brief";
import { normalize as uN } from "./upstream/src/core/normalize";
import { buildBriefSections as uB, stringifyBrief as uS } from "./upstream/src/core/brief";
import { compileRanked as fC } from "../pi-vcc-codemode/src/core/summarize";

const mk = (n: number, withText: boolean) => {
  const msgs: any[] = [{ role: "user", content: [{ type: "text", text: "long task" }] }];
  for (let i = 0; i < n; i++) {
    const code = "// goal: step " + i + " check module " + i + "\nawait tools.bash({command:\"echo " + i + "\"});";
    const parts = withText ? [{ type: "text", text: "Next I will look at module " + i + "." }] : [];
    msgs.push({ role: "assistant", content: [...parts, { type: "toolCall", id: "c" + i, name: "codemode", arguments: { code } }] });
    msgs.push({
      role: "toolResult", toolCallId: "c" + i, toolName: "codemode",
      content: [{ type: "text", text: "ok" }], isError: false,
      nestedCalls: { calls: [{ id: "n" + i, name: "bash", status: "ok", arguments: { command: "echo " + i } }], complete: true },
    });
  }
  msgs.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
  return msgs;
};

const refs = (s: string) => (s.match(/#\d+/g) ?? []).length;
for (const withText of [false, true]) {
  const m = mk(17, withText);
  const fb = fS(fB(fN(m))), ub = uS(uB(uN(m)));
  console.log("withText=" + withText, "| fork refs in brief:", refs(fb), "| upstream refs in brief:", refs(ub));
  console.log("  fork omitted:", fb.split("\n").find((l: string) => l.includes("omitted")) ?? "(none)");
  console.log("  upstream omitted:", ub.split("\n").find((l: string) => l.includes("omitted")) ?? "(none)");
}
for (const cpt of [2, 4]) {
  const s = fC({ messages: mk(17, false), ranking: { maxBriefChars: 1100 * cpt, maxBriefCharsCeiling: 2000 * cpt, briefCharsPerBlock: 15 * cpt } } as any);
  console.log("charsPerToken=" + cpt, "| ranked summary chars:", s.length, "| brief budget floor chars:", 1100 * cpt, "|", s.split("\n").find((l: string) => l.includes("omitted")));
}
```

复核时的输出：

```text
withText=false | fork refs in brief: 10 | upstream refs in brief: 19
  fork omitted: * (9 earlier tool-call entries omitted)
  upstream omitted: (none)
withText=true | fork refs in brief: 27 | upstream refs in brief: 27
  fork omitted: * (9 earlier tool-call entries omitted)
  upstream omitted: * (9 earlier tool-call entries omitted)
charsPerToken=2 | ranked summary chars: 701 | brief budget floor chars: 2200 | * (9 earlier tool-call entries omitted)
charsPerToken=4 | ranked summary chars: 701 | brief budget floor chars: 4400 | * (9 earlier tool-call entries omitted)
```

## 附录 C：README 修改草稿（英文）

"Compatibility and limits" 中新增或替换的条目（阶段 0 的版本）：

```markdown
- **The brief keeps the last 8 tool lines per assistant segment** (inherited from upstream). Earlier codemode steps drop out of the brief; their entries stay in the session, and `vcc_recall` with `range` or `query` brings them back.
- **`mode:'touched'` does not list files written from codemode scripts yet.** Those writes are nested calls recorded on the script's result. Search them with `query`, or read the result with `expand`.
- **Nested rendering is bounded.** The list shows the last 12 calls and expand shows the last 32, while search indexes the first 2,000 chars of the record, so in a very long record the middle calls are neither shown nor searchable. Pi may also save an incomplete record; the output marks it as `[record incomplete]`.
- **The brief's tool names are declarations.** They are scanned from `tools.<name>(...)` in the source, including text in comments, not from execution. A count such as `bash×2` is the number of call sites, not the number of runs. Use the nested status for what actually happened.
```

后续工作项合并时的替换：

- C 合并后，第 1 条改为："... Earlier codemode steps drop out of the brief, and the omission line names the `vcc_recall` range that holds them."
- F 合并后，第 2 条改为："**`mode:'touched'` lists files written or edited from codemode scripts**, except calls whose arguments Pi dropped for size (over 8 KB per call or 32 KB per script); the output says how many were dropped."
- D 合并后，第 4 条删去计数那一句。

第 275 行（待作者确认 X、Y 后填写）：

```markdown
- upstream brief `* codemode` versus fork brief `* codemode -> read, bash | goal: <intent>`; summary length: fork X vs upstream Y chars. The brief adds one line per distinct goal, up to 8 tool lines per assistant segment, and identical goals collapse. When calls follow each other without assistant text, upstream collapses every `* codemode` line into one, so the fork's brief is longer: about 2.2x in one 13-turn session.
```
