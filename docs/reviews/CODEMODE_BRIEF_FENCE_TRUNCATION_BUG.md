# 摘要代码围栏被截断撕裂（Bug 报告）

- 版本：pi-vcc-codemode 0.1.4（codemode brief 路径，`details.compactor = "pi-vcc"`、`details.briefHistoryMessageCount` 存在）
- 报障场景：2026-10-29 一次手工压缩（`fromHook: true`、`reason: manual`、`tokensBefore = 103473`、`briefHistoryMessageCount = 57`）
- 结论：**不是预算问题，是截断位置问题。** 助手正文按“头 320 / 尾 320 字符 + 省略标记”摘录时，head 截断点落在一个未闭合的代码围栏里，而收尾围栏被切进了省略区。摘要于是只留下一条 ts 代码围栏的开口行，其后全部内容在渲染时都被当成代码。

本文只记录现象、证据与修复方向，本版**不做修改**。证据均为聚合量与合成样例，不含真实会话正文。

---

## 1. 现象

用户可见的后果是：摘要里那条助手信息的代码块一直延伸到摘要结尾，把后面本该独立显示的内容全吞了进去，包括

1. `[omitted … chars; recall #N]` 省略标记；
2. 后续的 `[user]` / `[assistant]` 段头；
3. 所有 `* codemode goal: … (#N)` 行 —— 也就是用户报障时点名的“后续 codemode 脚本意图”；
4. 摘要末尾的 `HISTORICAL_NOTE`（“Use vcc_recall: scan …”那一段）。

报障这次摘要共 3338 字符 / 84 行，围栏在第 47 行（0 基索引 46）打开且之后再无闭合：**其后 37 行、1453 字符（约 44%）全部落在代码块里**，包括唯一的召回指引。

第二个后果更隐蔽：省略标记本身也在围栏内，模型看到的是“代码里混进了一行奇怪文字”，而不是“这条记录被截断过，需要 vcc_recall 读原文”。省略标记的存在意义（让 agent 知道自己看到的不是全量）被抵消了。

---

## 2. 触发条件

同时满足即可复现：

1. 走 codemode brief 路径（有效历史里出现过 codemode 调用），因此正文用 `excerptText` 的头/尾摘录；
2. 某条用户/助手消息的正文里有 Markdown 代码围栏，且围栏从“head 截断点之前”一直开到“head 截断点之后”；
3. 该围栏的收尾行落在省略区（即 head 与 tail 之间）。

三个条件都不罕见：助手回答里“一段说明 + 一个较长代码块 + 继续说明”是很常见的形态。

---

## 3. 证据

### 3.1 报障会话的精确数值（只列结构量）

| 项 | 值 |
|---|---|
| 该条助手正文长度 | 3612 字符 |
| 分配到的 keep | 640 字符（head 320 / tail 320） |
| 第一条 ts 围栏开口位置 | 偏移 289 |
| 对应收尾围栏位置 | 偏移 448 |
| head 截断点 | 偏移 320 → **落在 289..448 的围栏内部** |
| tail 起点 | 偏移 3292 → 在末尾散文里 |
| 结果 | 摘录只含 1 条围栏开口行，收尾围栏被省略区吃掉 |

### 3.2 同形合成复现（非会话内容）

用 2070 字符的正文（说明 + 一个 12 行代码块 + 大段散文 + 结尾说明）、keep = 640 走 `renderTextCandidate`：

````text
## 模型侧：一行，位置在 Nested tools: 之前 (#16)

先说明背景，这段占了大约两百多字符，用来把 fence 的开口推到 head 截断点之前。

