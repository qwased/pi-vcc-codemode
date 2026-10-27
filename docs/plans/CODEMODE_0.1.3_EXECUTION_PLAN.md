# pi-vcc-codemode 0.1.3 执行计划

- 日期：2026-10-28
- 状态：可交接执行；所有实现项尚未开始，不是测试通过或已发布声明。
- 决策依据：[最终审阅与决策记录](./CODEMODE_0.1.3_FINAL_REVIEW.md)。
- 取代范围：取代 [第五稿](./CODEMODE_0.1.3_PLAN.md) 的实施顺序、声明设计、预算、召回与验收规则；旧稿保留，不覆盖。
- 源码基线：`d8d511da6ed041b22b9351e2c0ae15180751c1e5`，`package.json` 版本 `0.1.2`。
- 目标版本：`0.1.3`，不是 `0.13`。

## 0. 下一对话窗口从这里开始

### 0.1 执行目标

在不调用 LLM 生成摘要、不修改原始会话的前提下，让 codemode 简报在固定字符预算内保留更有价值的历史导航，并使完整的已存文本能够被明确检索、分段读取。

本计划已决定产品取舍，不需要再讨论“声明能否用于打分”“是否取消 next”“是否分角色预算”。下一窗口需要先做实施前核验，而不是重新设计整套产品。

### 0.2 首轮工作清单

1. 读取仓库及全局 `AGENTS.md`、本计划和最终审阅；检查 `git status --short` 与当前提交。
2. 当前已有用户未提交的文档改动。只把本计划明确要求的源码、测试和发布说明列入编辑范围，不覆盖其他工作。
3. 在取得既有文件的同位置备份许可后才修改源码；本次文档请求不视为对下一窗口备份操作的默示许可。若未获许可，只问这一项，先做不依赖许可的核验。
4. 按 codebase-memory 技能核对索引、逐改动的调用关系与源码、状态转换矩阵；本文件作为唯一实施计划继续补充 hunk 清单，不再平行创建另一份设计稿。修改本计划本身也遵守备份约定。
5. 核对锁定宿主版本与下表的代码锚点，然后执行 S0；不要先改版本号或将任务标为完成。
6. 不提交、不推送、不发布，不改 CI、权限、依赖范围或用户配置；这些操作需单独授权。

### 0.3 命令与环境

工作目录：`D:/geminiproject/pi-vcc-codemode`；Windows，工具 shell 为 Git Bash，Node 24；项目检查使用 Bun。

```sh
git status --short
git rev-parse HEAD
bun --version
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test
```

测试涉及设置时必须将 `PI_VCC_CONFIG_PATH` 指向临时文件。没有 Bun 时先报告缺失，不以换锁文件或全局安装代替用户确认。真实会话默认不作为必需输入；先用合成夹具完成全部发布门。

## 1. 范围与明确排除

### 1.1 必须交付

- 完整已存文本的显式字面扫描，独立于压缩轮次，并支持有进度的继续扫描。
- 按 `#N` 读取原始字段视图的字符窗口，能连续读完长脚本、长用户消息及深层 nested 参数。
- goal 与受限 blocked 解析；加分有上限，不把注释变成状态或结果。
- 用户、助手正文、工具活动独立预算；头尾摘录、剩余量、稳定出处、原始顺序。
- codemode 新路径取消固定用户条数/总块数门槛；极端预算不足时按明确规则折叠。
- 历史 codemode 候选每轮从有效原始历史重新选择，不再让旧 brief 仅按 120 行裁尾。
- 生产管线审计、跨轮集成测试、非 codemode 兼容验证及文档。

### 1.2 不进入本版

- `effects/verify/done/verified/next` 声明族、当前任务状态机、永久 blocked、意图账本。
- 精确压缩血缘持久化、旧摘要全文索引、custom store 索引、隐藏推理或图片像素检索。
- Goals/Files 全面迁移到有状态账本、精确删除/重命名事实、为消除 Created 空行而反推创建。
- 新的公开预算设置、默认预算上调、新增依赖、CI 修改、修改宿主包或历史 JSONL。
- 将任意输入 user 100%、写类保留率不低于只读、字符增量不超过 2% 同时设成硬门。

## 2. 已核实入口与实施文件

以下行号来自基线，仅用于定位；下一窗口需核对当前内容，不按旧行号盲改。

