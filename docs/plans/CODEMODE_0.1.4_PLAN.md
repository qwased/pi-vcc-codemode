# pi-vcc-codemode 0.1.4 工作计划

- 文档状态：**待外部评审**（本文件是实现前的契约，不是发布说明）
- 目标版本：`0.1.4`；基线 commit `79ffc39`。`0.1.3` 已发布到 npm（`latest = 0.1.3`），本机安装副本含 `CostMeter` 修复、`pi list` 为单一注册、残留 `dist/` 目录为空 —— 即反馈文档的 D2 在复核时已经消除。
- 输入：`docs/reviews/CODEMODE_0.1.3_USER_PERSPECTIVE_REVIEW.md`（D1–D6，n=1 实测）
- 数据性质：本文所有数字均为**聚合测量**；不引用会话正文、路径或文件名。研究脚本位于 git-ignored 的 `research/`，不随包发布。
- 基线（本机 HEAD，Pi 1.4.0 / Bun 1.4.4 / Node 24 / Windows 11）：
  `bun test` → **867 pass / 49 files / 2983 expect / 8.99 s**；`bun run typecheck` → 通过；`bun test` 中 `real-sessions.test.ts` 只在 `~/.pi/agent/sessions` 存在时运行。

---

## 评审阅读路线（建议顺序）

1. §1 六条缺陷的复核表 —— 先看哪些结论被更正、哪些留到 0.1.5。
2. §2.4 组合净收益 → §2.2 方案谱系与敏感性 → §2.6 未采纳方案的理由。
3. §4 每项改动点（file:symbol）、测试清单与验收读数。
4. §10.1 本计划可被推翻的条件（事先声明，避免事后解释）。
5. §8 证据分级、已知偏差与反例。

若只想判断是否批准，看 §3（范围）、§9（风险与回退）、§10（未决问题）即可。

---

## 0. 版本定位

`0.1.4` 是**接口收敛 + 元数据净化**版本，不加功能、不加设置项、不改预算公式：

1. **给 codemode 简报定稿一套最小行格式**（A+B）：声明目标的行走 `* codemode <goal>`，只有兜底预览行保留显式标签 `code:`。
2. **消除空引用行**（` (#N)` 独占一行）：新路径的候选过滤漏掉了"空白但非空"的文本。
3. **让 `details.sections` 来自结构而非正则**：不再把正文里的 `[user]` / `[omitted …]` 当成章节名。
4. 发布工程对齐（D2）：版本号、单一实现、CHANGELOG/README 与代码同源。

三个理由都指向同一件事：这条产品线的价值是"摘要可对账"，所以**结构必须是结构，内容必须是内容**。第 1 项顺带把 codemode 历史覆盖率提高约 9%（见 §2）。

**非目标**：不改预算上限（1100/2000 token，15 字符/块）、不改 40/30/30 角色配额、不改旧路径（非 codemode 会话的 8 行/120 行行为）、不加新查询参数、不改召回排序。

---

## 1. 复核：反馈文档的六条缺陷

| 编号 | 反馈文档结论 | 复核 | 依据 | 0.1.4 |
|---|---|---|---|---|
| D1 | `details.sections` 被正文污染 | **确认** | `before-compact.ts:862`、`:870` 用 `/^\[(.+?)\]/gm` 扫整篇；真实压缩条目 28 项中 26 项非章节 | ✅ 修 |
| D2 | 本地 dist 与待发布包同版本号、不同实现 | **复核时已解决** | 复核结果：`npm view` → `0.1.3`；安装副本 `src/core/rank.ts` 含 `CostMeter`（修复已进包）；`pi list` 只有 `npm:pi-vcc-codemode` 一条；`dist/` 已清空 | ✅ 维持（发布门核验，不做 dist 副本） |
| D3 | 只有引用的空行；推测成因是"裁剪到 0 字符" | **部分更正** | 现象确认（单会话 9 条、15 会话 41 条）；**根因不是裁剪到 0**：`BRIEF_MIN_TEXT_CHARS = 64`（`brief.ts:506`）使 keep 恒 ≥ 1，真实成因是宿主持久化的空白 text part + 候选过滤只判 falsy + `attachRef` 无条件加引用（§4.2） | ✅ 修 |
| D4 | 召回重复与代码块压过讨论 | **确认**（观测到） | 同一脚本改写前后两条同时进首屏；属排序质量问题，非缺陷 | ⏸ 0.1.5 |
| D5 | `-p` 模式无 stdout 回执 | **确认**（观测到） | 需要宿主提供命令输出通道，插件侧无法可靠伪造 | ⏸ 0.1.5（先与宿主确认） |
| D6 | 忽略参数的提示没说清"实际执行了什么" | **确认** | `ignoredNote`（`recall-run.ts:168-172`）只回显"忽略了什么"；`mode` 的 drop 文案在 `recall-request.ts:131` | ⚪ 应做（P5） |

