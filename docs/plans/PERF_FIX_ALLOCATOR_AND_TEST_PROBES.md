# 性能修正计划 v2（评审后修订）

- 日期：2026-10-28
- 状态：**仅备份与计划，源码零改动**（`git diff` 为空）；等待批准第 0 步与 D1–D4 修订结论。
- 被审版本：`docs/plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES.md`（v1，已归档到 `research/.backup/perf-fix/`）。
- 评审输入：`docs/plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES_REVIEW.md`（有条件批准）。
- 代码基线：HEAD `a59fdad`，`bun test` 622 pass。

## 1. 评审意见核验

### 1.1 逐条核验结论

| 评审断言 | 独立核验（本机 Bun 1.4.4 / Node 24.19 / Windows） | 处置 |
|---|---|---|
| `rank.ts:521-525` 存在同类 `Math.min(...spread)`（v1 遗漏） | 确认存在 | **采纳**，纳入 F1.c |
| `tools.omitted[0].order` 必然是最小值 | 基本成立：candidates 按历史顺序生成，`filter` 保序，`assemble` 到末尾才 sort。但为避免依赖该不变量，**改用显式循环取最小值**（O(n)、零分配、与顺序假设无关） | 部分采纳 |
| F2.a 在 `debug: true` 时空指针崩溃 | 确认存在，**且比评审所述更严重**：`before-compact.ts:825` 的 `dbg(config, {...})` 是普通函数调用，载荷在调用前**无条件构造**，851-853 的 `briefHistory.messages.length` / `.hadCodemodeHistory` 每次 plain 压缩都会求值 → 与 debug 开关无关，必定抛 `TypeError` | **采纳并修正表述**；据此否决 F2.a |
| `report.ts` 是唯一生产不可达模块 | 确认（BFS：46/47 可达） | 采纳 |
| npm 打包泄漏 `.bak` | 确认。修订前：71 文件 / 640,564 B，其中 20 个 `.bak`（含我新增的 3 个 `.pre-perf.bak`）；`.gitignore` 无 `*.bak`，`files: ["src/"]` 无条件收录 | 采纳；**已先行把 11 个备份迁出 `src/`**（见 §8），现在 68 文件 / 562,874 B / 17 个 `.bak`（156,387 B，占解包体积 27.8%） |
| F1.a 成本计量器收益可复现 | 确认。`research/perf-memo-compare.ts`：p50 **140.74 → 51.51ms（−63.4%）**，`identical: true`，`usedChars 6960` | 采纳 |
| 分配器是 `compileRanked` 的绝对瓶颈 | 确认（相位拆解里分配器占比 >99%）；评审的绝对毫秒与本机有差异（193.77 vs ~155），结论同向 | 采纳，但计划只写区间 |
| 折叠循环里的 `entries.slice(0, fold)` 仍会保留 O(n²) 分配 | 确认（`rank.ts:351-352`），v1 只写了“前缀和”，未明确删除 slice | 采纳 |
| `brief.ts` 需导出格式化函数以避免模板双写 | 同意；但**同时需要修 `searchRange` 内的 `Math.min(...nums)/Math.max(...nums)`**（见 1.2） | 采纳 + 补强 |
| 130k 候选压测可验证 spread 修复 | **不成立**：Bun 1.4.4 在 500,000 元素仍不抛，1,000,000 才抛；Node 24 在 130,000 抛。测试运行时是 Bun，该用例只会变成慢测试，无法证明修复 | 修正测试策略（§6.3） |
| 移动 `report.ts` 后“由 `bun test` 做类型检查” | **不成立**：`typecheck` 是 `tsc --ignoreConfig ... index.ts`（无 tsconfig），tests 完全不参与；`bun` 只剥离类型不检查。移动后该文件与今天一样不受 typecheck 覆盖 | 采纳迁移，但不宣称获得类型检查 |
| 评审给出的调用计数（text 140,987 / tool 44,303 / fold 48,671 / “重试 14 次”） | **口径错误**：这些是 `research/perf-memo-compare.ts` 累计 6–7 次迭代的总量。单次分配实测 `{"text":20141,"tool":6329,"fold":6953,"attempts":2}`；且 14 > 重试上限 8，单次调用不可能 | 修正（不影响结论） |