| 入口 | 已核实行为 | 计划改动 |
|---|---|---|
| `src/types.ts:11-16`、`src/core/normalize.ts:28-55` | 归一化丢失 toolCallId、nestedCalls 与结果状态。 | S2 补最小关联字段，保持 sourceIndex 原语义。 |
| `src/codemode/intent.ts:9-14` | goal 只读第一行或 options 后第二行。 | S2 扩展头部约定区域、受限 blocked、拒绝计数。 |
| `src/codemode/summary.ts:76-93` | 静态工具名与 goal/code 预览。 | 新简报显示短 intent，不把静态名字当实际调用证据。 |
| `src/core/brief.ts:278-425` | 用户有效词截断、助手头尾有效词、段内 8 条工具限制。 | S3 增候选构造/字符渲染接口，保留旧路径。 |
| `src/core/rank.ts:219-282` | 全块排序、80 块、16 最近块、超预算整块跳过。 | S3 新增分角色字符分配，旧导出保留给非 codemode 路径。 |
| `src/core/summarize.ts:197-269` | 旧 brief 按剩余行数裁尾，仅新 messages 进 rank。 | S4 新路径替换整个 brief，旧 headers 按既有规则合并后受预算约束。 |
| `src/hooks/before-compact.ts:224-276,529-778` | 窗口切分、尾部、全局索引与编译入口。 | S4 增历史候选来源，不改变切点规则。 |
| `src/core/format.ts:31-103` | 换行、120 行 cap、尾部 recall note。 | 新路径阅读提示只出现一次，最终换行后再核实字符成本。 |
| `src/core/load-messages.ts:11-44`、`src/core/global-indices.ts` | 会话文件流读取和稳定消息编号。 | 复用计数规则，不能重编号。 |
| `src/core/recall-request.ts:7-36,63-159` | 参数白名单、修复、动作优先级和命令解析。 | S1 同步新增 scan/read/cursor 的解析及冲突规则。 |
| `src/core/recall-run.ts:20-63,115-158`、`src/tools/recall.ts:22-87` | view、派发、schema、提示。 | S1 增新动作及继续读取提示，修正 full 宣称。 |
| `src/core/search-entries.ts:258-327`、`src/codemode/search.ts:11-33` | 默认搜索文本有截断/字段限制。 | 保留默认相关性路径，新增完整字段路径，不通过调大 clip 假装修复。 |
| `src/core/jsonl.ts:12-56` | 64KB 流式分行，无起始偏移/提前停止接口。 | S1 增兼容的起点、停止与字节位置能力，供持续扫描复用。 |
| `scripts/codemode-brief-audit.ts` | 既有审计入口。 | S0/S5 接生产候选和最终编译结果，不复制选择器。 |

允许新增的最小实现模块：`src/core/recall-full.ts`（完整字段视图、扫描/读取）、`src/core/brief-history.ts`（历史候选来源）。候选类型与分配尽量放在现有 brief/rank 模块，不预建大而全的 metadata/state 框架。

## 3. 固定产品契约

### 3.1 兼容分流

- **历史门控**：正常依据有效历史中的 `isCodemodeMessage`，不是依据此刻是否启用 codemode 工具；若原始当前分支含 codemode，但编辑后有效候选为零，仍走本版失效处理和重建，不能回退旧摘要合并而复活内容。
- **提示门控**：仍依据当前 active tools；codemode 关闭时不注入其脚本提示。
- **非 codemode**：原始与有效当前分支均不含 codemode 时，现有压缩路径、8 条直接工具规则、120 行旧 brief 规则、默认搜索返回文本保持不变；新增显式 scan/read 能力可用于所有会话。scan 引导放在工具说明和文档，不追加到旧 query 返回文本。
- **codemode**：新正文预算、阅读提示、跨轮重建属于有意契约变更，小窗口也可能变化；不再要求该类会话逐字不变。
- **混合段**：直接工具先按旧段内逻辑确定原有可保留集合，新路径不从被旧规则淘汰的直接工具中额外恢复；其候选再参与总预算。codemode 不再受旧“8 条＋1000 字符补回”二次裁剪。
- 不改 smart keep-tail 的 5k/25k 规则，也不跟随宿主 keepRecentTokens 改值；显式 keep:N 仍优先。

### 3.2 字符、原文和出处

- 总预算与偏移单位使用 UTF-16 code units，即 `string.length`；文档明确它不是 token 或可见字数。
- 截取在 `Intl.Segmenter({granularity:'grapheme'})` 的边界上完成，不拆代理对、组合字符或字素簇。
- 用户/助手短文本保留经过现有 sanitize 后的完整文字；新路径不再删除助手 self-talk 前缀，也不调用有效词截断后冒称完整。
- 对现有 skill/宿主噪声折叠保持明确例外：只折叠既有可识别的注入内容，不对普通用户文本做语义概括；折叠与预算省略分别计数。
- 摘录的 total/omitted 指该条经过上述明确清洗后的显示文本；不是 JSONL 文件字节数，也不是 `read` 规范视图的偏移。
- `#N` 沿用会话文件中所有 `type:'message' && message != null` 的全局位置；system 占号但不输出；custom/compaction 不占号。
- 同一 assistant 消息的多个脚本共享 #N；内部关联使用 `toolCallId`，排序位置另用原始块序号，不能串配结果。
- 找不到来源时不生成假 #N；显示“来源编号不可用”，仍受预算限制。

### 3.3 单条阅读提示

新 codemode 简报开头放置一条短说明，内容固定为：

> 以下按历史顺序排列；用户、助手和 intent 是当时的表达，不代表当前状态或执行成功；工具名表示调用或脚本结构；简报采用有效编辑投影，#N 指向已存原始记录，两者文字可能不同；完整字段检索用 scan，长记录用 read。

实现采用以下固定英文文案，并用测试锁定，不随内容语言漂移：

```text
Historical navigation, not current state or proof of success. User/assistant text and intent are past statements; tool names describe calls or script structure. This brief follows effective edits; #N refers to saved originals, which may differ. Use vcc_recall: scan searches saved fields; read pages through long records.
```

新路径不再追加旧的“Do not redo work already completed”尾部说明；旧路径不变。读取旧摘要时剥离已知旧 note 与新 note，不能堆叠。