反馈文档 §9 的两处自我更正（`searchTools` 返回类型、`mode:'scan'` 静默降级）本计划沿用其更正后的结论，不重复讨论。

---

## 2. 决策依据（测量）

### 2.1 口径

| 项 | 口径 |
|---|---|
| 语料 | 本机 `~/.pi/agent/sessions` 下 95 个会话文件；筛选条件：有压缩条目 + 有效 codemode 历史 + 未被 `limitedReason` 截断 + 至少一条带 `// goal:` 的 codemode 候选 → **15 个会话** |
| 重放 | `buildGlobalIndexById` → `buildBriefHistory(firstKeptEntryId = 最近压缩条目)` → `normalize`/`filterNoise` → `buildBriefCandidates` → `allocateBriefBudget` |
| 预算 | `budget = round(clamp(15 × historyBlocks, 1100, 2000) × 4)`（审计约定用固定 4 字符/token；真实 hook 用会话校准值 2–6，见 §2.5 敏感性） |
| 保留量 | `reservedChars = compileRankedWithDetail().detail.reservedChars`（header + note + 分隔符的真实值） |
| 计数 | 只数 codemode **目标行**（`* codemode intent: ` / `* codemode goal: ` / `* codemode ` / `* CMI `），排除 `code:` 兜底行；"goal 正文"= 去掉行首前缀与行尾 ` (#N)`/`{error observed…}` 后的字符数 |
| 空引用行 | `/^\s*\(#\d+\)\s*$/` 的行数 |
| 不输出 | 任何消息正文、路径、文件名；脚本只打印长度、比例、结构形状（非空白字符掩码为 `x`） |

### 2.2 台账一：前缀方案谱系（k=1，15 会话汇总）

| 方案 | 行首形状 | 前缀字符 | codemode 目标行 | goal 正文 | ref-only | 空行 |
|---|---|---|---|---|---|---|
| 现状 | `* codemode intent: ` | 19 | 295 | 8520 | 41 | 410 |
| A 单独（改名） | `* codemode goal: ` | 17 | 301 (+2.0%) | 8696 (+2.1%) | 41 | 414 |
| B 单独（去标签） | `* codemode ` | 11 | 321 (+8.8%) | 9240 (+8.5%) | 41 | 408 |
| C（别名，未采纳） | `* CMI ` + 46 字符图例 | 6 | 339 (+14.9%) | 9767 (+14.6%) | 41 | 406 |
| **A+B（采纳，含 P2 与 +44 note）** | `* codemode ` | 11 | **322 (+9.2%)** | **9282 (+8.9%)** | **0** | **375** |

预算敏感性（同一口径，预算 ÷ ×0.7 / ×1 / ×1.5）：

| 方案 | ×0.7 | ×1 | ×1.5 |
|---|---|---|---|
| A 单独 | +2.3% / +2.7% | +2.0% / +2.1% | +0.8% / +0.7% |
| B 单独 | +9.2% / +10.0% | +8.8% / +8.5% | +4.9% / +4.1% |
| C（CMI） | +15.6% / +15.9% | +14.9% / +14.6% | +8.2% / +7.2% |
| **A+B** | **+9.2% / +10.1%** | **+9.2% / +8.9%** | **+5.4% / +4.4%** |

读法与限制：

- 收益**只出现在受工具配额约束的会话**：15 个会话里约 6 个有变化（长历史），其余本来就把候选全收下，增量 0。表中比例是这 15 个会话的汇总，不代表短线会话。
- 机制：工具角色按**行**计价（`allocateToolRole` 先塞 `short` 再升级 `normal`），而这 15 个会话的 `toolNormal` 恒为 0 —— 短版本就把配额吃满，所以缩短前缀直接换成**行数**，不是更长正文。
- 基线行数在不同脚本修订间有 ±2 的漂移（计数规则不同），因此**只主张比例，不主张绝对行数**。
- 该语料中 `code:` 兜底行在 15 份简报里出现 0 次（被保留的 codemode 行 100% 有 `// goal:`），所以 A+B 的收益几乎等于"去标签"的收益。

### 2.3 台账二：空引用行

| 观测 | 值 |
|---|---|
| 本机全部会话：assistant 消息数 / 含空白 text part 的消息 | 6209 / **103**（长度全为 1–2 字符；101 条同时带 thinking，103 条都带 toolCall） |
| 含该形状的会话文件 | 22 / 95 |
| 单会话（复核用会话）最近一次压缩正文 | 157 行中 **9 条** ref-only，ref = `#22 #56 #78 #80 #152 #156 #164 #222 #259` |
| 同一份历史重放识别出的空白 assistant 候选 | **恰好这 9 个**（同文件另有 3 个落在保留尾巴之外） |
| 15 会话基线 / 过滤后 | **41 条 → 0 条**；空行 410 → 375 |

### 2.4 台账三：A+B + P2 的组合净收益