### 1.2 评审遗漏的一处缺陷（必须补进 F1.c）

`src/core/brief.ts:766-771` 的 `searchRange` 自身对整段候选做 `Math.min(...nums)` / `Math.max(...nums)`。它被 `renderToolOmissionMarker` 与 `renderTextOmissionMarker` 在**折叠/省略整段候选**时调用：一旦省略条目达到 Node 的实参上限（≈13 万），崩溃点在 `brief.ts`，只改 `rank.ts:522/643` 无法避免。F1.c 必须把它改成循环。

### 1.3 对评审的总体判断

- 事实层：性能诊断、瓶颈定位、F2.a 崩溃风险、打包污染、`report.ts` 不可达 —— **真实**。
- 判断层：剔除 F1.d、否决 F2.a、采纳方案 A —— **合理**（我原计划已默认不做 F1.d，F2.a 的收益确实只有 ~1ms / 0.6%，且会复制 AGENTS 里“两层门控”的逻辑，维护风险大于收益）。
- 数据层：绝对值有三处偏差（累计计数、debug 条件、130k 压测在 Bun 下无效），另有 1 处遗漏（`searchRange`）与 1 处错误（typecheck 说法）。均已在 §1.1 修正，不改变批准结论。
- 结论：**按评审意见修订计划，F1.a+b+c + F2.b 推进，F2.a 与 F1.d 删除。**

## 2. 修订后的范围

| 项 | 状态 | 内容 |
|---|---|---|
| F1.a | 做 | 单次调用生命周期的 `CostMeter`（text/tool/marker），显式参数透传，8 次重试共用，返回即释放 |
| F1.b | 做 | `brief.ts` 新增 `formatTextOmissionMarker`；`rank.ts` 折叠改前缀和 + 增量 min/max，**删除循环内 `slice+map`** |
| F1.c | 做 | 三处 spread：`rank.ts:522`、`rank.ts:643`、`brief.ts:766-771`；全部改循环 |
| F1.d | **删除** | 轮转增量成本记账，风险高、收益未证，不再保留为备选 |
| F2.a | **删除** | 见 §1.1；且 `compileRanked` 也消费 `briefHistory`/`briefBudgetChars`（`summarize.ts:445`），短路需伪造“未激活”对象，进一步增加耦合 |
| F2.b | 做（方案 A） | `git mv src/core/report.ts tests/support/report.ts`，改 8 条相对导入 + 3 个引用方 |
| Phase 0 | **待批准** | 打包卫生：`package.json` 的 `files` 加负模式、`.gitignore` 加 `*.bak` |

明确不做：smart-keep 的 152ms（0.1.2 起既有，本计划不动）；任何预算/文案/评分变更；版本号与发布。

## 3. 详细设计

### 3.1 F1.a `CostMeter`

```ts
interface CostMeter {
  text(candidate: BriefCandidate, keepChars: number): number;
  tool(candidate: BriefCandidate, version: "short" | "normal"): number;
  marker(text: string): number;
}
const createCostMeter = (): CostMeter => { /* WeakMap ×2 + Map<string, number> */ };
```

- key：`WeakMap<BriefCandidate, Map<number, number>>`（文本）与 `WeakMap<BriefCandidate, Map<"short"|"normal", number>>`（工具）。**marker 用普通 `Map<string, number>`**（字符串不能做 WeakMap 键）。
- 生命周期：只在 `allocateBriefBudget` 内创建，作为参数传入 `allocateOnce` → `allocateTextRole`/`allocateToolRole`/`assembleBriefBody` 的成本调用点；8 次重试共用（候选与 keep 不变，成本不变），函数返回即整体不可达。禁止模块级缓存。
- 规模：实测单次分配约 2.0 万次文本成本、6.3k 次工具成本，去重后 Map 条目 ~万级、约 1–2MB，返回即释放；不做 LRU/上限。
- 等价约束：缓存值必须恒等于原式（新增 §6.1 测试）。