## 4. S0：基线、测试骨架与逐改动核验

### 工作

1. 记录基线提交、Bun/Pi 版本、现有 typecheck/test 结果及失败原因。
2. 沿现有审计入口增加可注入的生产编译函数和合成窗口构造，不先调整权重。
3. 为下表 H1–H8 逐项补齐 graph 路由、调用双向关系、源码核对、coverage 和近代码 hunk；对全量/否定结论使用 auditor，不以搜索命中数量证明完整。
4. 本计划中的近代码是目标接口，不是已验证补丁；落实逐 hunk 的可行性和可接受风险后再进入对应实施阶段。

| Hunk 组 | 目标 | 当前状态 |
|---|---|---|
| H1 | recall 参数/schema/派发/CLI | 待 S0 逐改动核验 |
| H2 | 完整字段视图、JSONL 游标、scan/read | 待 S0 逐改动核验 |
| H3 | normalize 关联字段、注释解析 | 待 S0 逐改动核验 |
| H4 | 候选构造、角色预算、实际成本渲染 | 待 S0 逐改动核验 |
| H5 | 有效历史投影、尾部排除、跨轮 brief 替换 | 待 S0 逐改动核验 |
| H6 | note 剥离、头部预算、旧路径分流 | 待 S0 逐改动核验 |
| H7 | 生产审计与合成/跨轮/兼容测试 | 待 S0 逐改动核验 |
| H8 | README/CHANGELOG/AGENTS 与版本 | 待行为稳定后核验 |

### 阶段门

现有失败与新失败可区分；S1–S4 的状态矩阵和最小 hunk 可实施；不因基线失败而跳过测试或修改无关实现。下一窗口可以从此阶段直接开始，不需要等待新设计讨论。

## 5. S1：完整已存文本访问

### 5.1 接口决定

保留现有 query/expand/range/touched/drill/recent 的正常行为。新增两个显式动作，不复用默认 mode 的语义：

```ts
type FullReadTarget = { index: number; offset?: number; length?: number };

type AddedRecallParams = {
  scan?: boolean;
  cursor?: string;
  read?: FullReadTarget;
};

type AddedRecallAction =
  | { kind: 'scan'; query: string; cursor?: string }
  | { kind: 'read'; index: number; offset: number; length: number };
```

工具调用示例：

```ts
vcc_recall({ query: '失效条件', scan: true, scope: 'all' });
vcc_recall({ query: '失效条件', scan: true, cursor: '<returned cursor>', scope: 'all' });
vcc_recall({ read: { index: 41, offset: 0, length: 4000 }, scope: 'all' });
```

命令入口同步支持：

```text
/pi-vcc-recall scan:true scope:all 失效条件
/pi-vcc-recall scan:true cursor:<returned-cursor> scope:all 失效条件
/pi-vcc-recall read:41 offset:0 length:4000 scope:all
```

新增标志只识别约定的独立 token。普通查询包含“read”“scan”不改变语义；扫描词中类似旧 drill 的 `#N:path` 也按字面匹配。scan/read 的冲突参数返回明确参数错误，不静默降为普通 query。旧动作之间的原优先级及 Ignored 语义保持不变。

同步修改类型、KNOWN_PARAMS、normalize、set/uses 或等价动作判定、IGNORED_REASON、schema、promptSnippet、工具说明、命令解析及命令提示。无效的新参数不能被 prepareArguments 丢掉后执行另一种动作。

### 5.2 完整字段视图

`recall-full.ts` 提供同一规范视图供 scan 和 read 使用，不借用 `renderMessage(full)`、`condenseCode` 或 capped `extractToolCallArgsText`。

覆盖：用户/助手 text、工具名称与所有深层参数、工具结果 text、bash command/output、已保存的 nested 名称/参数/status/error。递归包括对象、数组、标量，按保存顺序输出字段路径和完整字符串；字段边界有明确分隔，脚本文字不折成单行。

排除：system、thinking、带类型的图片/媒体内容块及其 base64 数据、compaction/custom/branch_summary 条目，以及 recall 自身的参数和工具结果，避免自我回声。这些排除按记录和内容块类型识别，不能因普通参数键名是 thinking、或字符串看似 base64，就猜测删除。扫描定义为该规范文本视图上的字面匹配，不声称 JSONL 字节级搜索或任意语义命中。

对于未保存的 nested arguments，输出已有缺失标记，不补造参数；对原工具输出写入前截断的数据同样不能补回。

### 5.3 scan 的完备性与资源约束

