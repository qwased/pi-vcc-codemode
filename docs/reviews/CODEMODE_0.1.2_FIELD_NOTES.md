# pi-vcc-codemode 0.1.2 现场札记（使用方视角）

- 日期：2026-10-26
- 对象：已安装的 0.1.2（`npm:pi-vcc-codemode`）。安装副本与仓库 HEAD `d8d511d`（`chore: release 0.1.2`）的 `src/`、`index.ts` 逐文件无差异（`diff -rq` 清洁），所以本文可以当作对发布物的检查。
- 状态：使用札记。第 1、2 节是实测结果与验证，第 3 节是缺口与建议，第 4 节是复现步骤，第 5 节是未验证项。
- 性质：样本量 n=1（一次真实的手动 `/compact`，在被压缩的会话自身内观察）。数字只用于说明机制是否生效，不作为统计结论。

> 引用约定
>
> - 本文**不引用任何会话内容**（不引消息正文、不引文件路径、不引会话文件名），只使用汇总数字与条目编号区间，遵循 `AGENTS.md` 的"不在提交或 PR 中引用会话内容"。
> - `路径:行号` 指本仓库 HEAD 或 `node_modules` 内宿主 1.4.0 dist 中核对过的位置。
> - 数字来源两类：压缩条目字段（`tokensBefore` 等）与 `scripts/codemode-brief-audit.ts` 的离线聚合。审计脚本只读本地会话、不打印正文。

## 0. 摘要

1. 这次压缩的**意图链完整保留**：被摘要区间里的全部 codemode 步骤都以一行 `* codemode -> <嵌套工具名> | goal: <意图> (#N)` 的形式留在简报里，被丢弃的行只有 1 条，且省略标记给出了可解析的 `range`。
2. 0.1.2 的 A/C/D/E/F 五项改动都在这次真实压缩里复现到了，其中 C（标记带 range）与 E（嵌套文件操作）有量化证据：审计的引用覆盖为 **100%**（36/36），`nestedFilesOnlyInPiVccWindow` 为 **7**。
3. 当前真正的约束已经从"行数"变成"字符"：本会话 2 个段、52 条工具行全是 codemode 行，`CODEMODE_SEGMENT_CHARS=1000` 把丢弃率从 **69%（36/52，quota 0）** 降到 **27%（14/52，quota 1000）**；意图行越长，额度越早触顶。H 的价值因此高于"保留最早 1–2 行"。
4. 一个容易误判的地方：简报只覆盖被摘要的引用区间，被**保留的尾部**（25 条消息）不在简报里。只看简报会以为"结论被吃了"，实际它仍在上下文中。简报尾部若能明示保留尾部的编号区间，可以省掉这类误判。
5. 体感结论：61.7k token 的会话用 2.1k 字符的简报 + 保留尾部收尾，压缩后可以**直接继续工作**，不需要重跑任何已完成的调查。代价是每行 60–90 字符的 `goal:`。

## 1. 这次压缩的汇总数字

| 项 | 值 | 来源 |
|---|---|---|
| `tokensBefore` | 61,728 | 压缩条目字段 |
| 摘要长度 | 2,056 字符 | 压缩条目 `summary` |
| 简报行数 | 28 | 审计 `compactions.medianBriefLines` |
| 简报占 ranked 预算 | 17.1% | 审计 `compactions.medianBudgetRatio`，未触顶 |
| 简报段数 / 被 cap 命中段数 | 2 / 2 | 审计 `segments` |
| 工具行数 / 其中 codemode 行 | 52 / 52（100%） | 审计 `segments` |
| 调用之间有正文的段 | 0 | 审计 `segments.withTextBetweenCalls` |
| 丢弃行数：`quota 0` → `quota 1000` | 36（69%）→ 14（27%） | 审计 `quota.*.discardAfter` |
| 引用覆盖 | 丢弃引用 36，covered 36，uncovered 0，`missingRange` 0，coverage 1.0 | 审计 `references` |
| 整分支未选块简报长度 | 中位 3,836 字符，低于预算下限 1 次 | 审计 `brief`（注意：此项不含 ranked 选块，与 2,056 的差属于预期） |
| 切点对比 | 与宿主比 1 次，`piVccShorter` 1 | 审计 `cut` |
| 嵌套文件只在 pi-vcc 窗口内 | 7 | 审计 `cut.nestedFilesOnlyInPiVccWindow` |
| 多次压缩的旧简报保留 | `retentionPairs` 0（本会话只压过一次，未测） | 审计 `compactions` |

## 2. 0.1.2 各项改动在实际数据上的表现

### 2.1 A（提示规则不再渲染成 `- - `）— 已生效

运行中的系统提示里两条 codemode 规则是单层列表符号；`src/codemode/guideline.ts` 的两个常量不再带 `- `，注释也写明了原因。这条对 agent 是纯收益（以前读起来像嵌套列表，容易被当成子项）。

### 2.2 C（可操作省略标记）— 已生效，且是本会话最有价值的一条

被 cap 丢弃的只有 1 条 codemode 行，标记给出了 `recall range:[a, b]`；实测一次 `vcc_recall({ range: [...] })` 就把被丢的行连同其结果取回（两端包含，条数与标记一致）。离线审计对整分支的统计是 **36 个被丢弃引用全部被标记覆盖（coverage 1.0，`missingRange` 0）**——这正好回答了评审 §3.3 新加的那条验收标准。

### 2.3 D（工具名去掉 `×N`）— 已生效

简报里是 `codemode -> bash, read` 这样的形式，没有计数。读取时不再需要判断"×N 是调用位置还是执行次数"。

### 2.4 E（压缩时补抽本段 nested 文件操作）— 已生效，并且这次真的救了东西