> 下表来自同一次运行。绝对值（行数/字符数）在不同运行间有 ±2 漂移（语料为本地会话目录快照，测量期间仍在增长），**比例稳定**；因此所有主张都以比例表达。


| 指标 | 基线 | 0.1.4（A+B + P2） | 变化 |
|---|---|---|---|
| codemode 目标行（15 会话汇总） | 295 | 322 | **+9.2%** |
| goal 正文（UTF-16 字符） | 8520 | 9282 | **+8.9%** |
| 空引用行 | 41 | 0 | −41 |
| 空行 | 410 | 375 | −35 |
| note 长度 | 395 | **439** | +44（+1.0 pp 于 4400 字符的小会话 floor） |

### 2.5 预算占用现状（为什么"缩前缀"能落成内容）

- 0.1.3 的 15 会话审计（`research/codemode-brief-audit-s5.json`）：`ratio = (used + reserved) / budget` 中位 **0.99**，13/15 ≥ 0.98，0 超预算，0 note 违规 → 简报基本饱和，省下的字符直接变成内容。
- 复核用会话可反推真实预算：摘要 5721 字符 = 正文 4480 + header 832 + note 395 + 分隔符 14 → `charsPerToken = 5721 / 2000 = 2.86`，占用 100%。
- 小会话代价：floor 预算 4400 字符时，note 从 395（9.0%）升到 439（10.0%）。

### 2.6 没有采纳的方案与理由

| 方案 | 数据 | 不采纳理由 | 重新评估的触发条件 |
|---|---|---|---|
| CMI 别名 | 比 A+B 多 +5.7 pp 行（`×1`） | `* <token>` 位是**工具名**（AGENTS.md：tool names describe calls or script structure）。`CMI` 不是工具 → 给 agent 一个"可调用工具"的误导面；图例解释语义但改不掉形状。另有 note 迁移成本（0.1.3 文本需降级为第三个 legacy 变体） | 0.1.5 审计显示"长会话 codemode 行丢弃率"仍 > 20% |
| 借额顺序重构 | P2 单独运行时释放的额度流向 assistant：工具行 −1.7%（三次独立运行同值） | 需要先定义"边际价值/字符"的价值函数并单独度量；与两个缺陷修复混在一个版本里无法归因 | 单独实验（§3.3） |
| `normalize` 层丢弃空白块 | — | 会改变 `normalize().length`，即改变 `15 × blocks` 预算；且影响旧路径。修一个渲染缺陷不值得动预算输入 | 若其它模块也需要"无空白块"的保证 |

---

## 3. 范围

### 3.1 必做

| 项 | 内容 | 接口影响 |
|---|---|---|
| **P1** | 简报行格式 A+B：`* codemode <goal>` / `* codemode code: <preview>`；note 文案定稿；0.1.3 note 降级为 legacy 剥离变体 | 对外（简报文本、README、测试） |
| **P2** | 空引用行：候选过滤增加 `.trim()` 判空 + 形状不变量测试 | 对外（简报文本） |
| **P3** | `details.sections` 改由结构化章节名填充；删除两处正则 | 元数据语义收窄 |
| **P4** | 版本与文档：`0.1.4`、CHANGELOG、README、AGENTS 一句 | — |

### 3.2 应做（有余力；不阻塞发布）

| 项 | 内容 |
|---|---|
| **P5** | `Ignored:` 文案指名**实际执行的动作**（D6），补 `mode:"scan"` 用例 |
| **P6** | 度量补齐：审计脚本增加 `prefixChars` / `refOnlyLines` / `blankLines` / `headerNamesVsSections`；增加**合成夹具**使前缀收益可在无真实会话时复算 |

### 3.3 明确不做（附理由与触发条件）

- **CMI 别名**：见 §2.6，触发条件已写明。
- **借额顺序 / 配额策略**：0.1.5 独立实验。验收口径：同一 15 会话语料上，给"仍有未收候选"的角色按边际价值借额，比较 `toolKept`、`toolMutationKept`、`toolErrorKept` 与 `assistantExcerpted` 的净变化，且 body 不超预算。**不记录**"总额度利用率"这一单指标（它会奖励无价值填充）。
- **D4 召回排序质量**（重复脚本、代码块压过讨论）：需要排序实验与人工判读，不做无证据调参。
- **D5 `-p` 模式 stdout**：需要宿主提供命令回执通道；先在 0.1.5 提 issue/确认 API，再决定是否实现。
- **新预算旋钮 / 新设置项**：0.1.4 不改预算。
- **D2 发布工程**：复核时已解决（0.1.3 已发布、单一注册、`dist/` 为空）。0.1.4 沿用同一条发布路径，并在发布门核验版本与注册唯一性，不再维护本地 `dist/` 副本。
- **`details` 字段版本号 bump**：见 P3 讨论（无消费者，语义收窄即可）。

---

## 4. 实施项

### 4.1 P1 简报行格式 A+B（0.5 天）