- 字面、不区分大小写，不使用 regex/BM25/相对得分地板，不限制整次扫描只能找到 50 条。
- 默认 scope 仍为 lineage；完整扫描不自动扩大分支，不剔除已保存的当前用户轮。明确显示 scope，需全会话时用 all。旧 query 的零命中回退及当前轮剔除不变。
- 每次最多返回 20 个不同消息命中，片段每条最多 200 单位；scan 输出总计不超过 8000 单位。一个消息多处命中先返回一个导航入口，read 可读全部。
- 扫描以单条记录为处理单位，不构建整会话的无界 BM25 文档数组。每次约 3 秒处理预算为软上限，检查发生在完整记录之间；不宣称可抢占单条巨型 JSON 解析。
- 首次固定当前文件读取上界、全局编号上界、session identity 和分支锚点。返回带版本的 cursor，至少含下一字节边界、下一 #N、固定上界、scope、查询校验信息、分支锚点和累计命中数。
- cursor 不含文件路径授权能力，不加载其中指定的任意文件；始终使用当前 sessionFile。校验整数边界、版本、查询/scope/session 匹配和记录边界；更换会话或切到非原分支后拒绝继续，提示重开扫描。
- 允许同一分支追加 recall 消息：固定上界排除追加内容，继续扫描不能因这些消息增长而永远结束不了。
- `complete` 表示在固定范围内扫描完成；`partial` 必须给下一 cursor，即使本页零命中。不能把超时/未扫描区间叫“没有匹配”。
- 文件缺失、读取错误、损坏记录分别说明；损坏记录不可跳过后仍宣称完全覆盖。输出 skipped/malformed 计数并将覆盖标为不完整。
- 字符匹配跨 JSONL 64KB 读取块仍应成立，因为解析的是完整记录；read/scan 使用同一字段视图，禁止查询命中无法进入 read 的“第二套文字”。

`forEachJsonlLine` 的可选起点/停止扩展必须维持旧调用签名可用；可增加 options 参数和 callback 位置信息，旧 callback 返回 void 的行为不变。不要将全文件 readFileSync 后 split 作为捷径。

### 5.4 read 的完整性

- `index` 为非负整数；`offset` 默认 0；`length` 默认 4000，上限 12000，必须为正整数。
- 读取一条记录的完整规范文本，输出 actualStart、actualEnd、total、remaining 和可复制的下一次 read 调用。
- 起点落在字素内部时回退到该字素起点；终点在 actualStart + length 以内回退到安全边界。若窗口装不下下一个完整字素，返回 length-too-small 和所需最小 length，不返回空页；若单字素超过 12000 硬上限，返回 grapheme-too-large，此病理输入明确不在本版保证可读完的范围内，不修改原记录。
- `offset === total` 返回 EOF；大于 total 返回越界错误；连续页使用返回的 actualEnd，而非自行加请求 length，不得循环返回原头部。
- 已指定编号但在 lineage 外时与现有 expand 一致，可明确标注 off-path 后读取；不伪装成本分支内容。
- read 不自动带出全部配套结果，避免一个请求失控；返回已验证的 toolCallId 配对结果编号供下一次 read，失败匹配不猜邻接编号。
- 现有 expand 继续作为方便预览，但工具说明中删除对 codemode “full untruncated”的承诺，长记录引导 read；默认 query 的匹配上限/参数截断及 scan 替代入口写入工具说明和文档，不修改旧 query 返回文本。

### 阶段门

深层对象、脚本第 2000 字符之后、nested 第 2000 字符之后均能由 scan 命中并由 read 找回；超过 50 条命中可连续枚举；分段读取拼合等于规范视图；不同压缩轮次不改变 #N 或扫描覆盖。

## 6. S2：注释与活动关联

### 6.1 最小数据流

在 tool_call 上保留 `toolCallId`，tool_result 上保留 `toolCallId`、`nestedCalls`、`isError`。原 sourceIndex 用于显示；按原始消息顺序及调用边界配对，不跨后续 assistant 消息串配复用 ID。

候选只需要以下信息，不持久化任务状态：

```ts
type ActivityClass = 'mutation' | 'readonly' | 'unknown';
type ScriptHint = { goal?: string; blocked?: string };
type ActivityEvidence = {
  category: ActivityClass;
  resultIndex?: number;
  observedError: boolean;
  incomplete: boolean;
};
```

具名 write/edit/multiedit/apply_patch 等 nested 调用可判潜在 mutation，不等于成功；全部已知为 read/glob/grep/ls/find 等且 nested 完整时才判 readonly。缺记录、不完整记录、bash-only、未知工具默认 unknown；本版不做复杂 shell 静态副作用判定。存在已观测写调用时，即使记录不完整仍可判潜在 mutation。

错误来自工具 isError 或 nested status/error，不从 goal/blocked/verify 推断。当前文件是否存在、操作成功后的当前状态均不在这个分类中。

### 6.2 注释解析

- 扫描脚本开头最多三行的连续 `//` 注释区；遇首个非空非注释代码行停止。`@options` 仍须保持第一行。
- 固定标记大小写不敏感；goal/blocked 正文各最多 200 UTF-16 单位，超长或空值拒绝并计数。
- 同一种标记重复时只取第一条合规值，不叠加；未知标记忽略，不解析脚本其他位置或工具输出里的注释。
- goal 正文用于 intent 预览；blocked 只用于最近区间内的加分，正文不渲染、不进 Outstanding Context。
- guideline 保持原两条为主：意图而非成功、如何召回；不加“必须写 blocked”，不新增 effects/next。

### 6.3 固定初始评分与测量裁决

以下为便于直接实现的工程初值，**不是已由数据证明的最优参数**：

| 项目 | 初始分值/规则 |
|---|---|
| mutation 基础分 | 30 |
| unknown 基础分 | 14 |
| readonly 基础分 | 6 |
| 最近性 | 全部候选的原始顺序归一到 0–12；重新压缩不刷新旧事件时间 |
| 可观测错误 | +16；不解释为“尚未修复” |
| 合规 goal | +4 |
| 合规 blocked | 仅最后 25% 活动区间内 +2 |
| 注释总加分 | 上限 6 |
| 连续完全重复活动 | 除最近一条外 -12；不可只按工具名＋路径把不同修改合并 |