摘要的 `[Files And Changes]` 有 2 条 Modified、2 条 Read；那 2 条 Modified 只可能来自**脚本内的 write**（顶层工具调用没有任何写路径）。更直接的量化证据是审计的 `cut`：本会话 `piVccShorter = 1`，即 pi-vcc 的切点比宿主更早，**正是评审 N2 描述的漏列条件**；在这种条件下 `nestedFilesOnlyInPiVccWindow = 7`，即 7 个文件只有 pi-vcc 自己的窗口能看到。如果没有 E，这些文件在摘要里会整体消失（宿主的 `fileOps` 对 pi-vcc 多摘要的那段是空的）。

### 2.5 F（`touched` 与 `#N:path` 覆盖 nestedCalls）— 已生效

`mode:"touched"` 列出了 7 个文件（分 2 页），条目编号落在**脚本结果**的条目上并带 `(write)` 形态；输出同时给出下钻提示（`query:'#N:file'`），实测该下钻可用。嵌套脚本正文也可被搜到：用一个只存在于脚本正文里的 token 查询，命中相邻的调用/结果条目，并给出 `range`/`expand` 建议。"摘要列得出、touched 列不出"的不一致在本次会话里消失了。

### 2.6 工具描述与 README

`vcc_recall` 的描述已经写明 `touched` 的盲区包含"参数被 Pi 因大小省略的嵌套写入"，并说明输出会报数量——这是接口层的改动，agent 直接读到，符合"按有意的接口修改"处理。

## 3. 缺口、建议与优先级

1. **H（codemode 段的字符额度）优先于锚点实验。** 本次数据显示：行数上限在 quota=1000 下几乎被抵消（25 条短意图行还原 16 条，只丢 1 条），真正的约束是**字符**；而 52 条 codemode 行全部是 codemode 行、0 段有正文，说明 H 的取舍在"一整段全是 codemode 调用"的形状下最敏感。建议 H 的验收明确两项：按段字符总量、以及意图行长度分布（本会话平均约 60–70 字符/行）。
2. **建议给 H 一个可复跑的基线夹具。** `scripts/codemode-brief-audit.ts --quota 0,400,800,1000,1200` 已经能对同一会话给出丢弃率曲线；本会话在 `0 → 1000` 上是 69% → 27%。把这条曲线写进 H 的验收记录，比只报"quota 后能保住多少行"更能说明代价。
3. **保留尾部的边界应该在简报里可见（可选、成本极低）。** 本会话简报覆盖被摘要的引用区间，被保留的尾部（25 条消息）不在简报里；只看简报的读者（人或 agent）很容易判断成"最后的结论被丢弃了"，从而重跑已完成的调查。钩子本来就知道 `firstKeptEntryId`，在简报尾部加一行保留尾部的编号区间即可消除这种误判。
4. **非 codemode 丢弃行建议明示"不可恢复"。** 按设计只有被丢的行含 codemode 行时才给 range；当被丢的是普通工具行时，agent 看到的是裸标记，会花一次 `vcc_recall` 去试。加一句"direct tool calls: no recall range"之类的最短提示即可避免空跑。
5. **`touched` 的输出形态可以和 `[Files And Changes]` 对齐一点。** 前者是绝对路径、不截断（本次 7 个文件分 2 页），后者按类截断到 10 条并给 `+N more`。长会话里先看到"写/读各几个、按目录分布"的形态摘要，比直接铺路径更有用。
6. **文档：README 增加审计脚本的用法示例。** `codemode-brief-audit.ts` 本次用起来很顺（只读本地会话、只写 `research/`、不打印正文），但它是 0.1.2 才进 CHANGELOG 的工具，README 里没有可复制的命令。建议给出"用自己会话自测"的一段，并注明默认读取的会话目录。

## 4. 复现步骤（本地，不要提交）

```sh
# 0. 确认安装副本与仓库一致
diff -rq "<installed>/pi-vcc-codemode/src" src
git -C . log --oneline -1          # 期望 d8d511d / release 0.1.2

# 1. 看这次压缩存下来的摘要与字段
#    压缩条目的 tokensBefore / summary 长度 / firstKeptEntryId；
#    摘要里 codemode 行数、省略标记、[Files And Changes] 的条目数

# 2. 用自带审计脚本对同一会话跑配额曲线
bun run scripts/codemode-brief-audit.ts --sessions <session.jsonl> --quota 0,400,800,1000,1200 \
  --out research/codemode-brief-audit.json
#    关注：quota.*.discardAfter、references.coverage、cut.piVccShorter、
#    cut.nestedFilesOnlyInPiVccWindow、compactions.medianBudgetRatio

# 3. 在会话里验 recall 通路（agent 侧）
#    range:[a, b]  取回标记给的区间（两端包含、条数吻合）
#    mode:'touched' 列出脚本内 write 的条目编号与形态
#    query:'#N:path' 下钻到脚本写入的文件内容
```

注意：第 1、2 步只读取本地会话文件，聚合结果落在 `research/`（git-ignored）；不要把它或会话本身带进提交、PR 或文档。

## 5. 未验证

- **Pi 1.0.0 宿主**：本次只在 1.4.0 上观察。
- **多次压缩的合并压力（评审 N5）**：本会话只压过一次，`retentionPairs = 0`，H 需要的那项基线没有取到。
- **"调用之间有正文"的形状**：本会话 `withTextBetweenCalls = 0`，属于上游会把连续 `codemode` 合并成一行、fork 增长最明显的那一类；另一种形状（每条调用前有正文）没有测。
- **宿主因大小省略嵌套 arguments 的盲区**：本次没有触发（F5 的提示文案因此只在代码与测试里验证）。
- **G3（压缩后行为测量）与 I（nested 记录中段可达）**：仍按计划书 §11 的未完成状态；本文不改变它们的结论。
