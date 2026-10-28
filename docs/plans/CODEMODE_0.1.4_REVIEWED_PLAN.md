# pi-vcc-codemode 0.1.4 审阅意见与修订实施计划

- 日期：2026-10-28。
- 状态：**修订建议稿（第二版），尚未实施**。本文另存，不修改原计划；执行本文不等于获得提交、发布或修改本机安装的授权。
- 修订决定：**彻底放弃 B（去标签），不采用 H2（HISTORICAL_NOTE 保持原文本）**；补充 F9/F10 两项发现及对应测试。
- 审阅对象：[原 0.1.4 计划](file:///D:/geminiproject/pi-vcc-codemode/docs/plans/CODEMODE_0.1.4_PLAN.md)。原稿 SHA-256：`839505544d54fc22160219151256d63b1d48542f0bdd94401f27bf353ab68c58`。
- 代码基线：`79ffc39977720ac0a473a2fc0f34e37b34e81de0`，工作区版本为 `0.1.3`。
- 审阅方法：阅读原计划和相关源码、图索引定位与覆盖检查、定向基线测试、纯合成输入反例。**未重新测量私人会话，原稿的 n=15 数据不作为本次独立验证结果。**
- 第二版另做了项目侧复核：确认基线、定向测试数字、242 例 golden 的构成、`HISTORICAL_NOTE` 长度，以及 limited note 剥离残留（见 §10）。
- 初审稿备份：git-ignored 的 `research/.backup/CODEMODE_0.1.4_REVIEWED_PLAN.md.bak`，SHA-256 `65335d7e99d5d4d5e3dc80d1a9761fc6f2d8601ddf86f41b9aa6f729c18d1185`，与修订前文件逐字节一致。

## 1. 总体意见

**建议修订后实施，不建议按原稿直接执行。** 空引用行和章节元数据确实值得修复，但原方案的实现边界与验收口径尚未闭合。尤其是：候选过滤不能消除全部人工生成的空引用行；章节名不能直接取裁剪前的统计数组；候选层改动不能靠重生成分配器旧夹具验收。

本版采用 **A 单独：`intent:` 改为 `goal:`，保留显式目标标签**。**B（去标签）彻底放弃，不再保留为后续实验**：无标签的目标正文与 `code:` 预览存在确定性同形（`// goal: code: return 1;` 与 `return 1;` 的导航正文相同），候选重复惩罚键也使用 `tool.name + normalNav + activity`，会把不同来源并进同一组；收益只出现在预算饱和的长会话。恢复 B 需要新的计划、确定性的区分设计和独立证据，而不是“线上出现两例再回退”。

本版**不改 `HISTORICAL_NOTE`**。note 中的 `intent` 是普通英文名词（“用户/助手的文字与意图”），不是行标签；为一个词改文本需要永久保留 0.1.3 字面量和第四套剥离正则，收益只有 1 个 UTF-16 单元。历史说明剥离链保持现状。

修订后的版本定位为：**修复 D1/D3/D6，统一目标行用语，保持预算公式与召回行为不变**。“不变”指算法、参数优先级和引用空间不改，不代表候选入选集合、评分读数或摘要文本逐字不变。

## 2. 必须修改的审阅发现

### F1［高］无标签格式存在可构造的同形，不能留作“以后实验”

原稿 §9/§10 的 ≥2 例规则是**事后回退触发条件**（“若真实会话出现 ≥2 例……P1 回退为保留标签”），不是允许先发生误判；但它仍把确定性缺陷留到线上观察。目标正文可以以 `code:` 开头：

- 有目标：`// goal: code: return 1;`。
- 无目标的脚本：`return 1;`。
去掉 `intent:` 后，两者的导航正文都是 `code: return 1;`，已用合成输入复现。候选的重复惩罚还使用 `tool.name + normalNav + activity` 作为键，见 [src/core/brief.ts:722](file:///D:/geminiproject/pi-vcc-codemode/src/core/brief.ts#L722)。因此，无标签不仅可能影响理解，还会让不同来源的导航文字进入同一个去重键；若从已经生成的候选上改字符串，则又漏掉了这一评分变化。

**决定**：本版保留 `goal:`；**B 彻底放弃，不进入后续实验队列**。要恢复无标签，必须新开计划，并给出确定性的区分设计（例如只在可能同形时保留标签），不能用“线上出现两例再回退”作为上线条件。不能禁止用户目标正文出现 `goal:`、`intent:` 或 `code:`，测试应验证系统添加的前缀，而不是对任意正文做禁词检查。

### F2［高］`.trim()` 判空是必要修复，但不足以支持“没有空引用行”的承诺

[src/core/brief.ts:641](file:///D:/geminiproject/pi-vcc-codemode/src/core/brief.ts#L641) 确认空白 assistant 文本会成为候选；[src/core/normalize.ts:49](file:///D:/geminiproject/pi-vcc-codemode/src/core/normalize.ts#L49) 保留 text part（原稿给出的该文件行号不准确）。另一个已复现的输入是 `"\nVisible text"`：它不是空白文本，能通过 `.trim()` 检查；[attachRef:749](file:///D:/geminiproject/pi-vcc-codemode/src/core/brief.ts#L749) 把引用追加到第 0 行，仍得到独立的 ` (#7)`。

生产路径上，`filterNoise` 会用 `cleanUserText` 对 user 文本执行 `.trim()`，因此前导换行/空白 user 文本通常到不了候选；**assistant 文本才是生产可达路径**。渲染层仍应加固，以覆盖直接调用 `buildBriefCandidates` 和未来生产者。

**修订**：候选层过滤纯空白 assistant；渲染层把引用附在第一个非空白行，不裁掉用户的缩进和换行。删掉“角色头后不允许紧跟空行”的全局不变量，避免为了美观改写正常正文。承诺限定为“不再由本次渲染逻辑制造孤立引用”；用户原文自己写出的 `(#7)` 不应被删除。

原稿“tool 行仍在用 attachRef”的理由也不准确：当前唯一调用是 `renderTextCandidate → attachRef`（brief.ts:757–774），工具行由 `renderToolCandidate` 自行添加引用。

### F3［中］过滤候选同时影响近期评分，不能把全部变化解释成借额

[buildBriefCandidates:693](file:///D:/geminiproject/pi-vcc-codemode/src/core/brief.ts#L693) 根据候选数组位置计算近期权重，还用 `r >= 0.75` 判断 blocked 加分。删除空白候选会改变这些位置。

合成输入中，四个工具的分数在移除两个空白候选前后分别为：

```text
[18, 25, 28, 30] → [18, 22, 26, 30]
```

这组具体数字依赖作者的合成输入；可复现的是机制（数组位置与长度决定 `r` 和连续惩罚），不是这组值本身。

**修订**：保留现有评分公式和借额规则；在 P2 消融中分别记录候选数、工具分数及保留量。不把工具行变化单独归因为 assistant 借额，也不因工具总行数下降就把配额重构并入本版。

### F4［高］P3 必须覆盖“裁剪后”“旧摘要合并后”和“空结果”

[src/core/summarize.ts:390](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L390) 的 `headerSections` 按裁剪前的 `before` 选章节；已整体裁掉的章节仍可能存在于统计数组。不能直接 `.map(s => s.name)`。

[compileWithBriefBlocks:313](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L313) 当前只返回字符串；[legacyDetail:423](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L423) 不带旧路径的实际章节信息。原稿没有写清数据如何回流。

[mergePrevious:263](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L263) 会保留上次摘要的章节，例如本窗口无提交、旧摘要仍有 `[Commits]`。只看本轮 `SectionData` 会漏报。

summarize.ts:416–420 的空结果必须对应空章节数组；不能留下本来准备渲染但最终没有输出的章节名。

**修订**：新路径从最终裁剪后的专用 header 获取已知章节；旧路径从实际合并结果返回章节名；编译结果统一携带该数组。debug 与持久化 `details.sections` 共用同一份数据。

`version: 2` 应保持不变，理由不是“没人读它”，而是 [src/hooks/before-compact.ts:867](file:///D:/geminiproject/pi-vcc-codemode/src/hooks/before-compact.ts#L867) 明确把版本定义为 **`#N` 引用空间版本**。本次不修改引用空间。外部消费者不能靠仓库检索排除，但也不应为了假设中的消费者继续生成错误字段。

### F5［高］原稿的最小复算骨架不是生产压缩的等价重放

对照原稿附录 E 与 [src/hooks/before-compact.ts:778](file:///D:/geminiproject/pi-vcc-codemode/src/hooks/before-compact.ts#L772)，至少有以下差异：

1. hook 用未经过 `filterNoise` 的 `normalize(history).length` 算预算；骨架用过滤后长度。
2. 骨架给编译器传空 `messages`，也不传 `previousSummary`、真实文件操作和命令配置。无编辑时 header 为空（`headerBlocks` 是空 `blocks`）；有编辑时 header 改从有效历史生成，但仍不是生产的 previousSummary 合并路径。因此骨架只能覆盖“有效历史自建 header”的一半，不能把 `detail.reservedChars` 当作生产的 header 成本。
3. 文件最后一条 compaction 不必属于重放的活动分支；应先沿 parent 链恢复分支，再选切点。
4. P2 如果只过滤已构建的候选，就不会重新计算 F3 的评分。
5. note 变化会影响 header 的 20% 上限，因此简单做 `reservedChars + noteDelta` 也不是完整重编译。

现有 [scripts/codemode-brief-audit.ts:550](file:///D:/geminiproject/pi-vcc-codemode/scripts/codemode-brief-audit.ts#L550) 明确采用 compact-all 视图；这不能直接称作“复现某次实际压缩”。

**修订**：将三种研究分开命名：固定候选的字符成本实验、固定会话快照的编译对照、完整 hook 重放。只有第三种可以声称与生产切点和输入契约对齐。前两种在同一固定口径下仍可用于相对比较，但不能引用其 `reservedChars` 作为生产值。

### F6［高］不要重生成现有 242 例 golden 来“接受”候选层改动

[tests/support/allocator-cases.ts:56](file:///D:/geminiproject/pi-vcc-codemode/tests/support/allocator-cases.ts#L56) 直接构造候选，工具导航是人工的 `normal: ...`；[tests/allocator-golden.test.ts:39](file:///D:/geminiproject/pi-vcc-codemode/tests/allocator-golden.test.ts#L39) 直接调用分配器。原稿 P1 的前缀变化和 P2 的候选过滤不经过这个输入生成过程。

项目侧复核还确认：fixture 的 242 个 id 唯一、`generatedFromCommit` 为 `a59fdad`，fixture 文本中 `codemode` 出现 **0 次**。因此原稿“重生成后 diff 只应出现前缀变化 + 空引用行消失”在原理上不可能成立。

**修订**：冻结 [现有 golden 夹具](file:///D:/geminiproject/pi-vcc-codemode/tests/fixtures/allocator-golden.json)，保留其性能优化前后的等价性职责；候选构造、引用位置和编译链另加合成测试。任何旧夹具失败都要先定位，不允许先重生成让测试通过。`generatedFromCommit` 表示生成来源，不应强制等于每次测试时的 HEAD。

对新端到端测试，也不能要求“diff 只有前缀和空行”：预算重新分配后，入选引用、折叠范围和摘录长度都可能发生合法变化。

### F7［中］P5 的动作文案必须来自最终解析结果，并处理 invalid

[RecallAction:8](file:///D:/geminiproject/pi-vcc-codemode/src/core/recall-request.ts#L8) 包含 `invalid`，不是只有正常查询。合成输入（先 normalize，再 parse）验证：

| 输入 | 最终动作 |
|---|---|
| `mode:"scan", query:"q"` | search |
| `mode:"scan"` | recent |
| `mode:"scan", cursor:"abc", query:"q"` | invalid |
| `mode:"scan", scan:true, query:"q"` | scan |

**修订**：使用 `action: <最终动作>`，不要把 `mode:"scan"` 一律描述成已经跑了 hybrid query。明确 `mode:"scan"` 的纠正方式是 `scan:true` 配合 query；invalid 文案写明没有执行检索。动作标签说明选择了哪条执行路径，不保证它成功找到结果。

新增的 `; action:` 会改变 ignored-only 与 dropped-only 的既有输出形状：现有 [tests/recall-request.test.ts:18](file:///D:/geminiproject/pi-vcc-codemode/tests/recall-request.test.ts#L18) 和 `:36` 是精确相等断言，必须同步更新；`:72` 与 [tests/recall-range.test.ts:144](file:///D:/geminiproject/pi-vcc-codemode/tests/recall-range.test.ts#L144) 使用 `startsWith`，但仍应补上动作断言。`IGNORED_REASON` 的空字符串目前在模板里会产生 ` ()`；H8 的守卫写法会顺带修掉，应列为验收点。

### F8［中］收益门、文档维护和发布门需要收敛

- 原稿的 +5% 是同一批 15 个筛选会话上的 P1 范围决策，不是正确性发布门；短会话不在该比例的分母里，二者不矛盾。B 放弃后，该回退条件不再适用，本版不设覆盖率收益门。
- `medianRatio >= 0.98` 是占用诊断；删除空白候选后余额会被重新分配，是否下降未被测量。不要把它当正确性门。
- 原稿已把 note 的 +1.0pp 限定在 4400 字符 floor；引用时保留这个限定。本版不改 note（H2 不采用），note 仍是 395，不涉及 +44 算术。
- 预算是 `clamp(15 × blocks, 1100, 2000)` 的 token 估算值，再乘字符率，不是“15 字符/块”。名义上限在 134 块时触及，不因字符率变化而变成另一块数。
- 原实现已先截取 80/200 字符的目标正文，再添加前缀；长目标同样会因缩短前缀而减少未 wrap 字符成本，不能说“只有短目标能省前缀”。最终能多留几行仍由分配器决定。
- [CHANGELOG.md:26](file:///D:/geminiproject/pi-vcc-codemode/CHANGELOG.md#L26) 是已发布的 0.1.3 Known issues 记录。不要把该版本的 Known issues 搬走，造成旧版本似乎已经修好的假象；新增 `[Unreleased]` 说明修复，发布时再定为 0.1.4。
- 发布后安装状态不能混进发布前确定性门；文件数量“约 50”与存在 `CostMeter` 都不能证明运行的是本版修复。

### F9［中］`sectionOf` 在整篇摘要上找标题，正文可冒充章节

[src/core/summarize.ts:92](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L92) 的 `sectionOf(text, header)` 用 `text.indexOf("[Header]")` 在**整篇**旧摘要上查找，包含第一个 `\n\n---\n\n` 之后的 brief 正文；[mergePrevious:265](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L265) 和 [mergeHeaderParts:297](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L297) 都用它读取 `prev` 和 `fresh`。

因此，旧摘要（或新摘要）的 brief 正文中若有一条 column-0 的 `[Commits]` 行，而 header 里没有 Commits，`mergeHeaderSection` 会把它当成章节合并，H5 的 `headerNames` 也会把它报成真实章节。用户正文不裁剪、可保留 column-0 行，所以这是可达的。

**修订**：`sectionOf` 先截到第一个分隔符之前，只在 header 区查找。该修改会改变这种病态输入的输出，必须作为独立修复和独立测试，不放进 P3-only 的逐字等价窗口。测试覆盖 `prev` 与 `fresh` 两种来源。

### F10［中］`stripKnownNotes` 漏掉 `LIMITED_HISTORY_NOTE`

[src/core/format.ts:80](file:///D:/geminiproject/pi-vcc-codemode/src/core/format.ts#L80) 的 `LIMITED_HISTORY_NOTE` 被追加在有限历史的新路径摘要末尾（[summarize.ts:381](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L381) 的 `HISTORICAL_NOTE + "\n" + LIMITED_HISTORY_NOTE`），但 [stripKnownNotes:486](file:///D:/geminiproject/pi-vcc-codemode/src/core/summarize.ts#L486) 只剥离 HISTORICAL、LEGACY 和 RECALL，没有对应的 limited 正则。

项目侧用当前剥离链原样复现：剥离后残留 `history limited by edited checkpoint; use recall`。新路径把剥离结果只用于 `mergeHeaderParts`，残留不在 header 区，基本无害；但下一次若切换到旧路径，`briefOf` 取第一个分隔符之后的全部内容，`mergeBriefTranscript` 会把它当 brief 正文保留（`preserveFreshBrief` 分支还会保留 prev 尾部），T14/T15 的路径切换场景会命中。

**修订**：在 `stripKnownNotes` 中增加 `LIMITED_HISTORY_NOTE_RE`，并覆盖未 wrap/已 wrap 的 limited note、新路径与旧路径切换。该修复不改变任何 note 文本，独立于已放弃的 H2；它同样保护 0.1.3 时期可能已有的 limited 摘要。

## 3. 修订后的范围与决定

| 项目 | 本版决定 | 验收重点 |
|---|---|---|
| P1 → R1 | 必做；只采用 A（`intent:` → `goal:`）；B 彻底放弃；不改 note | goal/code 区分、说明迁移、原文截断上限不变 |
| P2 → R2 | 必做；过滤空白候选并修正文本引用附着位置 | 纯空白、前导换行、缩进、引用稳定 |
| P3 → R3 | 必做；返回最终章节名，覆盖新旧编译分支；含 F9 的 header 区收窄 | 合并、裁剪、空结果、hook 元数据一致 |
| P5 → R4 | 必做；动作标签与 scan 纠正提示 | search/recent/invalid/scan 等实际分派、既有文案更新 |
| P6 → R5 | 必做确定性合成测试；真实语料度量不阻塞发布 | 无私人会话也能重现缺陷与修复 |
| P4 → R6 | 必做；文档、版本、包体与安装身份 | 不改历史发布记录，不误发布备份 |
| F10 → R7 | 必做（小改动）；剥离 LIMITED_HISTORY_NOTE | limited note 不残留、路径切换 |

本版不做：B/CMI（B 不再是后续实验）、H2（note 文本保持 395）、预算与借额重构、召回排序调整、新设置项、`// blocked:` 提示规则、`-p` 输出通道改造、`#N` 空间变化。D5 的“宿主能力不足”仍需专门核验，不能从一次 stdout 为空直接推出插件必然无实现途径。

不新增生产代码中的审计框架，不为了本版改动自动搬迁或重建旧 golden 生成器。原 P6 的脚本指标扩展可在复现口径固定后独立处理，不能充当本版修复已通过的证据。

## 4. 实施方案与准代码

以下锚点均针对上述基线。代码为预定修改片段，不表示已经应用；实施时若接口不符，先修订本节再改代码。

### H1：R1 目标行保留标签

目标：[src/core/brief.ts:657](file:///D:/geminiproject/pi-vcc-codemode/src/core/brief.ts#L657)。两个 goal 分支的表达式分别改为：

```ts
? `goal: ${firstCharsEllipsis(intent, BRIEF_SHORT_NAV_CHARS)}`
```

```ts
? `goal: ${firstCharsEllipsis(intent, BRIEF_INTENT_CHARS)}`
```

保留 code 分支、toolNavText、常量数值、错误标记和工具名。更新已有 `BriefToolView` 注释中的前缀示例，不顺带重命名内部变量和常量。

最终形状：

```text
* codemode goal: <目标正文> (#N)
* codemode code: <代码预览> (#N)
* codemode (#N)
```

第三行仅适用于 goal、code 和其它可展示参数导航都为空的输入，不能把“无脚本”笼统等同于“必定只剩工具名”。旧路径的 [src/codemode/summary.ts:77](file:///D:/geminiproject/pi-vcc-codemode/src/codemode/summary.ts#L77) 不修改。旧编译入口也可能直接收到 codemode 消息，因此不再把它称为“只有无 codemode 历史才可能调用”的路径。

**B 不采用**：不要把 `goal:` 前缀再删掉，也不要在文档里保留“以后可能去标签”的承诺。T03（goal 正文以 `code:` 开头）是锁定该决定的回归测试。

### H2：R1 说明文字——明确不采用

`HISTORICAL_NOTE` 保持原文本（395 个 UTF-16 单元），不新增 `HISTORICAL_NOTE_013`，不增加第四套 note 正则。

理由：note 里的 `intent` 是普通英文名词，不是行标签；改一个词需要永久保留 0.1.3 字面量，收益只有 1 个 UTF-16 单元。历史说明的剥离链（HISTORICAL、LEGACY_HISTORICAL、RECALL）保持现状；limited 变体的缺口由 H9 单独处理，不依赖 note 文本变更。测试继续钉住当前 note 文本和 395 长度，防止后续无意改动。

### H3：R2 空白过滤与引用附着

目标：brief.ts:640–645、749–754。

```ts
if (block.kind === "assistant") {
  if (!block.text.trim()) return;
  candidates.push({
    key: `${order}:assistant`, order, role: "assistant",
    sourceIndex: block.sourceIndex, sourceText: block.text, score: 0,
  });
  return;
}
```

```ts
const attachRef = (text: string, sourceIndex?: number): string => {
  if (sourceIndex == null) return text;
  const lines = text.split("\n");
  const firstTextLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstTextLine >= 0) {
    lines[firstTextLine] = `${lines[firstTextLine]} (#${sourceIndex})`;
  }
  return lines.join("\n");
};
```

不修改 normalize，不把 `.trim()` 结果写回 sourceText，不重排 sourceIndex，不调整评分公式。toolCall/result 配对仍在原始块列表上执行。前导空行保留，但系统引用不再单独占据该行。

### H4：R3 统一章节目录与格式化结构

目标：[src/core/format.ts:162](file:///D:/geminiproject/pi-vcc-codemode/src/core/format.ts#L162)，替换手写的六次章节调用；summarize.ts:87 改为导入同一个目录。

```ts
const HEADER_FIELDS = [
  ["Session Goal", "sessionGoal"],
  ["Files And Changes", "filesAndChanges"],
  ["Commits", "commits"],
  ["Tracked Commands", "trackedCommands"],
  ["Outstanding Context", "outstandingContext"],
  ["User Preferences", "userPreferences"],
] as const;

export const HEADER_NAMES = HEADER_FIELDS.map(([name]) => name);

export const formatHeaderParts = (data: SectionData) =>
  HEADER_FIELDS
    .map(([name, key]) => ({ name, text: section(name, data[key]) }))
    .filter((part) => part.text.length > 0);

export const formatHeaderSections = (data: SectionData): string =>
  formatHeaderParts(data).map((part) => part.text).join("\n\n");
```

此处的结构化数组服务于本次实际需要的名称回传，不引入额外通用格式化框架。六个章节顺序与正文输出必须保持逐字等价。

### H5：R3 旧路径从合并结果回传名称

目标：summarize.ts:263–292、313–326、423–460。

`mergePrevious` 返回 `{ text: string; headerNames: string[] }`。其章节构造改为保留名称：

```ts
const headers = HEADER_NAMES
  .map((header) => {
    const freshSec = sectionOf(fresh, header);
    const prevSec = sectionOf(prev, header).replace(/\n[ \t]+(?=\S)/g, " ");
    return { name: header, text: mergeHeaderSection(header, prevSec, freshSec) };
  })
  .filter((part) => part.text.length > 0);
```

原 `headers.join("\n\n")` 改为 `headers.map(part => part.text).join("\n\n")`，brief 合并及 120 行处理原样保留。末尾返回：

```ts
return {
  text: parts.join(SEPARATOR),
  headerNames: headers.map((part) => part.name),
};
```

`compileWithBriefBlocks` 改为返回 `RankedCompileResult`；原有 blocks/data/fresh/prev 构造不变，末段改为：

```ts
const merged = prev
  ? mergePrevious(prev, fresh, { preserveFreshBrief: options.preserveFreshBriefOnMerge })
  : { text: fresh, headerNames: formatHeaderParts(data).map((part) => part.name) };

if (!merged.text) return { summary: "", detail: legacyDetail([]) };
return {
  summary: wrapLongLines(merged.text + SEPARATOR + RECALL_NOTE),
  detail: legacyDetail(merged.headerNames),
};
```

`legacyDetail(headerNames: string[])` 保持原统计字段，新增 `headerNames`。`compile` 返回 `compileWithBriefBlocks(input).summary`；`compileRankedWithDetail` 的 legacy 分支直接返回该函数结果，原 ranking 参数与两个布尔选项不变。`compileRanked` 继续作为返回字符串的现有包装，不改公共返回类型。

### H6：R3 新路径与 hook 接线

目标：summarize.ts:68–80、390–420；before-compact.ts:7、796、862、870。

`BriefPlanDetail` 增加 `headerNames: string[]`，定义为：**最终 summary 专用 header 中完整输出的已知章节标题，按目录顺序排列**。只有标题、正文被截断的章节仍列出；标题本身被裁成不完整字符串则不列出。正文角色标签、省略标记和正文中的标题引用不属于这个数组。

新路径复用已有裁剪后 `after`，在 detail 中加入：

```ts
headerNames: selection.kind === "ok"
  ? HEADER_NAMES.filter((name) => after.has(name))
  : [],
```

`after` 来自专用 `header`，不来自整篇 summary。空 header 的 `after` 为空，因此空 parts 也得到空数组。`headerSections` 继续承担既有审计计数职责，不能拿其 `lines/omitted` 替代最终标题判断。

这是一个有意限定的过渡实现：**不再扫描整篇摘要推断元数据，但仍复用专用 header 的现有解析结果**。不把它宣传成全链路没有文本解析，也不在此版重写旧摘要格式或裁剪算法。

hook 导入改为 `compileRankedWithDetail`，原参数对象保持不变，接收 `{ summary, detail }`。debug 和持久化对象中的两处赋值均改为：

```ts
sections: detail.headerNames,
```

删除这两处全文正则。保持 [src/details.ts:4](file:///D:/geminiproject/pi-vcc-codemode/src/details.ts#L4) 的外部字段类型、`version: 2`、`previousSummaryUsed`、history 计数及错误处理策略。

### H7：R3 F9 的 header 区收窄

目标：summarize.ts:92–107。`sectionOf` 先在第一个 `\n\n---\n\n` 处截断，再查找标题：

```ts
const sectionOf = (text: string, header: string): string => {
  const sep = text.indexOf(SEPARATOR);
  const headerText = sep >= 0 ? text.slice(0, sep) : text;
  const tag = `[${header}]`;
  const start = headerText.indexOf(tag);
  if (start < 0) return "";
  const after = headerText.slice(start);
  const nextSection = HEADER_NAMES
    .filter((h) => h !== header)
    .map((h) => after.indexOf(`[${h}]`))
    .filter((n) => n > 0);
  const candidates = [...nextSection, ...(after.indexOf(SEPARATOR) > 0 ? [after.indexOf(SEPARATOR)] : [])].sort((a, b) => a - b);
  const end = candidates[0];
  return (end ? after.slice(0, end) : after).trim();
};
```

（收窄后 `after` 内已无分隔符，保留的分隔符分支只是防御；实现时可删除。）该修改会改变“brief 正文含 column-0 标题行”的病态输入输出，必须独立测试 `prev` 与 `fresh` 两种来源，不放进 P3-only 的逐字等价窗口。

### H8：R4 被忽略参数与实际动作

目标：[src/core/recall-run.ts:155](file:///D:/geminiproject/pi-vcc-codemode/src/core/recall-run.ts#L155)、recall-request.ts:132。

保留动作选择与优先级，只修改说明：

```ts
const ACTION_LABEL: Record<RecallRequest["action"]["kind"], string> = {
  drill: "file-content lookup",
  touched: "touched files",
  expand: "entry expansion",
  range: "entry range",
  search: "hybrid query",
  recent: "recent entries",
  scan: "literal scan",
  read: "saved-record read",
  invalid: "none (invalid request)",
};

export const ignoredNote = (request: RecallRequest): string => {
  const items = [...(request.dropped ?? [])];
  if (request.ignored?.length) {
    const reason = IGNORED_REASON[request.action.kind];
    items.push(`${request.ignored.join(", ")}${reason ? ` (${reason})` : ""}`);
  }
  if (items.length === 0) return "";
  return `Ignored: ${items.join("; ")}; action: ${ACTION_LABEL[request.action.kind]}.\n\n`;
};
```

非法 mode 的原检查保持，对值 `scan` 提供专用修复提示：

```ts
if (p.mode !== undefined && p.mode !== "hybrid" && p.mode !== "touched") {
  drop("mode", p.mode === "scan"
    ? "use scan:true with query for a literal scan"
    : "use 'touched' or leave it out");
}
```

示例：

```text
Ignored: mode "scan" (use scan:true with query for a literal scan); action: hybrid query.
```

仅在确有 ignored/dropped 时增加说明；正常调用的输出逐字不变。`invalid` 的具体错误仍由原执行分派返回，不伪造一次已完成的查询。

测试更新：`tests/recall-request.test.ts:18` 与 `:36` 的精确字符串改为带 `; action:` 的版本；`:72` 与 `tests/recall-range.test.ts:144` 保留 `startsWith`，另加动作断言；补 `mode:"scan" + scan:true + query` 的分派用例。`IGNORED_REASON` 空串的 ` ()` 由上述守卫消除，作为验收点。

### H9：R7 剥离 LIMITED_HISTORY_NOTE

目标：summarize.ts:486。`LIMITED_HISTORY_NOTE` 已在 summarize.ts 导入（第 17 行），只需新增正则并加入剥离链：

```ts
const LIMITED_HISTORY_NOTE_RE = notePattern(LIMITED_HISTORY_NOTE);

const stripKnownNotes = (text: string): string =>
  text
    .replace(HISTORICAL_NOTE_RE, "\n\n")
    .replace(LEGACY_HISTORICAL_NOTE_RE, "\n\n")
    .replace(RECALL_NOTE_RE, "\n\n")
    .replace(LIMITED_HISTORY_NOTE_RE, "\n\n")
    .trimEnd();
```

顺序：limited 是 HISTORICAL 的后缀，放在 HISTORICAL 之后即可；它与其他 note 由词面区分，不需要“按长度排序”。不修改任何 note 文本，因此不涉及 H2 的历史常量问题。

### H10：R5/R6 测试、文档和版本

优先扩展现有测试，不新增一套重复的分配器快照：

- [tests/brief.test.ts:389](file:///D:/geminiproject/pi-vcc-codemode/tests/brief.test.ts#L389)：H1/H3，含完整 normalize 输入和直接候选渲染输入；T03 锁定 `goal: code:`。
- [tests/brief-history.test.ts:475](file:///D:/geminiproject/pi-vcc-codemode/tests/brief-history.test.ts#L475)：H1/H3、预算窄带、合并/编辑历史、三轮压缩引用、0.1.2/0.1.3 旧 note 剥离、H9 limited note；H2 不再新增迁移测试。
- [tests/before-compact-hook.test.ts](file:///D:/geminiproject/pi-vcc-codemode/tests/before-compact-hook.test.ts)：H4–H6，实际 hook 的 debug 与 details 接线；同时保存 H4–H6 前后的新路径与旧路径输出做逐字对比。
- [tests/context-edits.test.ts](file:///D:/geminiproject/pi-vcc-codemode/tests/context-edits.test.ts)：历史 codemode 被编辑移除后，仍按既有 gate 走新路径；H9 的“limited 后切换旧路径”用例。
- [tests/recall-request.test.ts:5](file:///D:/geminiproject/pi-vcc-codemode/tests/recall-request.test.ts#L5)：H8，先 normalize 再 parse，覆盖丢弃、忽略、同时存在、scan 纠正与精确文案。
- [tests/rank.test.ts](file:///D:/geminiproject/pi-vcc-codemode/tests/rank.test.ts)：固定 note 395 和预算约束；根据实际断言更新，不批量替换历史期望。
- F9 的 `sectionOf` 测试放在 brief-history 或 summarize 相关用例中，覆盖 `prev` 与 `fresh` 的正文冒充标题。

[README.md:26](file:///D:/geminiproject/pi-vcc-codemode/README.md#L26)、:49-51、:77、:129、:281、:287 等当前接口示例改为 `goal:`，补充目标不是成功证明，并明确“B 不采用”。CHANGELOG 新增 `[Unreleased]`；保留 0.1.3 原记录及历史文本，不搬走 Known issues。发布准备阶段再把 [package.json:3](file:///D:/geminiproject/pi-vcc-codemode/package.json#L3) 改为 `0.1.4` 并给新日志定日期。

若实施时需要更新 [AGENTS.md](file:///D:/geminiproject/pi-vcc-codemode/AGENTS.md)，只补充本次已定稿的行格式契约（`goal:` / `code:` / 仅工具名；B 不做；note 文本不变），不扩展权限或改变其它规则。原文件修改与备份须在用户批准实施后进行；按项目约定放入 git-ignored 的 `research/.backup/`，不放入发布源码树。

## 5. 逐项静态核验清单

本次是计划审阅，不是实现验收。“静态可行”不等于新代码已通过测试。

| 修改片段 | 源码与调用证据 | 可行性及主要风险 | 结论 |
|---|---|---|---|
| H1 | buildBriefCandidates → renderToolCandidate；brief.ts:657–774 | 局部前缀替换，候选成本会变；保留来源标签；B 不恢复 | 静态可行，需新格式测试 |
| H2 | format.ts:86、summarize.ts:486 | 明确不采用；note 保持 395 | 不实施 |
| H3 | normalize → buildBriefCandidates；renderTextCandidate → attachRef | 全空白与前导换行分别处理；保留正文，接受候选重评分 | 合成片段验证通过，需生产集成测试 |
| H4/H5 | formatSummary → compileWithBriefBlocks → compile/compileRankedWithDetail | 旧摘要继承章节必须回流；内部返回类型变化 | 静态可行，属本版最高影响项，先独立实施 |
| H6 | compileWithEffectiveHistory → compileRankedWithDetail → hook | 必须取裁剪后标题；失败/空结果清空；不 bump 引用版本 | 静态可行，需所有分支测试 |
| H7 | sectionOf ← mergePrevious/mergeHeaderParts；summarize.ts:92–107 | 只查 header 区；改变病态输入输出，需独立用例 | 静态可行，F9 的核心修复 |
| H8 | normalizeToolParams → parseToolRequest → runRecall/ignoredNote | 以最终 action 为准；正常调用不得增加文字；精确断言更新 | 静态可行，需分派矩阵测试 |
| H9 | stripKnownNotes ← LIMITED_HISTORY_NOTE；format.ts:80、summarize.ts:381/486 | 合成输入已残留；不改变 note 文本 | 静态可行，需 limited/路径切换测试 |
| H10 | 既有接口断言、包体 files 列表 | 不更新旧 golden 来掩盖差异，不搬走历史 Known issues | 实施时逐项核对 |

图索引项目为 `D-geminiproject-pi-vcc-codemode`，审阅使用 generation `2026-10-27T22:49:59Z`。关键路径覆盖检查均无已记录缺口，但 freshness 为 `metadata_changed`，因此结论以本次读取的源码及运行结果为准，而非把图的“无缺口”当作完整性证明。新增片段实施后应重新建索，再进行下一轮结构判断。

## 6. 状态与验收矩阵

| ID | 当前状态 / 触发输入 | 修改后的可观察结果 | 关联片段 |
|---|---|---|---|
| T01 | 有短 goal / 长 goal | 系统前缀为 `goal:`，正文仍按 80/200 截断 | H1 |
| T02 | 无 goal、有脚本 / 所有导航为空 | 保持 `code:` / 仅工具名形状；不编造目标 | H1 |
| T03 | goal 正文以 `code:` 开头 | 有 `goal:` 外层标签，不与代码预览同形；B 不采用 | H1 |
| T04 | goal 声称成功，实际结果为 error | 保留错误标记，注解不覆盖观测结果 | H1 |
| T05 | assistant 是空串、空格、CRLF、制表符、Unicode 空白 | 不产生 assistant 文本候选；同消息 toolCall 仍保留 | H3 |
| T06 | assistant（及直接构造的 user）正文以换行开头，或带缩进 | 引用在首个非空白行；原换行、缩进保留 | H3 |
| T07 | 有效文本被摘录、sourceIndex 缺失、原文自带引用文字 | 省略标记仍正确；不新增假引用；不删用户原文 | H3 |
| T08 | 删除空白候选后近期评分变化 | 仍按原公式算；预算输入块数和全局 #N 不变 | H3 |
| T09 | 普通新路径，正文含角色/省略标签及 `[Commits]` 字样 | details 仅列专用 header 的实际标题，不扫描正文 | H4/H6 |
| T10 | header 被全部/部分裁剪；仅标题保留；标题自身被截断 | 仅完整保留的标题入数组；不拿裁剪前清单冒充结果 | H6 |
| T11 | 旧路径，本轮无提交，上次有 Commits | 合并后的 Commits 仍列出；摘要逐字等价 | H5 |
| T12 | 旧路径无 previousSummary / 只有 brief / 完全空输入 | 按实际 header 返回名称；无 header 则空数组 | H5 |
| T13 | budget-too-small / 空 parts | summary 为空，headerNames 为空 | H6 |
| T14 | edited-checkpoint / missing-history / 原 codemode 被编辑移除 | 不改变既有限制说明、门控与引用空间；limited 残留不进入摘要 | H6/H9 |
| T15 | 0.1.2/0.1.3 摘要再次压缩，切换新旧路径 | 旧系统说明不叠加；note 文本仍为 0.1.3 的同一文本 | H2（不采用）/H9 |
| T16 | 三轮压缩与 recall 原文读取 | #N 仍解析到同一保存条目；过滤不等于删除原文 | H3 |
| T17 | mode scan 有 query / 无 query / 带无效 cursor / 配合 scan:true | 分别标为 hybrid query / recent entries / none / literal scan | H8 |
| T18 | scan:true、read、drill、touched、expand、range 与额外参数 | 标签来自最终 action；优先级、错误与结果不变 | H8 |
| T19 | ignored-only、dropped-only、同时存在、正常无忽略调用 | 前三者一条 `Ignored: …; action: …`；后者输出不变 | H8 |
| T20 | 非 codemode 历史、直接工具、旧分配器用例 | 保持原 8 行/120 行约束与原 golden 结果 | H3/H5/H10 |
| T21 | prev/fresh 的 brief 正文含 column-0 `[Commits]`，header 无 Commits | 不把正文当章节；headerNames 不含 Commits；正文仍留在 brief | H7 |
| T22 | 旧摘要以 limited note 结尾（wrapped/unwrapped），随后走新路径或切旧路径 | 新路径只有一条 note；旧路径 merged brief 不含 `history limited…` | H9 |
| T23 | `recall-request.test.ts:18/36/72` 与 `recall-range.test.ts:144` | 精确断言更新为带 `; action:`；startsWith 仍通过 | H8 |

P3 的“摘要逐字不变”必须单独验证：在只应用 H4–H6 的阶段，对相同合成输入保存修改前输出并对比（新路径与旧路径都覆盖）。H7 的病态输入差异和 H9 的 limited 差异不在该等价窗口内。不能在 H1/H3 一起应用后，要求整个 0.1.4 摘要仍与 0.1.3 相同。

## 7. 度量方案与新的验收口径

### 7.1 发布必需：确定性证据

1. T01–T23 在无私人会话目录的环境可运行；真实会话测试保持既有条件运行方式。
2. 保留 242 例原 golden 数据与生成来源，不为本次候选变化改写；通过既有比较测试。
3. 合成编译覆盖字符率 `2 / 4 / 6`、短与长历史、预算边界、目标与代码预览混合、无 goal、错误工具及空白文本；B 不在范围内。
4. 对成功非空编译检查 `summary.length <= budgetChars` 与 `usedChars + reservedChars <= budgetChars`。按当前组装两者应严格相等；若不相等，先查组装而不是放宽断言。
5. 章节名的期望值来自手工明确的测试场景，hook 的数组必须精确相等。`sections ⊆ HEADER_NAMES` 只能作补充检查，不能证明没有漏报或多报。
6. 使用受控输入验证系统说明的唯一附加及历史说明剥离（HISTORICAL、LEGACY、RECALL、LIMITED）；不把任意用户正文中的相同字符串当成系统重复注入。
7. 不以“至少新增 8–12 个测试”、固定通过总数或固定运行耗时作为质量门；要求既有相关测试不被删除、矩阵覆盖齐全、0 fail。

### 7.2 可选：真实会话的后续对照

复跑时先在本地固定不可变输入快照；每个输入记录匿名编号与内容哈希，清单、路径映射和原文均留在 git-ignored 区域。对外只给聚合数，不输出会话内容或文件名。

同一快照、同一脚本版本、同一运行内比较：基线、仅 R2、R1+R2。R3 应单独验证文本等价，R4/R7 不参与压缩收益计算。区分预算饱和与未饱和、含/不含 goal、只预览代码、被限制历史等组，不以“至少一个 goal”筛选后的结果代表全部 codemode 会话。

完整重放需固定：活动分支、切点、当前窗口、previousSummary、sourceIndices、fileOps、trackCommands、字符率和有效历史。每个版本从同一原始输入重新构建候选并编译，不只替换最终文本或复用基线 reservedChars。

至少报告：

- 每组会话数、正增益/零增益/负增益会话数，聚合及逐会话分布。
- 目标行和目标正文保留量；mutation/error/goal 的保留率。
- 候选数与工具评分变化；预算、note、header、正文成本。
- 空引用形状计数及其抽样归因；header 被裁剪的情况；limited note 残留。

占用率、空行数和 prefixChars 是诊断项，不作“越高/越低越好”的单指标门。不得用不断变化的输入或计数规则下的 ±2 漂移证明比例稳定，也不能把原稿 +9.2% 直接换算成模型任务成功率；本版不采用 B，不把该数作为本版收益。

## 8. 实施顺序与停止条件

1. **冻结基线**：记录工作区状态，保留原稿及旧 golden；确认备份和预定文件范围。
2. **先做 R3（H4–H7）**：H4–H6 先落地并验证 P3-only 摘要逐字等价（新路径 + 旧路径）；随后做 H7（sectionOf 收窄）及其病态输入用例。
3. **做 R2（H3）**：先复现纯空白和前导换行，再修候选过滤与引用附着；检查工具配对、评分和引用空间。
4. **做 R1（H1）**：只改行格式；**不做 H2**，note 文本与剥离链保持现状；不追求原稿无标签的收益门。
5. **做 R7（H9）**：补 limited note 剥离与路径切换测试。
6. **做 R4（H8）**：更新纠错提示与精确文案测试，不改参数分派。
7. **完成 R5/R6（H10）**：跑矩阵和兼容测试，整理 Unreleased，最后准备版本与包体。
8. 按项目代码变更流程补齐动态调试证据与人工步骤；**本次只提交计划文档，不声称做过改后调试**。代码实施完成后重新建索。

若 P3-only 发生摘要变化、正常 recall 输出变化、预算超限、引用错位或原 golden 失败，停止后续打包，返回对应片段定位原因。不要通过重生成基线、放宽断言或临时调整借额掩盖问题。

任何实施提交拆分只是未来方便审阅的建议，不要求制造“测试先红、靠下一提交更新夹具才绿”的历史；本次提交只包含计划文档。

## 9. 发布前与发布后分开检查

### 发布前：本地可重复验证

标准环境使用项目现有命令：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test
```

最小宿主验证优先在隔离测试副本内执行，并确认实际安装版本；不要以命令退出 0 代替版本检查：

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.0.0 @earendil-works/pi-codemode@1.0.0
node -p "require('@earendil-works/pi-coding-agent/package.json').version"
node -p "require('@earendil-works/pi-codemode/package.json').version"
bun run typecheck
bun test
```

如在同一副本内切换依赖，无论测试成功与否，都执行以下恢复，并确认已回到锁定宿主后再运行类型与测试检查：

```sh
bun install --frozen-lockfile --ignore-scripts
```

包体检查：

```sh
npm pack --dry-run --json --ignore-scripts
```

解析包文件清单，确认入口和生产源码齐全，无 `*.bak`、`dist/`、`research/`、测试或计划文档；检查 package 版本与新日志条目一致、锁文件无非预期变化。以明确允许/禁止项检查代替“约 50 文件”。

`bun run typecheck` 当前入口是 index.ts（package.json:35），不是脚本与测试的全量静态检查；若后续扩展审计脚本，必须另补它自己的检查与合成运行，不宣称主入口类型检查已经覆盖脚本。

### 发布后：另经授权的环境核验

- 发布 npm、切换本机扩展、创建 issue 等外部动作需单独授权，本计划不执行。
- 核对 registry 版本、安装包版本和单一有效注册；不因目录里存在一个 CostMeter 符号就认定本版正确。
- 从实际安装副本运行无私人数据的合成压缩/召回冒烟，验证 `goal:`、空白修复、真实 `details.sections` 和动作提示。
- 在用户同意的 fork 会话中走 `/pi-vcc` 与 `/pi-vcc-recall`，确认没有正文丢失或引用错位；TUI/无界面模式分别记录是否实际验证，不能互相替代。

## 10. 本次已验证与仍待验证

**已验证：**

- 原计划及上述关键源码的实现关系，含新旧编译路径和 hook 元数据接线。
- 基线：HEAD `79ffc39977`、package `0.1.3`、工作区仅有计划文档；`bun run typecheck` 通过。
- 6 个定向测试文件合计 **384 pass / 0 fail / 1685 expect**：brief、recall-request、allocator-golden、brief-history、before-compact-hook、context-edits。
- 合成输入复现：纯空白候选（`"\n"`、`"  \t"`）、前导换行产生孤立引用（`"\nVisible text" → " (#0)\nVisible text"`）、过滤候选改变评分、无标签 goal 与 code 预览同形、非法 mode 的四种实际分派。
- 独立引用附着修订片段在 6 组合成文本上通过：空白输入不输出、非空正文不制造孤立引用、正文字符保持不变。这不是已合入生产函数的测试结果。
- 242 例 golden：242 个唯一 id、`generatedFromCommit = a59fdad`、fixture 文本中 `codemode` 出现 0 次，支持 F6 的“不能靠重生成验收”。
- `HISTORICAL_NOTE` 实测 395 个 UTF-16 单元；H2 不采用，保持 395。
- limited note 合成复现：当前 `stripKnownNotes` 处理后残留 `history limited by edited checkpoint; use recall`，支持 F10/H9。
- 原稿 SHA-256 与初审稿备份 SHA-256 均已核对；备份与修订前文件逐字节一致。

**仍待验证：**

- H1、H3–H10 的实际实现、改后类型检查、全量测试与动态调试。
- Pi 1.0.0 兼容运行、实际安装副本、TUI、其它操作系统与发布后状态。
- 原稿的 95/15 会话筛选、+9.2%/+8.9% 聚合收益与当前安装身份；本次未复跑，不将这些数值升级为确定结论，也不作为本版收益。
- 外部消费者情况。B 已彻底放弃，其模型理解与任务成功率不再属于本版验证范围。

交付边界：本次只更新审阅与修订计划并做文档提交，原计划和生产代码保持不变；初审稿备份在 git-ignored 的 `research/.backup/`。批准实施后，按第 8 节逐项推进；不再以测量收益为前提阻挡确定性缺陷修复。