按 score 从高到低、再按原始顺序从新到旧选择；成本只决定是否装得下，不打八折、不把同一注释重复计分。最后按原始顺序输出。

工具额度先预留 20% 给有可观测错误的活动候选，不足用量返还总工具池；这是一条例外保留通道，不要求所有只读关键性都由算法判断。助手正文和 goal 是发现语义线索的另一渠道，不新增 `critical` 声明。

S5 分别比较 goal 权重 0/4、blocked 权重 0/2；发布选通过场景门且退化更少者，同等时选更简单的 0。不得为达到写/读保留率目标无限加分。

## 7. S3：角色预算与时间线渲染

### 7.1 总预算

新路径仍使用现有 1100/2000 tokens 估计范围和每块 15 的斜率，但将它明确换算为**整个新简报的字符上限**，不是 token 硬保证：

```ts
const budget = Math.round(
  Math.min(2000, Math.max(1100, 15 * historyBlockCount)) * charsPerToken
);
```

`charsPerToken` 复用已限制在 2–6 的校准值，因此总上限有界。historyBlockCount 是有效历史候选构造前的 normalized blocks 数，而非本轮新窗口或上一轮保留数量。

预算分配：

1. 阅读提示与结构分隔先按真实成本扣除。
2. 既有头部区段最多使用剩余预算的 20%；按完整项目边界裁剪，超长单项目用安全截断，并计入省略标记。未使用额度返还正文。
3. 正文剩余分为 user 40%、assistant 30%、tool 30%；这是内部初始参数，不公开配置。
4. 空类别或已完整容纳类别的剩余额度，依次给未完整的 user、assistant、tool。
5. 最终 wrap 后重新计数；如换行/提示使超限，回到分配器减少最后一次增量，不能在输出尾部盲目 slice 掉任意角色。

对于测试注入的极小预算，若连最小阅读提示与一个出处都装不下，返回明确的 budget-too-small 结果，由调用方不生成假空摘要；生产最小预算不应触发这一分支。

### 7.2 用户与助手分配算法

1. 用原始文本和来源构造候选，不先走旧 256/80/120 有效词截断，也不先用 maxBlocks 筛掉它们。
2. 每条最低保留 `min(原文长度, 64)` 个正文单位，头尾各半；角色、#N、标记等另按真实成本计入该角色额度。
3. 若全部最低版本装得下，保留全部；先按“补全文所需增量从小到大”补齐短消息，同成本最近优先。
4. 余量按每轮每条最多增加 64 个正文单位分配，最近到最旧轮转，直到没有空间；最终长条目头尾各半。
5. 若全部最低版本装不下，先把最旧连续消息区间折叠，保留最近可容纳区间的最低摘录；折叠标记包含消息数量与可验证的搜索边界。
6. 极端折叠不是常规路径，不能只为多保留几条工具而主动抹掉用户/助手文字；类别之间只有未用额度可借用，不强抢角色保底。
7. 普通短文本完整时逐字保留清洗后的内容；截断格式固定为头部、`[omitted M of T chars; recall #N]`、尾部，标记计入上限。

折叠同一角色的远端区间时，不能把夹在中间、仍被选中的其他角色内容移位：标记放在首个省略位置，说明是该边界内此角色的省略计数，不称为完全连续的原文集合。

### 7.3 工具活动候选

每条候选提供两种可计量版本：

- 普通版：简短 intent 或代码预览、实际具名调用线索/未知标记、结果错误线索、来源。
- 短版：工具名、最多 80 单位 intent/代码导航、必要错误标记及来源；不以只含编号的条目作为常规保留版本。

score 高的候选先获得短版；余量再升级普通版。超预算先降级，后淘汰；省略组数量和搜索边界受预算约束。候选始终保留原始块顺序；分配完才统一渲染。

观测错误可附 `error observed; result #R`，但不输出“仍未解决”。只读结果正文默认折叠，重要信息通过助手正文、意图、错误与结果编号导航，不把所有 stdout 引入简报。

### 7.4 近代码接口

在 `brief.ts` 建候选，在 `rank.ts` 分配，避免沿用“只返回入选原块”的接口后再次截断：

```ts
type BriefCandidate = {
  key: string;
  order: number;
  role: 'user' | 'assistant' | 'tool';
  sourceIndex?: number;
  sourceText: string;
  score: number;
  evidence?: ActivityEvidence;
};

type BriefSelection = {
  text: string;
  usedChars: number;
  counts: Record<string, number>;
};
```

`key` 用内部 entry ID/块序号或本次输入中稳定的 ordinal，不假设 #N 唯一。`usedChars` 必须等于最终渲染实际长度；审计消费同一 selection，不另算一套近似成本。

### 阶段门

不同角色独立额度成立；超过 16 条用户或 80 块且预算充足时不因条数丢失；短文本、长中文/英文、无标点、组合字符、极端条数、同一消息交错块顺序全部通过；工具多寡不得改变已分配角色保底。

## 8. S4：跨轮历史重建与编译接入

### 8.1 选择的路线

