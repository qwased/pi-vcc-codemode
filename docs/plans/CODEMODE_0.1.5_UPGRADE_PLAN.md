# pi-vcc-codemode 0.1.5 升级改进计划：固定预算下的续接导航

- 日期：2026-10-28。
- 状态：**审阅后的方案稿，未实施**。本次只新增本文件，不修改原评审、源码、设置或版本，不提交、不发布、不切换本机安装。
- 审阅对象：[0.1.4 现场复核](../reviews/CODEMODE_0.1.4_FIELD_REVIEW.md)。原稿 SHA-256：`68705743c8225adb61cf11a22acb89c737ec2c285b264b15197a3bd16f8818d7`。
- 代码基线：`8d8e6684122c69782dd741404866d5b8eabe9571`，package 版本 `0.1.4`。
- 相关依据：[0.1.4 修订计划](CODEMODE_0.1.4_REVIEWED_PLAN.md)、[0.1.4 实施记录](../patches/0.1.4-brief-and-metadata.md)。前者“尚未实施”的状态属于当时计划，不代表当前版本状态。
- 方法：原文审阅、图定位及覆盖检查、当前源码核验、类型检查、定向测试、公开合成输入实验。**没有重读、重放或独立复算原评审的私人 400K 会话。**

## 1. 总体意见与版本目标

**认可问题方向，不照单接受全部归因和建议。** 现场数据有力地提示：固定预算下，过多过程导航可能挤薄最近的长报告；现有结果引用又偏向错误调用，增加了接任者寻找验证证据的成本。但是，一次会话不能证明通用最优配额，更不能把摘要之后发生的提交、推送反推成摘要错误。

0.1.5 的目标是：**不增加总预算，让接任者更容易找到最近的报告和调用结果，并减少把历史文字当作当前事实的风险。** 不是把算法摘要变成可信的完成证明或仓库状态数据库。

验收分三层：

1. **正确性**：UTF-16 字符预算不超限，引用不乱配，历史编辑与双层 codemode 门控不变，不从注解或无错误标记推断成功。
2. **确定性收益**：受控饱和场景中，两条最近长文本不再同时停留于 64 单元；存在可容纳配额时，近期直接工具及其已保存结果可导航。
3. **边界诚实**：说明新增深度牺牲了多少旧文本/工具广度；不宣称提高任务成功率，不承诺报告中部所有数字可见。

## 2. 对现场评审的逐项修订意见

以下是对原稿的意见，**不直接改写原稿**。