**动机**：`codemode intent: ` 是简报里最密的重复元素（19 字符/行，占一行成本约 1/3），而工具角色是行数受限的（§2.2）。去掉标签把同一份预算变成约 9% 更多的 codemode 行。

**目标形状**（新路径，互斥三态）：

| 输入 | 渲染 |
|---|---|
| 有 `// goal:` | `* codemode <goal，short ≤80 / normal ≤200 字符> (#N)` |
| 无 goal、有脚本 | `* codemode code: <脚本头 ≤80 字符> (#N)` |
| 无 goal、无脚本 | `* codemode (#N)` |

**改动点**：

1. `src/core/brief.ts:657-666`（`shortNav` / `normalNav`）：goal 分支去掉 `intent: ` 前缀（保留 `firstCharsEllipsis` 截断与两个常量）；`code:` 分支与 `toolNavText` 兜底不变。
2. `src/core/format.ts:86-95`（note）：
   - 新增 `HISTORICAL_NOTE`（0.1.4 文本，逐字如下）；
   - 现有 0.1.3 文本改名为 `HISTORICAL_NOTE_013`（保持 `LEGACY_HISTORICAL_NOTE` 仍指 0.1.2 文本，避免已有测试语义漂移）。
   - 0.1.4 文本（**逐字**，测试将整段 pin）：
     > Historical navigation, not current state or proof of success. User/assistant text and unlabeled `* codemode` goals are past statements; `code:` is a preview; tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, which may differ. Session Goal is a condensed excerpt; recall the original for constraints. Use vcc_recall: scan searches saved fields; read pages through long records.
   - 长度 439 字符（原 395，+44），仍是 4 个 wrap 行。
3. `src/core/summarize.ts:470-495`（`notePattern` / `stripKnownNotes`）：剥离链从 2 条变 3 条，按**最长优先**依次应用（`HISTORICAL_NOTE` → `HISTORICAL_NOTE_013` → `LEGACY_HISTORICAL_NOTE` → `RECALL_NOTE`）。
4. **不动** `src/codemode/summary.ts:88-95`：旧路径的 `* codemode -> read, bash | goal: <goal>` 是上游兼容面，与 A+B 所在路径互斥（前者只在会话无 codemode 历史时使用）。两处共享词汇 `goal`，这正是 A 的目的（消除 `intent` / `goal` 两套叫法）。

**测试**：

| 文件 | 现状 | 改动 |
|---|---|---|
| `tests/brief.test.ts:414,417` | 断言 `normalNav === "intent: 检查缓存"` 与整行 | 改为无标签形状；**新增**一条 code 兜底形状与一条"无 goal 无 code"形状 |
| `tests/brief-history.test.ts:221,320,375,401,403,421,456,457,492,592` | 11 处内含 `intent:` 子串断言 | 改为 `* codemode <goal> (#N)` |
| `tests/context-edits.test.ts:329,377` | 2 处 | 同上 |
| `tests/rank.test.ts:363-366` | 整段 pin `HISTORICAL_NOTE` | 更新为 0.1.4 文本 |
| `tests/brief-history.test.ts:506` | "剥离两种 note" | 扩展为三种（0.1.4 / 0.1.3 / 0.1.2），并断言 0.1.3 摘要再压缩时 note 不叠加 |
| `tests/fixtures/allocator-golden.json` | 242 例，存全文或 sha256 | **重生成**（单独 commit，`generatedFromCommit` 更新）；diff 只应出现前缀变化 + 空引用行消失 |
| 新增 | — | 合成用例：goal 行不含 `intent:`/`goal:`、`code:` 行含标签、note 在全文中恰好出现一次 |

**文档**：`README.md:26`（对照表）、`:49-51`（示例）、`:77`（`// goal:` 段落里"shown as `intent:`"）、`:129`、`:281`、`:287`；`CHANGELOG.md` `[Unreleased] → Changed`；`AGENTS.md`：把"简报行"约束补一句（新路径 goal 行无标签，`code:` 为兜底，标签名统一为 `goal`）。

**验收**：`rg -c "codemode intent" src tests README.md` 只应命中 `HISTORICAL_NOTE_013` 相关注释；15 会话台账复算 `dLine ≥ +8%`、`dPayload ≥ +8%`、`refOnly = 0`；审计 `ratio` 中位不降。

**风险**：无标签行被读成"结果"而非"声明" → 由三条防线兜住：(a) note 新增句写明"unlabeled … goals are past statements"；(b) `{error observed; result #R}` 仍是唯一的结果性标记；(c) 观测到的错误不走注解通道（AGENTS.md 既有规则）。若评审认为防线不足，退化为 A 单独（保留 `goal:` 标签），代价见 §2.2（−6.8 pp）。

### 4.2 P2 空引用行（0.25 天）