采用**读取既有当前分支原始历史，重新建立 brief 候选**，不把旧 brief 当唯一数据库，也不新增持久化的无限候选缓存。

正常情况下只重建正文；原 header 提取仍使用本轮有效新消息与既有合并规则，之后受 S3 头部额度限制。不要把全历史重新送入“当前 Outstanding Context”提取器，避免把远端旧失败重新描述为当前阻塞。

若存在 context_edit，旧 header 也可能含被省略或替换的内容：本版不尝试从旧字符串中精确删除失效项，而是不继承 previousSummary 的任何 header，从本次有效历史候选重建静态头部，Outstanding Context 仍只取本轮有效新消息。被编辑 checkpoint 的历史下界同时适用于正文和这些头部；不可通过 Files/Goals/Preferences 把受限前缀重新引入。此时 previousSummaryUsed 为 false，头部详情可能比旧稿少，这是明确的保守取舍。

该编辑分支的 Files 也只从有效候选及其有效 nested 记录提取，不复用无法逐项证明来源仍有效的 preparation.fileOps 聚合；否则即使丢弃旧 header，失效路径仍可能从聚合数据重新进入。

### 8.2 来源与切点

- 保留现有 buildOwnCut/resolveSmartKeep/applyTailBudget；它们决定新压缩范围和尾部，S4 不另造切点。
- `branchEntries` 是当前分支路径，包含历史 compaction 节点；全局编号映射仍使用 sessionManager.getEntries 或现有文件回退。
- 无 context_edit 时，遍历当前分支所有原始 message，到本次 firstKeptEntryId 之前；compactAll 则取本次快照末尾之前的全部有效历史。
- 排除 system、非 message 条目、明确跳过的注入类型，以及保留尾部。用于普通 header 的 custom/branch_summary 转换仍留在旧 fresh 管线，不把它们编造为可 recall 的历史消息。
- 工具结果与调用配对不从尾部偷取正文；跨切点只有可证实的已有元数据才能用，不能把未压缩尾部再次渲染。

### 8.3 context_edit：使用宿主投影，但不能直接折叠历史

宿主 `buildSessionProjection` 会先应用最新 compaction，所以直接调用不能得到完整候选；简单删除 compaction 又会断开 parentId 链。

采用只在内存存在的影子路径：保留所有节点 ID、parentId 和顺序，将 compaction 节点替换为不产生上下文的 custom 节点，再交给宿主 projection 处理普通 message 的 omit/replace。不修改原节点、不写回 JSONL、不改 node_modules。转换后的 sourceEntry ID 仍映射原始全局编号。

必须补齐以下规则：

1. 先在原路径确定本次尾部边界，再投影历史；后来的 edit 即使位于尾部，也要影响它明确编辑的旧消息。
2. omit 的旧消息不进入自动简报；replace 使用最新可见替换，但 #N 仍指原始消息。阅读提示说明自动简报采用有效投影，read/scan 则是已存历史证据，不保证文字完全一致。
3. **编辑 compaction 节点的特殊情形**：不能把被用户省略的 checkpoint 背后的所有旧文字重新注入。设保守历史下界为最近一个被编辑 checkpoint 之后，只重建该下界之后的有效历史，加上本轮宿主仍视为有效的 ownCut 消息；此前内容不回填旧 brief，并给一条 `history limited by edited checkpoint; use recall` 提示。
4. 上述受限状态必须进入聚合审计，不能声称“全历史都参与了排序”；显式 recall 仍可访问已存原文，除非宿主本身已不保存。
5. 存在 context_edit 但宿主缺少投影接口时，沿现有 fail-closed 行为报告不能处理，不自行复活原文；不新增对低于支持范围宿主的兜底。
6. Pi 1.0.0 的无编辑历史必须正常走不依赖投影接口的路径；1.4.0 必须测试影子路径与真实宿主投影的普通消息 omit/replace 一致。

这是一条已决定的保守降级，不是待讨论项。若宿主接口核验发现无法保持这些语义，暂停 S4、记录具体反例并修改相应 hunk，不以旧摘要当原始消息绕过发布门。

### 8.4 编译接口与旧数据

```ts
type BriefHistoryInput = {
  messages: Message[];
  sourceIndices: Array<number | undefined>;
  hadCodemodeHistory: boolean;
  hasContextEdits: boolean;
  limitedReason?: 'edited-checkpoint' | 'missing-history';
};

type RankedCompileInputExtension = {
  briefHistory?: BriefHistoryInput;
};
```

- 无 briefHistory：完全保留现有 compileRanked 路径。hook 必须先检查原始分支和失效条件，不能仅因有效 codemode 数为零而省略此输入。
- 有 briefHistory，且有效历史含 codemode 或 hadCodemodeHistory 为 true：S3 生成整个新 brief，不拼接旧 brief、不再经过 120 行 cap；header 依 §8.1 在无编辑时合并、有编辑时从有效来源重建。
- hadCodemodeHistory 来自编辑投影/历史下界之前的原始当前分支记录，不靠扫描旧摘要文字猜测。失效处理先于新旧路径分流，本轮没有 codemode 或全部 codemode 被 omit 时也不能复活旧摘要。
- 旧 0.1.2 摘要不需要反推来源：原始历史仍在时直接重建；原始文件/节点缺失时不给假范围，保留可用 fresh、标明 missing-history，不承诺找回旧摘要已丢的信息。
- `previousSummaryUsed` 继续表示实际是否使用旧 header，有编辑而未继承时为 false；可新增有界统计字段 `briefHistoryMessageCount`/`briefHistoryLimited`，不要改 version=2 所代表的 #N 语义。