### 3.2 F1.b 折叠 O(n)

`brief.ts` 新增：

```ts
export const formatTextOmissionMarker = (
  role: "user" | "assistant",
  count: number,
  range: { min: number; max: number } | null,
): string => `[${count} older ${role} ${count === 1 ? "message" : "messages"} omitted${
  range ? `; scan saved history #${range.min}..#${range.max}` : ""}]`;

export const renderTextOmissionMarker = (role, omitted) =>
  formatTextOmissionMarker(role, omitted.length, numericRange(omitted));
```

（`numericRange` = 现 `searchRange` 的“全部为 number 才给区间”语义，改用循环，F1.c。）

`rank.ts` 的 `allocateTextRole`：

1. 预计算 `prefix[0..n]`（整数成本，远低于 2^53，无精度风险）；
2. `fold` 从 1 递增时增量维护 `min`/`max`/`allNumeric`，`keptCost = prefix[n] - prefix[fold]`；
3. 每步只调一次 `formatTextOmissionMarker` + `meter.marker`，**循环内不出现 `slice`/`map`/`reduce`**；
4. 语义保持：第一个满足 `markerCost + keptCost <= quota` 的 fold 被选中；循环走完仍未满足则“折叠全部、只留标记”；`allNumeric=false` 时标记不带区间后缀，与现状逐字一致。

不采用二分查找：成本序列在极小文本下可能出现 1–2 字符的平局，首个满足点必须与线性扫描一致，二分会把“等价”变成“近似”。

### 3.3 F1.c 三处展开点

| 位置 | 现状 | 改法 |
|---|---|---|
| `rank.ts:521-525` | `Math.min(...tools.omitted.map(c => c.order))` | 与同文件文本标记路径统一：`omitted[0].order`（保序前提已验证）或循环最小值；采用循环，O(n) 一次、零分配 |
| `rank.ts:643-649` | `Math.min(...candidates.map(...))` | 普通 `for` 循环求最小值，同时天然复用 §3.1 缓存（现状此处每个文本候选要渲染 2 次） |
| `brief.ts:766-771` | `Math.min(...nums)` / `Math.max(...nums)` | 循环 min/max，保持“遇非 number 直接返回空”的语义 |

实测上下文：Bun 1.4.4 在 50 万实参下不抛、100 万抛；Node 24 在 13 万抛。**生产宿主是 Node（Pi 作为 npm CLI 运行），故这是真实但低概率（需 >13 万候选/块）的崩溃面**；修复成本 ~10 行、无行为变化，属廉价去风险，**不作为性能项宣传**。

### 3.4 F2.b 迁移

- `git mv src/core/report.ts tests/support/report.ts`；相对导入 `./build-sections`、`./content`、`./normalize`、`./render-entries`、`./search-entries`、`./summarize`、`./token-estimate` 改为 `../../src/core/*`。
- 引用方：`tests/report.test.ts:2`、`tests/real-sessions.test.ts:5`、`scripts/benchmark-real-sessions.ts:3` → `../support/report` / `support/report`（按各自相对根调整）。
- 不改 `typecheck` 脚本（评审同意；且现状 tests 本就不参与 typecheck，移动不会降低覆盖，也不会获得覆盖）。
- `package.json` 的 `files` 是否顺带排除无用文件，归入 Phase 0。

### 3.5 Phase 0 打包卫生（待批准，独立于 F1/F2）