**根因链**（5 步，均可单测）：宿主写入 `[thinking, text("\n"), toolCall…]` → `normalize.ts:79-84` 产出 assistant block（`sanitize` 不 trim）→ `brief.ts:641` 只判 falsy，`"\n"` 通过 → `excerptText`（`brief.ts:734`）原样返回 → `attachRef`（`brief.ts:749-753`）拼 ` (#N)` → `rank.ts:592` + `:617-618` 输出"引用行 + 空行"。

**改动点**：`src/core/brief.ts:641`

```ts
if (!block.text || !block.text.trim()) return;
```

不改 `normalize`，不改 `attachRef` 的通用行为（tool 行仍在用），不改预算输入。

**测试**：

- `tests/brief.test.ts`：新增"空白 assistant 文本不产生候选"用例（输入 `[thinking, text("\n"), toolCall]`）。
- `tests/brief-history.test.ts` / `tests/allocator-golden.test.ts`：新增**形状不变量** —— 编译后的简报中不存在 `/^\s*\(#\d+\)\s*$/` 的行，且 `[user]` / `[assistant]` 头后不紧跟空行。
- 断言只钉形状，不钉行数（行数随分配器演化）。

**验收**：15 会话 `refOnly: 41 → 0`，空行 `410 → 375`。**记录副作用**：P2 单独运行时工具行 −1.7%（三次独立运行同值；分母随语料 ±2 漂移），释放的额度被 assistant 借走（§3.3）；与 A+B 组合后净效果仍为 +9%。本版**不**改借额。

**为什么可以丢引用**：被丢的条目没有可见正文；`scan`/`read` 从保存的消息字段读取，不依赖简报里是否出现这行。

### 4.3 P3 `details.sections` 来自结构（0.4 天）

**改动点**：

1. `src/core/summarize.ts`：`BriefPlanDetail` 增加 `headerNames: string[]`（顺序 = `HEADER_NAMES`，只含实际非空章节）。
   - 新路径：`headerSections.map(s => s.name)`（已有数据）。
   - 旧路径（`compileWithBriefBlocks`）：由同一个 `SectionData` 计算非空章节，避免再扫文本。
2. `src/hooks/before-compact.ts`：把 `compileRanked(...)` 换成 `compileRankedWithDetail(...)`，`:862`（debug）与 `:870`（`details.sections`）改为使用 `detail.headerNames`；删除两处 `/^\[(.+?)\]/gm`。

**语义**：`details.sections` 从"摘要文本里所有行首方括号词"变为"实际渲染的非空章节名"。字段名与类型不变；`version` 保持 `2`（该字段无消费者：`grep -rn '\.details' src` 仅判断 `compactor`），在 CHANGELOG 写清收窄。

**测试**：

- `tests/before-compact-hook.test.ts` 新增：构造摘要正文含 `[user]` / `[assistant]` / `[omitted …]` → 断言 `details.sections` 等于真实章节名数组，且不含 `user` / `assistant` / `omitted`。
- 同一用例断言 `summary` 与修复前**逐字相同**（P3 只动元数据）。
- 真实压缩条目抽样（人工）：`sections` 全部 ∈ `HEADER_NAMES`，数量 = 非空章节数。

### 4.4 P4 版本与文档（0.2 天）

- `package.json` → `0.1.4`；`CHANGELOG.md` `[0.1.4]`：把现 `Known issues` 的 D1/D3 两条移入 `Fixed`，行格式入 `Changed`，D6 入 `Fixed`（若 P5 完成）。
- `README.md`：§What changes 对照表、brief 示例、`// goal:` 段落、有界性说明。
- 发布物检查：`npm pack --dry-run` → 50 文件左右、0 个 `*.bak`、不含 `dist/` 与 `research/`。

### 4.5 P5（应做）`Ignored:` 指明实际动作（0.2 天）

**改动**：`src/core/recall-run.ts:156-175` 增加动作标签表（`search → "hybrid query"`、`scan → "literal scan"`、`recent → "recent entries"`、`drill/touched/expand/range/read` 同理），`ignoredNote` 在存在 `dropped`/`ignored` 时追加 `; ran <label>`。

示例（`mode:"scan"`）：`Ignored: mode "scan" (use 'touched' or leave it out); ran hybrid query.`

**测试**：`tests/recall-request.test.ts:60-88` 之外**新增**一个 `mode:"scan"` 用例，断言首行文案同时包含"被忽略的值"与"实际执行的动作"。

**理由**：反馈文档 D6 的残留问题正确定位为"文案不完整"，不是静默降级。改动面小、可单测、用户可见。

### 4.6 P6（应做）度量补齐（0.3 天）

1. `scripts/codemode-brief-audit.ts` 的 `perSession` 增加：`prefixChars`（目标行前缀总字符）、`refOnlyLines`、`blankLines`、`headerNamesMatches`（`details.sections` ⊂ `HEADER_NAMES`）。
2. 新增**合成夹具**路径（不依赖真实会话）：一组确定性 codemode 候选（goal 长/短、无 goal、空白文本），断言"前缀每行省 8 字符 → 同预算下多 `k` 行"，使外部评审可在无 `~/.pi/agent/sessions` 的机器上复算 §2.2 的方向与量级。
3. `tests/real-sessions.test.ts` 保持"仅在本地会话存在时运行"的现状。