### 阶段门

1/3/5 次连续压缩后，旧写入候选仍按原始时间评分，而不是无条件从旧摘要尾部淘汰；相同有效历史、相同预算和尾部边界应产生相同新 brief，插入额外 compaction 记录不能改变选择。

分支重试、compactAll、跨轮首次出现 codemode、codemode 工具关闭、旧摘要无 refs、普通 omit/replace、checkpoint 被编辑、索引缺失均有明确输出；不重复尾部，不回填被删除的投影文字。

## 9. S5：合成场景、审计和参数裁决

### 9.1 硬发布门与状态矩阵

| 编号 | 前态/触发 | 预期结果 |
|---|---|---|
| T01 | 无 codemode，原 query/compile 调用 | 除文档描述外，既有 golden 输出不变。 |
| T02 | 有历史 codemode，本轮纯普通消息 | 仍走新历史简报，不以 active tools 决定。 |
| T03 | 所有 user/assistant 短文本在额度内 | 清洗后全文、顺序和 #N 均保留。 |
| T04 | 长任务书，中段与末尾均有约束 | 头尾与实际省略量正确；中段内容通过 scan/read 找回，不宣称摘录完整。 |
| T05 | 17+ user、81+ blocks，预算足够 | 无固定条数淘汰；最终字符数不超限。 |
| T06 | 最低可读版本也放不下 | 较旧片段按规则折叠，有准确计数与有作用域的边界；无空标记洪泛。 |
| T07 | assistant text/tool_call/text 交错 | 输出顺序与原始块顺序一致。 |
| T08 | 同一消息多个 codemode，共享 #N | toolCallId 配对正确，不共享对方的结果/错误。 |
| T09 | 声明 read-like 意图，实际含 write 或失败 | 不覆盖观测，不输出创建/完成/已解除阻塞。 |
| T10 | 无注释、重复注释、超长、脚本字符串伪标签 | 无惩罚/不累计/拒绝位置不合规；原始文本仍可 read。 |
| T11 | 旧 blocked 经 3 轮压缩 | 不出现在 Outstanding，不刷新最近性，不永续加分。 |
| T12 | 普通旧只读与少量失败只读争夺工具额度 | 普通旧读取优先退让；错误保留通道生效，仍在真实预算内。 |
| T13 | 新 brief 与旧 headers 合并且触发 wrap | note 仅一次，总字符记账涵盖换行、标记和 headers。 |
| T14 | 1/3/5 次压缩，尾部与最终原始历史一致 | 新 brief 选择一致；旧候选没有“越压越新”。 |
| T15 | context_edit omit/replace 普通消息 | 正文及头部均不复活失效原文；原编号稳定；read 显示已存原始证据并说明语义。 |
| T16 | context_edit 指向 compaction | 启用下界和 limited 提示，旧 brief 与 Goals/Files/Preferences 等旧 headers 均不能带回受限内容。 |
| T17 | 全局编号缺失/system/custom/其他分支夹杂 | 无伪索引；system 占号但不输出，范围不是精确成员声明。 |
| T18 | 参数/脚本/nested 深处唯一词 | 默认 query 可近似；scan 必须找到并由 read 展开。 |
| T19 | 60+ 匹配、连续 cursor 扫描 | 没有总 50 条硬损失；可达固定上界，每条消息不重不漏。 |
| T20 | scan 时间片结束、当前页零命中 | partial＋cursor，不返回终局“无匹配”。 |
| T21 | 连续扫描期间会话追加 recall 消息 | 固定上界不增长，自回声不新增匹配。 |
| T22 | 错误 cursor/切分支/损坏 JSONL | 明确拒绝或 incomplete，不声称完整覆盖。 |
| T23 | read 多页/字素边界/EOF/越界 | 普通输入可拼回规范视图，偏移单调；length 不足时报所需值，单字素超过硬上限明确拒绝，无半字符或空页循环。 |
| T24 | 显式 keep:0、无用户锚点、超大尾部 | 保持原切点语义，不假设一定有尾部原文。 |
| T25 | Pi 1.0.0/1.4.0 | 双版本通过；仅宿主不存在的编辑能力测试可按现有方式条件跳过。 |
| T26 | 原始分支含 codemode，但编辑/下界后有效数为零 | 先清除失效旧 brief/header，再生成有效内容；不得借无 codemode 的旧路径重新合并。 |

### 9.2 既有测试入口

优先扩展：`tests/recall-request.test.ts`、`tests/search-entries.test.ts`、`tests/recall-quality.test.ts`、`tests/recall-range.test.ts`、`tests/vcc-recall-command.test.ts`、`tests/codemode-search.test.ts`、`tests/codemode-brief.test.ts`、`tests/brief.test.ts`、`tests/rank.test.ts`、`tests/compile.test.ts`、`tests/context-edits.test.ts`、`tests/summary-global-indices.test.ts`。