1. 已执行：11 个 `.pre-perf.bak` 迁至 `research/.backup/perf-fix/`（git 忽略，校验值见 §8）。这一步已经把 tarball 从 71 文件/640,564 B 降到 68 文件/562,874 B。
2. 待批准：`package.json` → `"files": ["index.ts", "src/**/*.ts", "!src/**/*.bak", "README.md", "LICENSE", "CHANGELOG.md"]`。
3. 待批准：`.gitignore` 追加 `*.bak`。
4. 仍需批准才做的旧备份清理（v1 的“第 3 条”）：17 个遗留 `.bak`（`README.md.bak` + 16 个 `src/**`），共 156,387 B。**只做第 2 步即可让发布包干净；删除本身可延后**，但二者建议一起做，避免下次误提交。

## 4. 不变量

1. 输出逐字不变：`compileRanked().summary`、`allocateBriefBudget().{text,usedChars,reservedChars,kind,counts}`、标记文案（含/不含 `scan saved history #a..#b`）。
2. 非 codemode 路径（8 条直接工具规则、120 行 cap、`RECALL_NOTE`）完全不变。
3. 预算硬门、note 只出现一次、重试公式（`structure` 累积、8 次上限）不变。
4. 「首个满足配额的 fold」语义不变；upgrade/round-robin 顺序不变。
5. `#N` 出处与折叠索引不变。

## 5. 等价性验证

改动前用**未修改**实现生成 `tests/fixtures/allocator-golden.json`，改动后逐字比对。评审要求的三类边界全部纳入：

1. 空候选取 `budget-too-small`；候选唯一且预算刚好卡在最小成本。
2. `sourceIndex === undefined` 的混合折叠（全部无编号 → 无区间后缀；部分有 / 部分无 → 无后缀）。
3. 极端大文本（8000+ 字符）引发的多轮 fold + upgrade 交叉。
4. 需 2 次以上重试才能收敛的预算（`structure` 累积路径）。
5. 工具省略标记与文本省略标记同时出现（两者顺序由 `order - 0.5` 决定）。

存储策略（避免大夹具）：40 个小规模用例存完整文本；200 组固定种子随机用例只存 `seed/参数 + sha256(text) + usedChars + kind + counts`，测试内用同一 PRNG 重建输入。

## 6. 测试计划

### 6.1 F1.a
`cost meter equals the uncached formula`：随机候选 × keep 抽样，缓存值 === `wrapLongLines(renderTextCandidate(...)).length + 1`；工具同理。

### 6.2 F1.b
`fold selection matches a linear reference`：测试内保留 v1 的 `slice+render` 参考实现，对同一输入比较选中的 fold、标记文本、`usedChars`（参考实现只存在于测试）。

### 6.3 F1.c
不写 130k 运行时用例（§1.1：Bun 不抛、且极慢）。改为：
1. **源码守卫测试** `tests/spread-min-guard.test.ts`：读 `src/core/rank.ts`、`src/core/brief.ts`，断言不存在 `Math.min(...` / `Math.max(...`（含注释说明）。
2. 保留一个 **2000 候选** 的功能用例证明大集合仍正常分配（成本 ~几十 ms，不拖慢套件）。
3. 可选（不进 CI）：`research/` 下的 Node 子进程脚本，演示 13 万实参下的崩溃边界。

### 6.4 F2.b
迁移后 `tests/report.test.ts`、`tests/real-sessions.test.ts`（有本地会话时）、`scripts/benchmark-real-sessions.ts` 各跑一次；不新增断言。

### 6.5 回归
`bun run typecheck` + `bun test`（≥622 pass，不得减少）+ `scripts/codemode-brief-audit.ts --synthetic --timing`（预算/note 计数不变）。

## 7. 性能门（修订）

同一合成夹具（1800 messages / 1797 候选 / budget 8000）：