| 编号 | 评审点 | 核验与修订意见 |
|---|---|---|
| F1 | “规模到了，分配没到” | 可作为本会话的观察性结论。6,504 字符、46 引用等均为原稿报告值，本次未独立复算；不能据此断言一般会话已达到/未达到某个最优点。 |
| F2 | 274 与预算上限 | 原稿 §3 把 `briefHistoryMessageCount` 用作 `historyBlockCount`。前者写入的是消息数，预算实际使用未经 filterNoise 的 normalize 后块数；两者不是同一量。本次合成输入 1 条 assistant 消息产生 3 块。应补实际块数、字符率、预算后再精确判断。见 [before-compact.ts:778](../../src/hooks/before-compact.ts#L778)、[before-compact.ts:878](../../src/hooks/before-compact.ts#L878)。 |
| F3 | “64 字下限” | 单位应为 UTF-16 单元，不等同汉字、字素或 token；截断会避开字素边界并 trim。通常是首尾各约 32 单元，而非开头 64 单元。实际成本还包括省略标记、引用及换行。本次 200 个 ASCII 字符的合成输入保留 32+32，渲染长度 108。见 [brief.ts:736](../../src/core/brief.ts#L736)。 |
| F4 | “先 64，再便宜整段，再 +64” | 应补充：初始化时若全文成本不高于摘录，直接保留全文；随后按配额折叠最老连续段；再按全文增量升序升级；最后最新优先 +64。18 条×64 不能直接当作成本账，也不能仅凭角色总长度推算精确内部配额。见 [rank.ts:392](../../src/core/rank.ts#L392)、[rank.ts:405](../../src/core/rank.ts#L405)、[rank.ts:447](../../src/core/rank.ts#L447)。 |
| F5 | 无错误结果没有导航 | 渲染缺口成立：配对结果的 `resultIndex` 已存入候选，但只有 observedError 才显示结果引用。无需新建配对器或解析“成功”文字。见 [brief.ts:652](../../src/core/brief.ts#L652)、[brief.ts:677](../../src/core/brief.ts#L677)、[brief.ts:771](../../src/core/brief.ts#L771)。 |
| F6 | 工具结果 154→8、其余 16 | 16 应限定为原稿中被展示的 24 条调用里其余 16 条，不是全会话所有未标错调用。154 条原始结果与 24 条可见调用分母不同。错误 20% 是初选通道，不是最终绝对保留保证；省略标记收缩阶段仍可能驱逐错误行。见 [rank.ts:506](../../src/core/rank.ts#L506)、[rank.ts:544](../../src/core/rank.ts#L544)。 |
| F7 | “直接工具 0 行” | 是样本现象，不是路径被禁用。直接 bash toolCall 属 tool 候选；用户的 bashExecution 是 user 角色中的 `$ command`。工具在最终排版可出现在 `[assistant]` 块，不能把 3,161 字整个块当作 assistant 文本配额。见 [brief.ts:631](../../src/core/brief.ts#L631)、[brief.ts:650](../../src/core/brief.ts#L650)。 |
| F8 | 状态过期、摘要“错误” | 原稿 §6/§8 的强措辞与 §11 的时间限定应统一。压缩前“未提交”、压缩后提交并不矛盾；两次压缩后是否仍有误导需要另测。源码确有旧目标按行去重、最多 8 行的机制，但重新提取也不会把用户早先的 HEAD 自动改成新 HEAD。见 [summarize.ts:123](../../src/core/summarize.ts#L123)、[goals.ts:47](../../src/extract/goals.ts#L47)。 |
| F9 | 文件清单只认写入类工具 | 方向成立，但还有宿主传入的 fileOps 与 nested 操作来源，不能简化为单一路径。调用记录表示记录过的操作，不等于成功落盘或真实 diff；压缩时执行 git diff 也不能还原已经提交的历史修改。见 [files.ts:58](../../src/extract/files.ts#L58)、[before-compact.ts:735](../../src/hooks/before-compact.ts#L735)。 |
| F10 | 0.1.4 的目标“全部无回归” | 当前样本支持 goal 标签、章节、可解析引用等观察；不能同时证明未采样的 limited note 或 recall 动作纠正无回归。原稿已说明 H9 无样本，应在总结保留限定；既有自动化证据另列。 |

**特别注意**：只把“最新报告”分得更长，并不保证其测试数字在头尾摘录内；把它称为“最近长助手文本”比“最终验证报告”更准确。识别“最终”“权威”“验证成功”均不应靠关键词包装成事实。

## 3. 范围与不采用项

### 3.1 本版建议实施

| 项目 | 内容 | 主要文件 |
|---|---|---|
| R1 | 最近长助手文本的预算内优先摘录，允许有边界地少留旧过程文字 | [src/core/rank.ts](../../src/core/rank.ts)、相关 rank/brief-history 测试 |
| R2 | 已配对结果使用中性 `result #N`；给最近直接工具设置有限初选配额 | [src/core/brief.ts](../../src/core/brief.ts)、rank.ts、brief/rank 测试 |
| R3 | 在历史 header 前增加简短来源说明，不改标题、不自动改写状态 | [src/core/summarize.ts](../../src/core/summarize.ts)、brief-history/context-edits 测试 |
| R4 | 持久化实际预算口径，扩展仅计数/长度的审计指标 | [src/details.ts](../../src/details.ts)、[src/hooks/before-compact.ts](../../src/hooks/before-compact.ts)、[scripts/codemode-brief-audit.ts](../../scripts/codemode-brief-audit.ts) |
| R5 | 冻结基线的差异审阅、确定性矩阵、兼容验证、用户文档 | [tests/allocator-golden.test.ts](../../tests/allocator-golden.test.ts)、[README.md](../../README.md)、[CHANGELOG.md](../../CHANGELOG.md) |

实施定位以本文件行号和符号为起点；不为文档便利扩大改动文件。必要的新测试/差异清单在实现前列出。

**生效门明确限定为历史 codemode 新编译路径。** [compileRankedWithDetail，summarize.ts:468–479](../../src/core/summarize.ts#L468) 已在 `briefHistoryHasCodemode` 成立时进入 `compileWithEffectiveHistory`；否则进入 `compileWithBriefBlocks` / `selectRankedBriefBlocks`。H1–H3 修改新候选分配与渲染函数，H4 只加在新编译分支；不改旧函数，也不新建用户开关。测试直接调用新分配器不等同纯非 codemode 生产路径，二者的验收不能混用。

### 3.2 保持的约束

- 总预算公式、完整有效历史块数口径、header 20% 上限、user/assistant/tool 初始 40/30/30、借额顺序、8 次重试及累计结构超额处理保持。
- **有意改变的是角色内部的分配与选取策略**，不承诺摘要、入选引用、折叠范围、保留条数逐字不变。H3 的两个 20% 均是 tool 自身配额的内部份额，不是各占总正文的 20%。
- `HISTORICAL_NOTE` 原文和 395 单元保持；`goal:` / `code:` 区分、注解非事实、blocked 不展示保持。工具行原有调用部分保持，H2 有意新增结果后缀，须更新对应的完整行断言。
- `#N` 全局空间、details.version=2、召回解析/排序/scan/read、非 codemode 的旧路径和 8 行/120 行规则保持。
- 原始会话只读；研究材料留在 git-ignored 区，不输出正文或真实会话文件名到仓库/审阅报告。

### 3.3 不纳入 0.1.5

1. **压缩时执行 git diff、运行脚本或推断脚本内部修改**。当前工作树不是压缩切点的历史快照；已提交改动、其它操作者的改动及多仓库会混入或漏掉。
2. **按 research/src/tests 路径硬编码优先级**。目录名不证明重要性；不隐藏真实记录来让清单看起来更像发布 diff。
3. **正则删除 HEAD/版本/未提交等文字**。可能删掉明确约束、引文或仍有效的要求；不实现“自动最新状态”。
4. **Session Goal 与首条正文直接减字去重、目标全历史重建**。这是后续独立设计：须解决来源对应、范围变更、edited checkpoint 以及旧 header 继承；本版只降低误读，不声称清除旧状态。
5. **提取 exit code、测试数并宣布成功**。当前规范化的 tool_result 未保留通用结构化 exitCode；结果导航足以解决本轮的一部分问题，不扩展解析系统。bashExecution 已有 exitCode 也不与 toolCall 混为一谈。
6. 新用户开关、LLM 摘要、语义报告分类器、全局加预算、仅为了测试保留一套旧生产分配器。

## 4. 修改设计与准代码

以下是待实施设计，**不是已验证的新行为**。参数为首轮合成验证的确定起点，不宣称已在真实会话上调优；变更须更新本计划并重跑矩阵，不能边测私人样本边无限调参。

### H1 / R1：先为最近长文本分配有上限的增量，再按原规则补全

锚点：[allocateTextRole，rank.ts:382](../../src/core/rank.ts#L382)，尤其初始化 :392、折叠 :405、升级 :447。

只在 assistant 角色内部使用以下规则：

- 在**最近 6 条非空 assistant 文本候选**中，取原文长度至少 256 单元的最近 2 条。6/2/256 是固定候选口径，不匹配“报告”“完成”等词。
- 仍以 64 为基本摘录；为这两条分配最多到 256 的优先摘录。
- 额外渲染成本总额上限：`min(384, floor(assistantQuota / 4))`，不是另加预算，也不是两条各硬给 400–600。
- 使用 CostMeter 的真实 wrap 后成本，按最新优先轮转，每次增加最多 64，最多 3 轮。零增量或负增量不收费；不拆字素。
- **在初始化最小成本及前缀折叠之前确定这些摘录下限**，而非只消费最后余额。否则饱和场景仍可能两条各 64，无法解决原稿的主要问题。
- 然后沿用“最老连续前缀折叠→便宜全文升级→最新优先步进”。有意允许多折叠若干旧旁白来换深度，不允许删掉中间单条形成隐性缺口。
- 若极窄配额连这些目标也不能保留，仍允许按既有规则折叠、返回 budget-too-small；它们是预算内偏好，不是无条件保留契约。

准代码：在原 `entries = roleCandidates.map(...)` 前建立 `minimumKeep`，原 map 中只替换 `minKeep` 的来源，其余流程复用。

```ts
const minimumKeep = new Map(roleCandidates.map(candidate =>
  [candidate.key, Math.min(candidate.sourceText.length, BRIEF_MIN_TEXT_CHARS)]
));
if (role === "assistant") {
  const targets = roleCandidates.slice(-6)
    .filter(candidate => candidate.sourceText.length >= 256)
    .slice(-2).reverse();
  let allowance = Math.min(384, Math.floor(quota / 4));
  for (let round = 0; round < 3; round++) {
    for (const candidate of targets) {
      const current = minimumKeep.get(candidate.key)!;
      const next = Math.min(256, candidate.sourceText.length, current + 64);
      const fullCost = meter.text(candidate, candidate.sourceText.length);
      const delta = Math.min(fullCost, meter.text(candidate, next))
        - Math.min(fullCost, meter.text(candidate, current));
      if (next > current && delta <= allowance) {
        minimumKeep.set(candidate.key, next);
        allowance -= Math.max(0, delta);
      }
    }
  }
}
```

原 `minKeep = Math.min(length, BRIEF_MIN_TEXT_CHARS)` 改为 `minimumKeep.get(candidate.key)!`。**每次借额/重试均依当次 quota 重算**；不缓存跨 quota 的分配结果，不改 CostMeter 的输入键含义。

这里的 quota 是本次 `allocateTextRole` 调用收到的角色额度：初次来自 bodyBudget 的 30%，借额调用来自 `assistantAlloc.used + unused`，结构重试会重新调用整个 allocateOnce（rank.ts:751–757、:774–781、:825–835）。准代码必须放在函数内部，因此每次调用都会重算，不是初次 600 配额算出 allowance=150 后一直沿用。初始化完毕后，marker 仍由原折叠流程计费；最终结构超额仍交给原累计重试。任何一轮都不保证目标保留到 256。

取舍：不要求旧旁白保留数不下降；要求新增折叠有正确标记、目标文本深度能被量化。256 仍是头尾总量，不能写成“报告前 256 字”。

### H2 / R2a：有结果就提供中性导航，不把无错误当成功

锚点：[renderToolCandidate，brief.ts:771](../../src/core/brief.ts#L771)。复用 [pairToolResults，brief.ts:579](../../src/core/brief.ts#L579) 的现有配对和已有 resultIndex，不新增文本配对规则。

把只在 error 分支输出结果的后缀改为：

```ts
const evidence = tool.observedError
  ? tool.resultIndex != null
    ? ` {error observed; result #${tool.resultIndex}}`
    : " {error observed}"
  : tool.resultIndex != null
    ? ` {result #${tool.resultIndex}}`
    : "";
return `* ${tool.name}${nav ? ` ${nav}` : ""}${ref}${evidence}`;
```

适用所有**最终入选**且已有配对结果的工具行，包括 codemode 和直接工具；不只给最近 N 条，避免再增加一套展示状态。尚未返回结果、结果不在有效历史内或索引缺失时，不补猜测编号。

short/normal 两种行都计入后缀成本：现有 `toolCost → renderToolCandidate` 链在选择前测量 wrap 后长度（rank.ts:326–327），最终组装复用同一 renderer，不能选完后再追加。更多结果引用可能减少可展示工具数，这是明确取舍；不把 `result #N` 叫作“成功引用”，结果不完整仍只表示存在该保存记录。

### H3 / R2b：直接工具的有限通道必须覆盖最终收缩

锚点：[allocateToolRole，rank.ts:493](../../src/core/rank.ts#L493)，初选 :506–525、升级 :526–533、标记驱逐 :544–561。复用已有 codemode 名称判定，不解析命令猜测是否“验证”。

顺序规定：

1. 保留当前错误初选通道 `floor(toolQuota * 0.2)`，记录由此入选的 key 集合。
2. 从 tool 候选中按 order 取最近 2 个非 codemode 直接调用；已入选的去重，其余用总计 `floor(toolQuota * 0.2)` 的直接工具通道尝试 short。两通道未花额度返回同一池，不额外保留空配额。
3. 其余候选仍按现有 score/recency 填充，剩余钱才升级 normal。
4. 省略标记导致超额时，**先把可节省成本的 normal 降回 short**，再删行；删行顺序为普通入选行→直接通道行→错误通道行，各层按低分先删并固定同分顺序。
5. 每次降级/删除重算 marker、omitted 和成本。收缩阶段禁止重新升级或重新选入：每轮要么减少一个 normal，要么减少一个 selected，因此操作数有界；不要求 marker 字符数单调减小。若仍放不下，允许通道行被删；正确预算和真实省略标记优先于任何保留目标。

不承诺“最近直接调用永远可见”。验收前提是：目标行能进入各自的初选通道，并且错误通道实际入选行、目标直接行及按最终 omitted 集合重算的省略标记合计可容纳；否则记录降级原因。直接工具标记只是候选来源，不意味着执行成功或有 exitCode。

**范围限定**：用户 bashExecution 继续走 user 文本规则，不消耗这个通道；审计必须另计。错误初选策略不变，但最终收缩变得优先保护通道，属于本版有意的行为变化。

### H4 / R3：把来源提醒放到历史 header 前，不动历史文字

锚点：[compileWithEffectiveHistory，summarize.ts:394–404](../../src/core/summarize.ts#L394)。在旧 header 合并完成之后、wrap 与 header 裁剪之前加入一行：

```ts
const HEADER_CONTEXT_NOTE =
  "Historical headers: user intent and recorded file operations, not current state or a verified diff.";
const annotatedHeader = headerText
  ? `${HEADER_CONTEXT_NOTE}\n${headerText}`
  : "";
const trimmedHeader = trimHeaderToBudget(wrapLongLines(annotatedHeader), headerCap);
```

其余含义：

- 仍保留 `[Session Goal]`、`[Files And Changes]` 等真实章节名；不把提示加入 HEADER_NAMES 或 details.sections。
- 提示是 header 成本的一部分，挤占原 20% 内空间，**不是预算外附加**。它独立于末尾 HISTORICAL_NOTE，后者保持 395。
- `sectionLineCounts` 的裁剪前输入相应改为 annotatedHeader；统计整体省略行时承认提示也占一行，但提示不算新章节。
- 空 header 不显示提示；极窄 header 按原裁剪规则可只剩提示/省略标记，此时 headerNames 必须依实际完整标题返回，不冒报章节。
- 提示位于第一个标题之前。下一次读取旧摘要时 `sectionOf` 只提取各已知章节，不将前导提示带入章节；新路径重新加一次。必须测试 0.1.4→0.1.5→0.1.5 以及新→旧路径，不能只靠一次渲染判断无累积。

这是**来源降级**而非状态纠正。原目标去重、8 行上限、fileOps 合并、context edits 的来源边界均不变。真实 diff 应由接任者在获得相应操作授权后另行检查，压缩器不代做。

### H5 / R4：持久化真实预算，指标来自最终分配

锚点：[PiVccCompactionDetails，details.ts:4](../../src/details.ts#L4)、[before-compact.ts:865–881](../../src/hooks/before-compact.ts#L865)。在原有历史 codemode details 条件分支内新增可选字段：

```ts
briefBudget?: {
  charsPerToken: number;
  historyBlockCount: number;
  maxChars: number;
  usedChars: number;
  reservedChars: number;
};
```

赋值分别来自 `tokenEstimate.charsPerToken`、`briefHistoryBlockCount`、`detail.budgetChars`、`detail.usedChars`、`detail.reservedChars`。既有 messageCount 继续表示消息数，不改名或改语义；引用空间 version 继续是 2。旧记录缺少该字段时，研究报告必须写“预算未知”，不能倒填推测值。

扩展现有 `BriefSelection.counts` / `BriefPlanDetail.counts`，使用最终 keep/selected/omitted 的实际结果，而不是只记初选：

| 指标 | 精确定义及用途 |
|---|---|
| 最近长文本目标数与保留量 | H1 同一选择口径，逐目标记首/尾实际保留单元及原长；折叠为 0。不称“最终报告保留率”。写入公开报告时仅汇总分布。 |
| 未标错已配对结果导航 | 分母为有效历史中有 resultIndex 且无 observedError 的 tool 候选；分子为最终有结果后缀的入选候选。另列错误结果导航数。 |
| 直接工具入选与省略 | 非 codemode tool 候选的总数/最终行数；bashExecution 单列，不能把两者相加当同一工具配额。 |
| 通道降级 | 初选进入通道、最终仍保留、因最终预算被移除的数量；不能用初选数量冒充最终覆盖。 |
| 预算账 | 实际字符率、消息数、normalize 块数、总上限、note/header/body/separator 成本、最终 summary.length。 |
| 深度换广度 | user/assistant 折叠数、源文本保留单元、tool 入选数、mutation/error 导航、header 裁剪量的基线差。 |

审计先不做“goal 重复字符数”和“状态年龄”自动分类：缺乏来源映射/状态定义时，模糊字符串重叠或距首消息条目数容易产生虚假精确性。可另行做明确标注的合成实验。

脚本的 [compact-all 视图，codemode-brief-audit.ts:550–576](../../scripts/codemode-brief-audit.ts#L550) 不是某次真实 hook 的等价重放。扩展指标时保持区分：固定候选实验、固定编译输入实验、完整 hook 重放。不得把前三者的预算分母混用。

## 5. 冻结 golden 的处理：实施前必须过的审阅门

[allocator-golden.json](../../tests/fixtures/allocator-golden.json) 现有 242 个记录是旧行为基线，3 个空文本记录已由 0.1.4 的 amended 注明；当前 SHA-256 为 `a888b1be00e0426635b8e991ac0c6b50bbe8845cf69743f538b05da210999eb5`。

**不能同时要求“改变原输入的分配结果”和“242 个结果全部仍与旧值相等”。** 也不能为守住表面绿灯，让 golden 只调用生产不再使用的 legacy 模式。

建议的 0.1.5 验收规则：

1. **原 fixture、原输入生成器及 generatedFromCommit 全部冻结，不重生成、不改 amended。** 0.1.4 的例外不是本版批量改基线的先例。
2. 先逐项运行 H1/H2/H3 的隔离差异实验，得到实际受影响 id 与原因；本计划不预言数量。
3. 对无预期变化的记录继续执行原精确断言；对有意变化记录，另建一份**经逐项审阅的 0.1.5 差异清单**，含原 id、关联 H 编号、基线/新成本、引用/折叠/文本摘要差异及原因。需要固化文本或哈希时写入独立的新预期，不覆盖原值。
4. 新预期须有独立的预算/引用/顺序/收益断言支撑，不允许把实际输出自动复制成期望后宣称通过。新增指标造成的 counts 差异也要记录，不能整体忽略 counts。
5. 原病例集合不得缩小；最终每条仍有明确的结果断言。多一个未登记差异、少一个病例、原 fixture 哈希变化，立即阻断。
6. **这个测试契约调整需在实施前得到明确认可。** 本次写计划不视为已获认可；若仍要求旧输出 242/242 逐字相同，则暂停 H1/H2/H3，不以测试分支、环境开关或复制旧实现规避。

该门是针对有意的行为升级，不是放宽偶发失败。通过后还需验证新生产路径，而不是仅验证差异清单读取逻辑。

## 6. 静态核验及风险收敛

| 片段 | 已核验的落点/关系 | 风险和实现门 |
|---|---|---|
| H1 | allocateBriefBudget→allocateOnce→allocateTextRole；CostMeter 已支持不同 keep 的实际成本 | 较高：改变折叠边界、借额重算、原 golden。预算扫描与“长文本深度/旧文本广度”对照通过前不视为闭环。 |
| H2 | buildBriefCandidates 已保存 resultIndex；renderToolCandidate 同时被 toolCost/最终组装使用 | 中：新增后缀降低可容纳行数；须测 0 索引、缺索引、跨 assistant 重用 id、错误与 incomplete。 |
| H3 | allocateToolRole 在入选后才计 marker，当前会驱逐低分通道行 | 较高：不能只插入一个 reserve；降级、删除、marker 和最终统计必须一起闭环。 |
| H4 | mergeHeaderParts→headerText→trimHeaderToBudget→detail.headerNames | 中：新增固定成本；需要窄 header、重复压缩、新旧切换，不能靠字符串包含断言取代章节精确检查。 |
| H5 | hook 已取得真实字符率、块数与 detail；details 的本地直接引用已文本检索 | 低至中：新增持久化字段只记录实际值；尚未对外部消费者做穷举，不能承诺所有外部工具兼容。 |

本次图索引 generation 为 `2026-10-27T23:35:18Z`，状态 ready；依赖源码路径覆盖检查未报告解析缺口，但 freshness 为 metadata_changed，所以行号与结论按本次当前源码读取校正。图用于定位，不作为“完整覆盖”证明。

**本节只证明修改位置与设计约束已核对，不证明所有准代码已通过实现验证。** 用户批准实施后，按既定流程对每个实际 hunk 再做双向调用、精确片段和覆盖核验；H1/H3 的动态风险及 §5 的验收契约仍是实施门。

## 7. 状态迁移与验收矩阵

| ID | 当前状态 / 触发 | 修改后的预期观察 | 对应 |
|---|---|---|---|
| T01 | 饱和 assistant：18 条短旁白+2 条长文本 | 在给定合成预算下，两条均超过 64；允许旧前缀折叠，标记与引用正确 | H1 |
| T02 | 0/1/2 条目标；最近 6 条内/外；255/256 单元边界 | 目标集合完全依位置/长度；不凭“完成”“报告”加权 | H1 |
| T03 | 预算很窄、仅 user、仅 assistant、无目标 | 有界退化；user 内部分配不因 H1 改写；无目标时不预留空钱 | H1 |
| T04 | 后续借额、结构重试、成本因去掉省略标记反而下降 | 按当轮配额重算、实际成本入账、无超限和死循环 | H1 |
| T05 | 正常配对结果，含 resultIndex=0 | short/normal 均为中性 result #N；没有 success/verified 暗示 | H2 |
| T06 | 观测错误、有/无配对结果、nested incomplete | 错误标记不被注解盖过；不完整结果也不冒充成功 | H2 |
| T07 | 相邻 assistant 重用调用 id、多个并行调用、结果在 live tail、索引缺失 | 沿用有效历史内的正确配对；不从其它消息或未来取结果 | H2 |
| T08 | 大量高分 codemode + 最近直接 bash/read | 可容纳时出现近期直接 short 行和真实结果导航 | H3 |
| T09 | 最近直接工具也是错误工具 | 不重复收费、不重复输出；错误通道身份优先 | H3 |
| T10 | normal 行升级后 marker 超额 | 先降 short，再按层删除；没有 marker 成本漏算 | H3 |
| T11 | 通道行和 marker 本身也无法共存 | 允许明确退化；不保证绝对保留、不伪造范围 | H3 |
| T12 | bashExecution 与 bash toolCall 同时存在 | 前者仍按 user，后者按 tool；统计分母分开 | H1/H3 |
| T13 | 0.1.4 首次转 0.1.5，再压缩两次 | 前导 header 提示每轮最多一次；末尾 HISTORICAL_NOTE 仍一次、395 不变 | H4 |
| T14 | 压缩前“未提交”，之后 live 中提交；再压缩 | 不回写旧声明为“已提交”；新的报告进入正常候选，历史来源提示保留 | H1/H4 |
| T15 | 空 header、header 仅提示、标题被截断、正文伪造章节名 | details.sections 仅含真实完整标题；空结果仍空数组 | H4 |
| T16 | 上轮有 header、本轮没有新 header；随后新路径切旧路径 | 不继承多份提示、不将提示当正文或文件路径；旧路径自身格式不主动加提示 | H4 |
| T17 | context edits 删除早期 codemode 或目标；edited checkpoint | 保持原历史门控与有效来源，不因新优先级复活已删消息，limited note 规则保持 | 全部 |
| T18 | missing-history | 保持当前实际门控/返回，不假设该原因必然进入 codemode limited 分支 | 全部 |
| T19 | 首次/再次压缩，消息数≠块数；旧条目缺预算字段 | 新字段精确反映当前预算；旧字段语义不变，旧记录不倒填 | H5 |
| T20 | 有无实际 codemode 历史、当前 active tools 改变 | 历史门与提示门仍独立；纯非 codemode 生产输出与 0.1.4 逐字相同 | 全部 |
| T21 | 脚本通过 bash 修改文件、文件操作返回 error | 不新增猜测文件/成功状态；提示明确非 verified diff | H4 |
| T22 | read/range/scan/default recall 同一保存记录 | #N 空间、原文和正常结果逐字不变 | 全部 |
| T23 | Unicode 字素、超长单行、缺索引、同分工具、大候选数 | 不拆字素、不制造编号、不使用大数组 spread min/max，排序可重复 | 全部 |
| T24 | 冻结的 242 个原病例，外加独立新行为测试 | 原 fixture 哈希和原 242 个 id 集合不变；原病例仅允许审阅清单中的输出变化，新测试另行增加 | R5 |

预算矩阵至少覆盖字符率 `2 / 4 / 6`，块数 `1 / 73 / 74 / 133 / 134 / 1000`，以及 header 有/无、limited note 有/无；在关键 marker/摘录临界点按单字符扫描窄带。73/74 和 133/134 分别覆盖 1100 floor 与 2000 ceiling 的转折。

成功且非空的完整编译必须同时满足：

```text
summary.length <= detail.budgetChars
summary.length == detail.usedChars + detail.reservedChars
header.length <= headerCap
所有系统生成 #N 都能回到对应保存条目
```

仅检查“引用能解析”不够，H2 还要核验它确实属于该调用。budget-too-small/空输入另断言，不强套非空等式。

## 8. 研究方案与发布门

### 8.1 本次可复现的合成基线

使用现有 buildBriefCandidates/allocateBriefBudget：18 条长度约 91–92 的 assistant 短文字，随后两条长度 2,560 与 3,973 的长文字；引用 0–19，未添加 user/tool，reservedChars=0。

| maxChars | 当前 usedChars | 短文字全文数 / 折叠数 | 两条长文字可见单元 |
|---:|---:|---|---|
| 1,900 | 1,869 | 16 / 2 | 64 / 64 |
| 2,000 | 1,999 | 18 / 0 | 64 / 64 |
| 2,100 | 2,063 | 18 / 0 | 64 / 128 |
| 2,200 | 2,191 | 18 / 0 | 128 / 192 |

这证明原机制可复现长文变薄，也证明“总是只剩 64”不成立。它是候选分配实验，**不是原 400K 会话重放**。H1 的首个收益门：在 2,000 预算同一输入上，两条均至少 128，且不超额；首轮设计目标是每条可到 256，实际值须在实现后记录，不能预填通过。

### 8.2 分离改动归因

固定同一输入分别比较：0.1.4、仅 H1、仅 H2、H2+H3、仅 H4/H5、完整 0.1.5。完整版本必须重新计算 header、候选、成本和借额，不能把各分项“省了多少字”直接相加。

H4 的提醒增加成本，H2 的后缀也增加成本；不能预设它们与 H1 叠加后仍保持单项收益。最终发布门以**完整版本**为准：同一受控长会话中目标报告深度仍改善、直接调用导航确实存在，且用户约束、错误导航的退化有明确边界。

### 8.3 真实会话研究：可选但不能冒充已做

- 原会话若获准用于本地研究，固定活动分支、切点、保留 tail、previousSummary、sourceIndices、fileOps、设置、实际字符率和有效历史；比较完整生产 hook，不仅 compact-all。
- 另建至少两轮压缩场景，区分“压缩前事实”“压缩后 live 变更”“第二次摘要”。原稿只有一轮，不能拿它替代此实验。
- 报告匿名聚合：正/零/负收益会话数、目标摘录分布、结果/直接工具导航、用户保留量、错误/修改操作导航、预算、header 裁剪、耗时。
- 私人会话中的“最新长文本”只能算位置代理指标；要评价接任任务是否更好，需要另做人工任务实验。不得把摘要字符指标换算成任务成功率。
- 无私人语料不阻塞确定性修复；但发布说明只能声称合成场景通过，不得声称“解决所有 400K 续接问题”。

## 9. 实施顺序、停止条件与发布准备

1. **冻结基线与验收契约**：确认工作区、原评审、原 fixture；先认可 §5 的差异审阅机制。修改现有文件前获准并按项目规则备份至 git-ignored `research/.backup/`，不得放入发布源码树。
2. **先建立失败用例与预算账**：将 §8.1 转为确定性测试；补 H2/H3/H4 的边界案例。先做 H5 的记录接线，证明仅加元数据不改变摘要。
3. **独立实施 H2，再 H3**：先中性结果导航，再直接通道及最终收缩；各自产生差异清单，不混入文本优先级。
4. **独立实施 H1**：固定初始参数完成饱和场景、预算扫描和借额测试；若收益不足，返回本节设计，不通过放大总预算解决。
5. **实施 H4 并跑完整组合**：验证提示成本、重复压缩和门控；完整组合未通过，不能用某个单项成功替代。
6. **完成图/源码核验、动态调试与测试矩阵**：按项目变更流程逐片段检查；针对 T04/T07/T10/T17 记录调试中的当前→目标状态。修复失败后回到对应设计/矩阵，不旁路断言。
7. **兼容与包体**：在 Pi 1.4.0 锁定宿主及隔离副本的 Pi 1.0.0 上运行 typecheck、全测试；脚本另做类型/合成运行检查。原 `bun run typecheck` 的入口只有 index.ts，不代表脚本和测试全量已静态检查。
8. **文档与版本**：README 说明新结果后缀、有限优先级、深度/广度取舍和历史来源；CHANGELOG 先记 `[Unreleased]`，保留 0.1.4 历史记录。版本与日志最后准备成 0.1.5；若需更新项目规则，只记录本版已批准的分配/验收契约，不扩权限。
9. **重新建索、人工交付**：实施完成后重新索引并确认新代；交付自动化矩阵和未测项。提交、tag、推送、npm 发布及安装切换另获授权。

常规检查：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test
npm pack --dry-run --json --ignore-scripts
```

兼容测试优先在隔离副本切换宿主；必须核对实际版本，必要时用 frozen lock 恢复。包体按允许/禁止项检查：包含入口和所需源码，不含 `*.bak`、research、tests、docs，不用固定文件数量代替检查。

**立即停止并返回对应设计的情形**：预算超限、配错引用、把未标错写成成功、有效历史删除内容复活、纯非 codemode 输出非预期变化、原 fixture 被改、未登记 golden 差异、完整组合无确定性收益、性能明显退化却尚未解释。不要靠重生成快照、跳过测试或缩小测试集合解决。

人工验收：在明确授权的测试会话中，制造“长报告→直接验证调用→压缩→live 状态变更→再次压缩”；确认能从中性 result 引用读回正确记录、历史 header 不被当作当前状态、最新消息仍承担状态更新。TUI 与无界面模式分开记录实际验证情况。

## 10. 本次交付的验证状态

**已完成**：

- 完整审阅原稿，核对本计划所依赖的源码机制及图路径覆盖；未照搬旧图的过时行号。
- `bun run typecheck` 通过。
- 6 个定向文件：brief、rank、allocator-golden、brief-history、before-compact-hook、context-edits，共 **422 pass / 0 fail / 1,848 expect**。
- 合成验证：1 消息→3 块；64 单元摘录分成首尾 32+32；已配对非错误 bash 的 resultIndex=11 但当前输出仅有调用引用；§8.1 四档饱和实验。
- 保留原评审、现有工作区改动及冻结 fixture；本次只新增本计划。

**未完成，不能写成通过**：0.1.5 实现、全量/最小宿主兼容测试、修改后的预算扫描和差异清单、私人会话重放、DAP 动态调试、实际安装/TUI 人工验证及发布。0.1.4 实施记录中的 900 pass 和 97 会话重放是历史证据，不是本次重新运行的结果。

**建议决策**：接受“最近长文本深度 + 中性结果导航 + 有限直接工具通道 + 历史来源说明”的有限升级；先批准冻结基线下的新差异验收规则，再按上述顺序实施。不要把状态推断、git 文件兜底或总预算扩张顺手并入 0.1.5。