```ts
const ABRIDGED_NOTICE = "…";
const padded0 = 0; // filler
…
const padded
[omitted 1430 of 2070 chars; recall #16]
都不是必须的，真正值得做的只有两三件…（尾部散文）
````

围栏行只有 1 条，判定为失衡。把同一段文字整体保留（keep = 全长）时，围栏是成对的，说明缺陷只出现在摘录路径。

### 3.3 本机聚合（全部本地会话，只统计计数）

扫描 103 个会话文件里的 60 条 pi-vcc compaction 摘要：

| 路径 | 总数 | 围栏行数为奇（失衡） | 备注 |
|---|---|---|---|
| codemode brief（新路径） | 5 | 1 | 即本次报障；省略标记位于未闭合围栏内 |
| legacy（`sections` 路径） | 55 | 3 | 3 条都含 `...(N earlier lines omitted)`，且第一条围栏行是**裸的三反引号收尾行**（开口行被行级上限丢掉） |

两条结论：

- 新路径的失衡来自 `excerptText` 的头/尾切割（本文主题）；
- legacy 路径的失衡来自行级上限（`capBrief` 一类的“保留末尾 N 行”）：把开口行切掉、只留下收尾行，而收尾行在 CommonMark 里等价于**新开**一个空围栏，于是后续同样被吞。这属于同一类缺陷的另一个切点。

---

## 4. 根因

### 4.1 主因：`excerptText` 不看围栏

`src/core/brief.ts:736`：

```ts
const excerptText = (text, keepChars, sourceIndex) => {
  const headChars = ceil(keep / 2);
  const tailChars = floor(keep / 2);
  const headEnd = graphemeStartAtOrBefore(text, headChars);
  const tailStart = graphemeStartAtOrBefore(text, max(headEnd, text.length - tailChars));
  const marker = "[omitted … chars; recall #N]";
  const head = text.slice(0, headEnd).trimEnd();
  const tail = text.slice(tailStart).trimStart();
  return head ? `${head}\n${marker}\n${tail}` : `${marker}\n${tail}`;
};
```

它只做两件事：按字符数切 head / tail，然后在中间插一行标记。整个函数没有任何“当前是否处在围栏内部”的概念，也不保证输出围栏成对。

### 4.2 没有兜底：拼装阶段也不校验

- `src/core/summarize.ts:443`：`wrapLongLines(parts.join(SEPARATOR) + SEPARATOR + note)` —— 直接拼接 header、正文、分隔线、note，不检查围栏状态；
- `src/core/rank.ts:679`：`const text = wrapLongLines(out.join("\n"))` —— 正文拼装同样不校验。

所以一条失衡的正文可以一路走到 summary，把 note 也包进代码块。

### 4.3 成本核算是对的，缺陷是纯结构性

`src/core/rank.ts:324` 的 `textCost` 用 `renderTextCandidate` 的最终文本量算成本，因此不存在“预算被低估”的问题；缺陷只在 Markdown 结构 / 可读接口层面。这也说明修复可以只在渲染层做，不需要动分配器（除非修复改变了摘录字符数，见 §6 的 golden 影响）。

### 4.4 同类切点清单（同一类缺陷，未逐个实施）

| 位置 | 函数 | 切法 | 风险 |
|---|---|---|---|
| `src/core/brief.ts:736` | `excerptText` | 头/尾字符 + 标记 | 本次报障主因 |
| `src/core/format.ts:61` | `capBrief` | 保留末尾 120 行 | 丢开口行 → 裸收尾行吞后续（legacy 3 例） |
| `src/core/summarize.ts:250` | `capBriefToLineBudget` | 同上，按剩余行数 | 同上 |
| `src/core/format.ts:113` | `trimHeaderToBudget` | 整行裁剪 + 单行 clip | 头部（Session Goal 来自用户文本）含围栏时同风险 |
| `src/core/brief.ts:60` | `truncateTokens` | 词边界截断 | legacy `compileBrief` 路径，可能留下未闭合围栏 |
| `src/core/brief.ts:89` | `truncateTokensHeadTail` | 词边界头/尾 | 同上 |

补充一个相邻小问题（未单独开条目）：`attachRef`（`src/core/brief.ts:751`）把 `(#N)` 追加到第一条非空行；若消息正文以围栏行开头，引用会落进 info string（渲染成 ```` ```ts (#9) ````）—— 围栏仍能工作，但 info string 被污染，且这是同一处“把 Markdown 结构当普通文本处理”的思路。

---

## 5. 影响与严重性

- **高**：单条失衡会让摘要后半段全部降级为代码，可读接口（段头、codemode 意图行、省略标记、召回指引）同时失效；模型仍能看到文字，但“这是导航信息”的格式信号没了。
- **会传播**（legacy / 合并路径）：`mergePrevious` 会把上一版摘要正文原样并入新摘要（`preserveFreshBrief`），未被闭合的围栏会继续吞掉新一遍的 brief。新路径每次从有效历史重建正文，不会继承旧摘要，但仍会以同样方式重新产生。
- **不丢数据**：`vcc_recall` 仍能读到原文，`#N` 引用也仍然有效；损失的是摘要本身的可读性与省略提示。

---

## 6. 建议修复方向（本版不实施）

### 方案 A（推荐）：让摘录围栏自洽

在 `excerptText` 里加一个极小的围栏状态机（只认行首 0–3 空格 + 3 个以上反引号/波浪号）：

1. 若 `text[0..headEnd)` 结束时仍处在围栏内 → 在 head 后补一行与开口同长度、同字符的收尾围栏；
2. 若 `text[0..tailStart)` 结束时处在围栏内 → 在 tail 前补回开口行（mark + info string）；
3. 最后对拼好的摘录再做一次状态检查，若结尾仍开着（源文本本身就没闭合）→ 追加收尾围栏。

成本：只对“确实含围栏行”的正文改变长度。`tests/fixtures/allocator-golden.json` 中反引号/波浪号围栏出现次数为 0，因此预期 golden 无差异；若实际跑出差异，按仓库规则**不要重生成 fixture**，只在 `amended` 里注明具体记录。

### 方案 B（兜底，可与 A 并存）：拼装阶段做不变量检查

在 `summarize.ts:443` 与 `rank.ts:679` 的最终文本上校验围栏配平：若结尾仍在围栏内，就在末尾补收尾围栏；并保证 `note`、段头、`* codemode …` 行永远不会出现在围栏内。A 负责“局部正确”，B 负责“整体绝不吞尾”。

### 方案 C：行级上限感知围栏

`capBrief` / `capBriefToLineBudget` 在“保留末尾 N 行”时，若被丢掉的部分里有开口行、保留部分的第一条围栏行是收尾行，则丢弃该孤立收尾行（或补回开口行）。`trimHeaderToBudget` 的单行 clip 同理（低优先级）。

### 验收矩阵

| 用例 | 断言 |
|---|---|
| head 结束于围栏内、收尾行落在省略区（本次形状） | 摘录围栏行数为偶；省略标记在围栏外 |
| tail 起点仍在同一围栏内 | 补开的围栏 + 原有收尾行配平 |
| tail 已在围栏之后 | head 补收尾后，tail 以普通散文呈现 |
| 源文本本身的围栏未闭合 | 输出仍以收尾围栏结束（不吞后续段） |
| 消息以围栏行开头 | `(#N)` 不落在 info string 上（与 `attachRef` 一起改） |
| legacy `capBrief` 在围栏中切行 | 结果里没有孤立的裸三反引号行 |
| 集成：含长代码块的 codemode brief | 逐行状态机断言 `[user]`/`[assistant]`/`* codemode goal:`/note 全部在围栏外 |
| golden | 60 条记录逐字节不变 |

### 现有测试为何漏掉

- `tests/allocator-golden.json` 里没有一条围栏行，分配器回归永远碰不到这类文本；
- `tests/brief.test.ts` 唯一的围栏用例（`preserves assistant markdown line breaks`）用的是**整段保留**，没有走摘录；
- `tests/codemode-brief.test.ts` 完全没有围栏样本；
- 没有任何测试把“摘要文本的围栏配平”当作不变量（这正是本缺陷能活到线上的原因）。

---

## 7. 附：报障会话的结构信息

- 该会话只有 1 条 compaction，走新路径（`briefHistoryMessageCount = 57`、`previousSummaryUsed = false`）；
- 摘要围栏失衡点位于第 47 行，之后 37 行（1453 字符）全在代码块内；
- 被吞掉的正是用户最先注意到的形态：`* codemode goal: …` 行看起来像代码块的一部分。

---

## 8. 上游核对（2026-10-29）

**结论：上游没有任何同类修复可直接拣选。**

- 上游 `sting8k/pi-vcc` 当前 tip 为 **v0.11.1**（`a78ed77`，2026-10-25）；本 fork 的分叉点是 **v0.10.2**（`733e872`），落后 27 个 commit（0.11.0 / 0.11.1 尚未合并）。
- 这 27 个 commit 中没有围栏相关改动：
  - 唯一触及含三反引号代码行的提交是 `24684a2`（0.11.0 “按位置取早段请求/用户消息”），改的是提取用的启发式正则，不是围栏配平；
  - `git log -S'fence'`、`-S'unclosed'` 在上游全部历史为空；
  - 上游 issue 搜 `code block` 只有 3 条无关结果，PR 搜 `truncat` 为 0；
  - 上游 `fix/summary-parse-gaps`（已并入 0.11.1，PR #60）处理的是段头解析与合并（transcript 行被误当成章节、`[Commits]` 去重、多路径 edit），与围栏无关。
- 上游同样没有围栏感知的截断：`truncateTokens` / `truncateTokensHeadTail`（上游 `src/core/brief.ts:56 / 85`）与 `capBrief`（`src/core/format.ts:56`）、`capBriefToLineBudget`（`src/core/summarize.ts:236`）是同一类头/尾与行级切割。也就是说，**这类缺陷在上游 legacy 路径上同样存在**；本 fork 新增的字符预算路径（`excerptText`）只是把同一个弱点换到了新切点。
- 上游测试里唯一的围栏样本与本 fork 相同：`tests/brief.test.ts` 的整段保留用例（`preserves assistant markdown line breaks`）。上游没有任何围栏 fixture，也没有配平不变量 —— 与本 fork 的测试盲区一致。
- 若上游后续修复，最可能落在 `capBrief` / `capBriefToLineBudget` 或引入一个共享的围栏辅助函数；届时本 fork 需要把同一辅助函数接到 `excerptText` 上，而不是等合并自动带过来。
- 注意：合入上游 0.11.x 不会顺带修掉本条（它改的是段头与合并语义），但会改变 legacy 摘要的拼接方式；合入后应重跑本报告的复现（§3.2）与 §6 的验收矩阵。
- 顺带记录一个相邻的“按字节切”切点：`#N:path:full` 的 50KB 截断（`src/core/drill-down.ts`，上游同名文件）直接按字节 `slice`，同样不看围栏；它是 recall 输出而非摘要，影响面小，未列入本次缺陷。