| 项 | 现状 | 门 |
|---|---|---|
| `allocateBriefBudget` p50 / p95 | 140.7 / ~174ms | **≤60 / ≤90ms** |
| `compileRanked` 新路径 p50 | ~155ms | **≤80ms** |
| 端到端 codemode hook p50 | 315ms | **≤220ms**（剩余主要是 152ms smart-keep） |
| 旧路径 `compileRanked` p50 | 3.6ms | **≤3.8ms**（不回退） |
| 单次分配渲染次数 | text 20,141 / tool 6,329 / fold 6,953 | 文本渲染次数显著下降（参考信号，非硬门） |
| `--synthetic --timing` 2000 块 p95 | 194ms | ≤1500ms（0.1.3 门不变） |

（v1 的 “plain 全历史工作 ≤0.2ms” 门随 F2.a 删除而移除。）

## 8. 备份与回滚

备份已迁至 `research/.backup/perf-fix/`（`research/` 已在 `.gitignore`，不会再进发布包），命名以原路径 `/` → `__` 映射：

```
src_core_rank.ts.pre-perf.bak                         8e59e380386b28a7
src_core_brief.ts.pre-perf.bak                        e5d44f064dac7802
src_core_report.ts.pre-perf.bak                       3d589e0844dfeb58
src_hooks_before-compact.ts.pre-perf.bak              41bbcaf878509705
tests_rank.test.ts.pre-perf.bak                       da55b34ede12bf7f
tests_brief.test.ts.pre-perf.bak                      ec46bf18154908e5
tests_report.test.ts.pre-perf.bak                     e7e9333339d2cb1b
tests_real-sessions.test.ts.pre-perf.bak              d9971bdd1c414e28
scripts_benchmark-real-sessions.ts.pre-perf.bak       780a90d87f6eaa83
package.json.pre-perf.bak                             41e5aacbe561d159
docs_plans_PERF_FIX_ALLOCATOR_AND_TEST_PROBES.md...   d036bc8f23a45ec4（v1 计划）
```

恢复：按映射拷回原路径，或 `git checkout a59fdad -- <file>`。`before-compact.ts` 与 `package.json` 的备份在 F2.a/F1.d 删除后仅作应急预案，不预期使用。

## 9. 实施步骤（批准后）

0. **[待批准]** 打包卫生：`files` 负模式 + `.gitignore`；`npm pack --dry-run` 复核 `.bak` 归零。（备份迁出已完成）
1. 冻结 golden（`tests/fixtures/allocator-golden.json`，取自未修改实现）。
2. F1.a `CostMeter` + §6.1 测试 → `bun test` 全绿。
3. F1.b `formatTextOmissionMarker` + 前缀和增量（`brief.ts`/`rank.ts`）+ §6.2 测试 → golden 逐字一致。
4. F1.c 三处循环化 + §6.3 测试。
5. 跑 §7 门禁，记录前后数字；未达门则停在报告，不擅自扩范围。
6. F2.b 迁移 + 3 处导入 + 冒烟。
7. `typecheck` + 全量 `bun test` + 审计合成计时；`research/reachability.mjs` 应显示 `src/` 不可达 0 文件。
8. `CHANGELOG.md` `[Unreleased]` 记一条内部性能说明（是否记待批准）；`AGENTS.md` 仅在 Phase 0 获批时补一句“备份不得留在 `src/`”。
9. 不提交、不推送、不发布；回报实测数字与偏差。

## 10. 待批准事项

1. **P0**：`package.json` `files` 负模式 + `.gitignore` `*.bak`（建议批准，1 行改动，立即让发布包不含备份）；是否同时删除 17 个遗留 `.bak`（156,387 B）？
2. **P1**：确认 D1–D4 修订结论（F1.a+b+c、删 F1.d、删 F2.a、F2.b 方案 A）。
3. **P2**：`CHANGELOG` 是否记入内部性能条目。

## 11. 执行记录（2026-10-28，已批准范围全部落地）

### 11.1 结果