允许为新纯模块新增 `tests/recall-full.test.ts` 和 `tests/brief-history.test.ts`；在实施前核对同类测试是否已有更合适归属。现有测试中“第 2000 字符之后默认搜索搜不到”的断言可继续保留，同时新增 scan 能搜到的断言，不能为了让新测试通过把旧默认行为无意改变。

### 9.3 审计指标与停止调参规则

生产和审计共用候选分类、选择、截断与最终渲染函数。至少记录：

- 每会话 user/assistant 的完整率、摘录率、折叠率和实际保留字符比例。
- mutation/readonly/unknown/observed-error 的保留率，及被挤掉的类别。
- goal 正文存续与 goal 存在加分分开统计；blocked 采用量、加分量、拒绝量。
- 实际总字符、提示/出处开销、最长耗时、连续压缩增长、history limited 次数。
- scan 的完成/部分/失败覆盖状态，read 分段完整性；不是只统计第一页命中。
- 配对场景中的召回次数、重读次数与任务结果；真实会话只输出聚合，不输出正文。

先冻结合成场景门，再在调参样本上比较；独立验证集报告每会话差异和退化，不只 pooled 比例。数据不足时给敏感性结果，不编造“统计显著”。

参数裁决限于表中注释权重与既定角色比例的单独对照，不增加新声明补救。若候选未通过硬门，继续修正确性；若只是不显示收益，采用更简单的通过版本，并在发布说明降低效果宣称。不能删掉全文访问或预算硬门来赶版本。

## 10. S6：契约文档、版本与交付

代码行为稳定后才修改：

- `README.md`：简报是历史导航；分角色预算与折叠例外；scan/read 示例；默认 query/expand 的限制；scope、原始记录与投影区别；不保证恢复未保存数据。
- `CHANGELOG.md`：先在 `[Unreleased]` 记录用户可见变更，发布时遵循项目现有格式。
- `AGENTS.md`：历史门控与 active 门控、真实字符预算、注释不认证事实、旧直接工具路径保留、新 codemode 路径替代局部额度、scan/read 与全局 #N 契约、审计不泄漏正文。
- `package.json`：全部门通过后改为 `0.1.3`；核对锁文件是否有根版本元数据，不重新解析或升级依赖。

支持范围保持 `>=1.0.0 <2.0.0`。最低版本验证在独立临时工作副本中完成，避免降级当前工作区依赖：复制必要源码/测试/清单到临时目录并排除 .git、node_modules、research，在该目录执行仓库既定 1.0.0 安装与检查命令；不要把临时会话或依赖差异带回仓库。

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.0.0 @earendil-works/pi-codemode@1.0.0
bun run typecheck
bun test
```

锁定 1.4.0 检查使用当前工作区的 frozen-lockfile 安装；两组结果分别记录。若需要改动已有依赖或安装环境，先确认影响，不静默降级。

交付摘要必须包含：完成阶段、自动验证结果、人工冒烟步骤、已知限制、未执行的真实会话实验。不要把仅通过类型检查说成全部功能验证通过。

## 11. 依赖、执行顺序与工期口径

```text
S0 基线与逐改动核验
 ├─ S1 完整字段访问
 └─ S2 关联与注释 → S3 角色预算
S1 + S3 → S4 跨轮接入 → S5 集成与参数裁决 → S6 文档与版本
```

S1 与 S2 可由两个执行者处理，但 request/run 的共享接口和 types/normalize 的更改分别设负责人，避免并行改同一文件。S3/S4 先顺序实施，不把未验证 hunk 同时铺开。

不沿用第五稿的 4.8 天，也不把前审的 8–12 人日当新范围的承诺。新增完整扫描、分段读取和历史重建是实际功能工作；S0 后按通过的 hunk 数与宿主边界再估算，不因版本号小而跳过闭环。

## 12. 执行状态与阶段交接模板

| 阶段 | 状态 | 本次已完成内容 |
|---|---|---|
| 文档与必要源码核实 | 完成 | 两份新文档；已核实主要入口与已知截断/合并问题。 |
| S0 | 未开始 | 尚未运行基线检查、逐 hunk graph 验证或 DAP。 |
| S1 | 未开始 | 仅接口设计。 |
| S2 | 未开始 | 仅字段、解析与评分初值设计。 |
| S3 | 未开始 | 仅预算和渲染算法设计。 |
| S4 | 未开始 | 仅历史来源、投影和兼容分流设计。 |
| S5 | 未开始 | 仅场景矩阵与指标设计。 |
| S6 | 未开始 | 未修改 README、CHANGELOG、AGENTS 或版本。 |

每个阶段结束更新本节，记录实际修改文件、对应 T 编号、命令与结果、未解决问题；遵守技能要求的状态转换测试和改后重新建索。不能仅写“完成”而不附证据。

## 13. 附录：下一窗口可直接使用的任务说明

> 请执行 `docs/plans/CODEMODE_0.1.3_EXECUTION_PLAN.md`，先读配套 FINAL_REVIEW 和 AGENTS，保护当前未提交文档，从 S0 开始。产品取舍已确定，不重开注释可信性等方向讨论；先确认既有文件的备份许可，再完成逐改动静态核验与状态矩阵，逐阶段实施和测试。不得跳过 scan/read、跨轮候选来源、极端预算降级与非 codemode 兼容门；不改 CI，不提交、推送或发布。某项源码前提不成立时记录具体证据并重新核验相应 hunk，不臆造兼容行为。