---

### 4.7 改动面一览

| 文件 | 改动 | 关联测试 |
|---|---|---|
| `src/core/brief.ts` | P2 候选过滤；P1 目标行去标签 | `brief.test.ts`、`brief-history.test.ts`、`allocator-golden.test.ts` |
| `src/core/format.ts` | P1 note 文本 + 0.1.3 变体 | `rank.test.ts`、`brief-history.test.ts`、`context-edits.test.ts` |
| `src/core/summarize.ts` | P1 剥离链；P3 `headerNames` | `brief-history.test.ts`、`before-compact-hook.test.ts`、`context-edits.test.ts` |
| `src/hooks/before-compact.ts` | P3 改调 `compileRankedWithDetail`，删两处正则 | `before-compact-hook.test.ts`、`before-compact.test.ts` |
| `src/core/recall-run.ts`、`src/core/recall-request.ts` | P5 文案 | `recall-request.test.ts` |
| `tests/fixtures/allocator-golden.json` | 重生成（单独 commit） | `allocator-golden.test.ts` |
| `scripts/codemode-brief-audit.ts` | P6 计数 | 无单测；输出人工核对 |
| `README.md`、`CHANGELOG.md`、`AGENTS.md`、`package.json` | P4 | — |

---

## 5. 契约变更清单（对外）

| 接口 | 0.1.3 | 0.1.4 | 谁依赖 |
|---|---|---|---|
| 简报 codemode 目标行 | `* codemode intent: <goal> (#N)` | `* codemode <goal> (#N)` | agent（导航）、人（TUI 摘要）、README |
| 简报 codemode 兜底行 | `* codemode code: <preview> (#N)` | 不变 | 同上 |
| 旧路径 codemode 行 | `* codemode -> a, b \| goal: <goal>` | 不变（互斥路径） | 非 codemode 会话 |
| 阅读 note | 395 字符（0.1.3 文本） | 439 字符（新增无标签说明） | agent |
| note 剥离 | 2 个历史变体 | 3 个（0.1.4 / 0.1.3 / 0.1.2） | 重复压缩 |
| `details.sections` | 摘要文本行首方括号词（含正文污染） | 实际非空章节名（⊂ `HEADER_NAMES`） | 无内部消费者；外部统计/UI 需知悉 |
| 空引用行 | 可能出现 ` (#N)` | 不再出现 | agent/人 |
| `Ignored:` 行（P5） | 只列被忽略项 | 追加 `; ran <action>` | agent（自我纠错） |
| 预算 / 配额 / 排序 | — | **不变** | — |

---

## 6. 四条对外不保证（沿用 0.1.3 风格）

1. **行数不保证**：预算按 UTF-16 字符计，不同说话风格下列数会变。
2. **goal 正文长度不保证**：`short` ≤ 80、`normal` ≤ 200 字符，超出以 `…` 截断。
3. **`#N` 稳定但不连续**：新增消息占用新号；折叠区间用计数标记给出可检索边界。
4. **note / header 先计费**：note 与章节头占预算约 10%，不随会话规模线性增长。

---

## 7. 发布门（确定性）

| 门 | 命令 | 期望读数 |
|---|---|---|
| 依赖 | `bun install --frozen-lockfile --ignore-scripts` | 无变更 |
| 类型 | `bun run typecheck` | 通过 |
| 测试 | `bun test` | 867 + 新增（约 +8～12）全绿，0 fail |
| 旧宿主 | `npm i --no-save @earendil-works/pi-coding-agent@1.0.0 … && bun run typecheck && bun test` | 通过（AGENTS.md 命令），随后 `bun install --frozen-lockfile` 还原 |
| 度量 | 审计脚本（15 会话） | `refOnly=0`；`medianRatio ≥ 0.98`；`prefixChars` 下降；`headerNamesMatches=100%` |
| 包体 | `npm pack --dry-run` | ≈50 文件、0 `*.bak`、无 `dist/`/`research/` |
| 版本身份（D2） | 发布后 `npm view pi-vcc-codemode version` + `pi list` + 安装副本 `grep -c CostMeter src/core/rank.ts` | `latest = 0.1.4`；`pi list` 只有一条注册；安装副本为 0.1.4 且含当版修复；`dist/` 保持不存在/空 |
| 真实路径 | 一次 `/pi-vcc` + `/pi-vcc-recall` | 压缩条目的 `details.sections` ⊆ `HEADER_NAMES`；简报无空引用行 |

---

## 8. 度量与可复现性（供评审独立核对）