| 项 | 现状（改动前） | 结果 | 门 |
|---|---|---|---|
| `allocateBriefBudget` p50 / p95 | 140.74 / ~174ms | **14.26 / 18.62ms** | ≤60 / ≤90 ✅ |
| `compileRanked` 新路径 p50（`perf-probe-breakdown`） | 185.84ms | **20.82ms** | ≤80 ✅ |
| 其中分配器（同一 harness） | 185.59ms | **19.08ms** | — |
| 旧路径 `compileRanked` | 3.6ms | 未改动（3.6ms） | ≤3.8 ✅ |
| `--synthetic --timing` p95 | 194ms（0.1.3 记录） | **20.88 / 21.17ms** | ≤1500 ✅ |
| tarball | 68 文件 / 562,874 B / 17 个 `.bak`（HEAD + 备份迁出后） | **50 文件 / 405,047 B / 0 个 `.bak`** | 干净 ✅ |
| `src/` 不可达模块 | 1（`core/report.ts`） | **0**（46/46 可达） | 0 ✅ |
| 测试 | 622 pass | **867 pass / 0 fail**（622 + 243 golden + 2 guard） | ≥622 ✅ |

### 11.2 等价性证据

- `tests/fixtures/allocator-golden.json` 由**未修改**实现生成：242 例（12 手工边界 + 30 小随机 + 200 种子随机），其中 32 例 `budget-too-small`、15 例带 `scan saved history #a..#b`、11 例无区间标记、137 例触发 ≥2 次重试（最多 5 次）。
- `research/verify-before-after.ts`：改动后的 `allocateBriefBudget` 与改动前副本在 **1800 消息 / 1797 候选** 夹具和全部 242 例上 `text`/`kind`/`usedChars`/`reservedChars`/`counts` 完全一致。
- 重试路径核对：`research/rank-timed.ts`（改动前带计数副本）与生产实现在 242 例上 0 差异，重试直方图 `{1:105, 2:67, 3:50, 4:15, 5:5}`。

### 11.3 与计划的偏差（均已处理）

1. **守卫测试先误报**：正则命中了我解释优化原因时写的注释 `Math.min(...spread)`。测试改为扫描前剥离注释，注释也保留（它解释了为什么不用展开）。
2. **守卫测试额外发现两处展开点**：`brief.ts` 的 `omissionMarker`（`droppedRefs`/`keptRefs` 的 `Math.min/max`）。计划只列了三处，实际四处；一并改为 `refBounds` 循环，守卫测试两个文件才全绿。
3. **F1.b 收益大于预估**：只有记忆化的对照测得 51.51ms，曾据此推断折叠改造只能再省几毫秒；实测折叠改造把 63.35ms 拉到 14.81ms。原因是记忆化后剩余时间几乎全在折叠循环的 `slice+map+标记渲染`（1797 候选的二次开销），而不是轮转补齐。
4. **`renderTextOmissionMarker` 保留但已无生产调用方**：按计划保留为 `formatTextOmissionMarker` 的兼容包装；它仍被旧的直接工具路径测试间接覆盖不到，属刻意保留的 API 形状。
5. **F1.d / F2.a 未实施**：按修订范围删除；`before-compact.ts` 与 `package.json` 的备份仍在 `research/.backup/perf-fix/`，未使用。

### 11.4 改动清单

- 生产：`src/core/rank.ts`（CostMeter、前缀和折叠、两处循环取最小）、`src/core/brief.ts`（`formatTextOmissionMarker`、`numericRange`、`refBounds`）。
- 迁移：`src/core/report.ts` → `tests/support/report.ts`（8 条相对导入 + 3 个引用方）。
- 测试：新增 `tests/support/allocator-cases.ts`、`tests/fixtures/allocator-golden.json`、`tests/allocator-golden.test.ts`、`tests/spread-min-guard.test.ts`。
- 打包：`package.json` `files` → `src/**/*.ts` + `!src/**/*.bak`；`.gitignore` 增 `*.bak`；删除 17 个遗留 `.bak`。
- 文档：本计划 §11、`CHANGELOG.md` `[Unreleased]`、`AGENTS.md` 两条规则。

按 §9.9，代码改动**未提交、未推送、未发布**。