| 项 | 说明 |
|---|---|
| 数据集 | 本机 `~/.pi/agent/sessions`（95 文件 / 15 个有效 codemode 会话）。**不提交**、不引用正文。快照在测量期间仍在增长（当前会话在写），故绝对值 ±2 漂移 |
| 脚本 | `research/an23..an28.ts`（git-ignored）。P6 将把三条计数并入 `scripts/codemode-brief-audit.ts`，使其可被评审重跑 |
| 证据分级 | **确定**＝代码路径 + 单测可钉住（D3 五步链、D1 正则）；**强**＝n=15 聚合（§2.2–2.4）；**弱**＝n=1 示例（单会话 9 条 ref-only、5721 字符预算反推）；**未验证**＝模型在真实长会话中对无标签行的解读 |
| 已知偏差 | 不同脚本修订的基线行数 ±2（计数规则差异）；固定 `charsPerToken=4` 与真实 hook 校准值（2–6）不同 → 已给敏感性表 |
| 反例/边界 | 本语料中 `code:` 兜底行出现 0 次；因此"兜底形状仍可用"只有单测覆盖，无真实数据 |

---

## 9. 风险登记与回退

| 风险 | 概率 | 影响 | 缓解 | 回退 |
|---|---|---|---|---|
| 无标签行被读成"结果" | 中 | agent 误把历史目标当作当前状态 | note 新句 + `{error observed}` 唯一结果标记 + AGENTS.md 规则 | 退化为 A 单独（保留 `goal:` 标签），单 commit 可切回 |
| note 变长挤压小会话 | 确定 | 小会话 −1.0 pp 内容 | 已量化（§2.4）；P6 记录每会话 note 占比 | 条件追加（仅在存在 goal 行时）——需两套 note 文本与剥离规则，成本高，暂不做 |
| 改行格式导致外部脚本失效 | 低 | 依赖文本匹配的下游工具 | §5 契约清单 + CHANGELOG；旧路径形状不变 | 同上 |
| golden fixture 重生成掩盖真实回归 | 中 | 评审难以确认只有前缀变化 | fixture 单独 commit，diff 必须只含前缀/空行差异；测试断言形状而非行数 | 保留 0.1.3 fixture 作为第二份对照 |
| P3 改 `details` 语义无人复核 | 低 | 外部统计读到不同内容 | 契约清单 + `headerNamesMatches` 审计计数 | 元数据修改可独立 revert，不影响摘要文本 |
| P2 后工具行 −1.7% | 确定 | codemode 覆盖略降 | 记录在案；A+B 的 +9.2% 仍净正 | 与 A+B 同版本发布，不做单独回退 |

---

## 10. 未决问题（请评审明确）

1. **A+B 的"无标签"是否可接受？** 若不接受，退化为 A 单独（保留 `goal:`），代价 −6.8 pp 行覆盖（§2.2）。
2. **note 增长 44 字符**：接受统一文本，还是改为"仅在存在 codemode 目标行时追加"（需两套 note + 两套剥离规则）？
3. **`details.sections` 语义收窄**是否需要 `version: 3`？内部无消费者，但外部可能有统计脚本。
4. **P2 的额度流向**（工具行 −1.7%）：本版接受，还是同版一并做借额顺序实验（会增加不可归因风险）？
5. **D5（`-p` 无回执）**：是否值得在 0.1.5 与宿主确认为前置条件？
6. **P5 文案**是否包含具体动作名（`hybrid query` / `literal scan`），还是保持"ran a query"这种中性表述？

---

### 10.1 本计划可被推翻的条件（事先声明）

1. 若评审在自己的语料上复算 A+B 的行增益 **< +5% 或为负**，P1 退化为 A 单独（保留 `goal:` 标签），B 取消。
2. 若 P2 与 A+B 组合后的总行增益 **< +6%**，重新评估是否把借额顺序修复并入同一版本。
3. 若真实会话出现 **≥2 例**「无标签 codemode 行被模型当作当前状态/结果」的实例，P1 回退为保留标签。
4. 若 `details.sections` 存在未预料的外部消费者，P3 改为**新增**字段（保留 `sections` 旧语义），而不是收窄。
5. 若 `bun test` 在 Pi 1.0.0 上不能通过，0.1.4 阻塞发布（AGENTS.md 的 peer 范围要求）。

---

## 11. 附录

### A. 代码锚点

| 位置 | 作用 | 0.1.4 动作 |
|---|---|---|
| `src/core/brief.ts:641` | 候选过滤 `if (!block.text) return` | P2：加 `.trim()` |
| `src/core/brief.ts:734-746` | `excerptText`（head/tail + `[omitted …]`） | 不改 |
| `src/core/brief.ts:749-753` | `attachRef` | 不改（P2 不在此层） |
| `src/core/brief.ts:657-666` | 目标行 nav / code 兜底 | P1：去 `intent: ` |
| `src/core/brief.ts:506-510` | `BRIEF_MIN_TEXT_CHARS=64`、`SHORT=80`、`INTENT=200`、`CODE=80` | 不改 |
| `src/core/rank.ts:303-330`（cost meter）/ `:560-640`（assemble） | 计价与装配（角色头 + 空行） | 不改 |
| `src/core/format.ts:86-95` | note 文本 | P1：新文本 + 0.1.3 降级 |
| `src/core/summarize.ts:470-495` | `notePattern` / `stripKnownNotes` | P1：三条历史变体 |
| `src/core/summarize.ts` `compileWithEffectiveHistory` | 新路径（header 20% 上限、body 40/30/30） | P3：填 `headerNames` |
| `src/hooks/before-compact.ts:862,870` | 两处 `/^\[(.+?)\]/gm` | P3：删除，改 `detail.headerNames` |
| `src/hooks/before-compact.ts:779-784` | 预算公式 | 不改 |
| `src/core/recall-run.ts:156-175` | `IGNORED_REASON` / `ignoredNote` | P5 |
| `src/core/recall-request.ts:131` | `mode` 的 drop 文案 | P5 配套 |

### B. 公式

- 预算：`budgetChars = round(clamp(15 × historyBlocks, 1100, 2000) × charsPerToken)`，`charsPerToken ∈ [2, 6]`
- 保留量：`reserved = note + 分隔符 + header + body 分隔符`；`headerCap = floor((budget − note − SEP) × 0.2)`
- 角色：`user 40% / assistant 30% / tool 30%`，未用配额按 user → assistant → tool 顺序借给"未满"角色
- 文本计价：`keep = min(len, 64)` 起步，按 64 字符步进升级；`[omitted M of T chars; recall #K]` 计入成本

### C. 台账明细（k=1，15 会话汇总）

| 指标 | base | goal | nolabel | CMI | A+B |
|---|---|---|---|---|---|
| 目标行 | 295 | 301 | 321 | 339 | 322 |
| goal 正文 | 8520 | 8696 | 9240 | 9767 | 9282 |
| 空引用行 | 41 | 41 | 41 | 41 | **0** |
| 空行 | 410 | 414 | 408 | 406 | 375 |

### E. 最小复算骨架（无需本仓库研究脚本）

测量快照：2026-10-28，本机 95 个会话文件 / 15 个有效 codemode 会话。筛选条件：有压缩条目 + 有效 codemode 历史（`briefHistoryHasCodemode`）+ 无 `limitedReason` + 至少一条带 `// goal:` 的 codemode 候选。

```ts
const entries = readJsonl(file);
const idx = buildGlobalIndexById(entries);
const last = entries.filter(e => e.type === 'compaction').pop();
const history = buildBriefHistory({ branchEntries: entries, firstKeptEntryId: last?.firstKeptEntryId, globalIndexById: idx, skipCustomTypes: [] });
if (history.limitedReason || !briefHistoryHasCodemode(history)) continue;

const blocks = filterNoise(normalize(history.messages, history.sourceIndices));
const cands = buildBriefCandidates(blocks);
const budget = Math.round(Math.min(2000, Math.max(1100, 15 * blocks.length)) * 4); // 固定 4 字符/token
const detail = compileRankedWithDetail({ messages: [], sourceIndices: [], briefHistory: history, briefBudgetChars: budget }).detail;
if (detail.kind === 'budget-too-small') continue;

// 变体：改候选的 tool.name / shortNav / normalNav（P1）、过滤空白文本候选（P2）、reserved + note 增量
const sel = allocateBriefBudget(variantCands, { maxChars: budget, reservedChars: detail.reservedChars + noteDelta });
```

计数口径（与本计划 §2.1 一致）：

- 目标行：以 `* codemode intent: `（或变体前缀）开头的行；
- goal 正文：目标行去掉行首前缀、行尾 ` (#N)`（含合并写法的 `x2`）与 ` {error observed…}` 后的字符数；
- 空引用行：整行只有 ` (#N)` 的行；空行：长度为 0 的行；
- 全部对 `sel.text` 切分统计，不做二次格式化。

两条必须注意的实现陷阱：

1. `allocateBriefBudget` 的成本按**渲染并 wrap 之后**的字符数计，所以变体必须改**候选对象**（`tool.name` / `tool.shortNav` / `tool.normalNav`），不能只在最终文本上做字符串替换——后者测到的是"文本更短"，不是"分配器能多塞几行"。
2. 同一份语料在两次运行间行数会有 ±2 漂移（会话目录在测量期间仍在增长），比较必须在同一次运行内完成。

### D. 对反馈文档的更正清单

1. **D3 根因**：不是"越界裁剪到 0 字符"（`BRIEF_MIN_TEXT_CHARS=64`，keep 不可能为 0）；是宿主持久化的空白 text part（`[thinking, text("\n"), toolCall…]`，全机 103/6209）+ 候选过滤只判 falsy + `attachRef` 无条件拼引用。
2. **D3 覆盖面**：旧路径（`buildBriefSections`）本来会丢弃这些块，因此这是**新路径独有**的回归，不是上游行为。
3. 反馈文档 §9 的两处自我更正沿用，不重复。
