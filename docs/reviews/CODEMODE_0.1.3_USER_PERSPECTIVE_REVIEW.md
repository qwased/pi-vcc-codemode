# pi-vcc-codemode 0.1.3 真实使用视角记录

- 日期：2026-10-28
- 对象：本机实际加载的扩展 `dist/pi-vcc-codemode-0.1.3`（`pi list` 里同时存在两条 pi-vcc 条目，生效的是这份本地 dist），以及仓库 HEAD `6a5c8df` 的实现（仅在 A/B 对照中用 `-e` 单独加载）
- 状态：实测记录。未修改 `src/`、`tests/`、`package.json`
- 性质：n=1（本会话自身，264 条消息、约 1.7 MB）。数字用于说明机制与等价性，不作统计结论
- 引用约定：遵循 `AGENTS.md`，不引用会话正文、路径或文件名；只用聚合数字、条目编号区间、`路径:行号` 和 sha256。本机绝对路径一律写作 `<repo>` / `<launcher>` / `<session>`

## 0. 摘要

本机实际运行的 0.1.3 与仓库 HEAD 不是同一份代码：dist 里没有 `CostMeter`，还带着 `src/core/report.ts`。在同一份真实会话上交替对照，两者输出逐字相同（6 次 sha256 一致），HEAD 端到端快 7–15%，说明性能修复在真实数据上安全；但这个规模（264 条消息）用户基本感觉不到收益。使用中确认 5 个用户可见问题，其中两件值得在 0.1.4 处理：压缩元数据 `details.sections` 被摘要正文污染，以及“本地 dist 与发布包同版本号却不同实现”的身份混乱。

## 1. 方法

走真实用户路径，不用单测替身：

- 扩展发现：`pi list` 同时列出 `npm:pi-vcc-codemode (filtered)` 与 `<repo>/dist/pi-vcc-codemode-0.1.3`，后者才是生效实现。
- 命令：`<launcher> -p --fork <session> '/pi-vcc'` 与 `... '/pi-vcc-recall CostMeter'`。`-p` 下斜杠命令会真正执行，证据是会话文件里新增了 `type:"compaction"`（`details.compactor = "pi-vcc"`）和 `type:"custom_message"` / `customType:"vcc-recall"` 条目。
- 会话取本会话 1.7 MB 的副本 fork，三次交替 A/B：A 用已安装 dist，B 用 `-ne -e <repo>/index.ts` 只加载仓库版本，避免两条注册互相干扰。
- 计时：整进程墙钟（含 Node 启动），基线 `<launcher> --version` = 307 ms。
- 陷阱：Git Bash 会把 `/pi-vcc` 改写成 `C:/Program Files/Git/pi-vcc`，测量时必须 `MSYS2_ARG_CONV_EXCL='*'`；这是 shell 问题，不是插件问题。

## 2. 数据：性能与等价性

| 指标 | 值 | 来源 |
|---|---|---|
| 启动基线 | 307 ms | `<launcher> --version` ×1 |
| A：dist 0.1.3（修复前） | 1219 / 1317 / 1157 ms | 3 次交替 |
| B：HEAD 6a5c8df（修复后） | 1129 / 1095 / 1064 ms | 3 次交替 |
| 压缩条目 | 源会话 2 条 → fork 3 条 | 每次 `/pi-vcc` 恰好 +1，`reason:"manual"`，`willRetry:false` |
| 新摘要长度 | 5570 字符 | `type:"compaction"` 的 `summary` |
| 新摘要 sha256（前 12 位） | `383f39c90e2c`，6 次运行全同 | A×3 与 B×3 |
| `tokensBefore` | 68955 | 新压缩条目 |
| 测试 | 867 pass / 49 文件 / 2983 expect | `bun test`，8.9 s |
| 类型 | 通过 | `bun run typecheck` |

结论：真实会话上新旧实现**逐字等价**，与 242 例 golden 夹具的结论一致；修复的收益随历史长度增长，264 条消息时只有个位数百分比，不应作为用户可感的卖点。

## 3. 数据：召回

工具路径（`vcc_recall`，由当前进程直接提供）：

| 调用 | 结果 |
|---|---|
| `query:"分配器 140ms"` | Page 1/5，24 total matches（中文分词可用） |
| `query:"Cost?Meter"` | Page 1/3，14 total matches（正则可用） |
| `read:{index:999999}` | `Entry #999999 not found in session history (last entry is #241).` |
| `mode:"touched"` | 6 页 26 个文件；并声明 14 个 nested write 的参数被 Pi 丢弃、给出可用 `expand` 的脚本条目编号 |

命令路径（`/pi-vcc-recall CostMeter`，在压缩后的 fork 上）：墙钟 2.31 s，首屏 2643 字符，`Page 1/4 (17 total matches)`，可继续 `page:2`。

评价：边界情况给的是可执行的下一步，而不是“没找到”；`touched` 主动披露盲区（Pi 丢弃的 nested 参数、`apply_patch` / bash 重定向不可见），这部分诚实度高于同类工具。

## 4. 数据：摘要产物

新摘要共 185 行，其中：

- 行首方括号（`/^\[[^\]]+\]$/`）25 处，真正的章节名只有 `[Session Goal]`、`[Files And Changes]` 等 4 处；
- 形如 ` (#N)` 的“只有引用、没有正文”的行 8 条（`#22`、`#56`、`#78`、`#80` 等）；
- `#N` 在 3 次压缩之间保持稳定，压缩后的摘要仍能指向原条目。

## 5. 缺陷

### D1（建议 0.1.4 修）`details.sections` 被正文污染

- 机制：`src/hooks/before-compact.ts:862` 与 `:870` 用 `/^\[(.+?)\]/gm` 对**整篇**摘要取章节名。
- 实测：真实压缩条目的 `details.sections` 里 25 项中 21 项来自正文（`[user]`、`[assistant]`、`[omitted …]` 这类行首方括号），不是章节。
- 覆盖面：`grep -rn '\.details' src` 只有一处判断 `compactor`，该字段无消费者；`tests` 也没有对它断言，所以一直没有暴露。
- 影响：持久化到会话文件的元数据错误且随正文长度膨胀；任何统计、UI 或未来版本读它都会得到假章节。

### D2（发布运营）本地 dist 与待发布包同版本号、不同实现

- dist：51 个文件、0 个 `*.bak`、包内仍有 `src/core/report.ts`、`grep -c CostMeter` = 0、mtime 2026-10-28 04:30。
- npm：`latest = 0.1.2`，`0.1.3` 尚未发布；仓库 `version` 已是 0.1.3 且包含修复。
- 结论：用户跑的是修复前代码，而版本号与即将发布的 0.1.3 相同；`pi list` 还并列一条 `(filtered)` 的 npm 注册，无法从版本判断实现。

### D3（观感）只有引用的空行

- 实测：185 行摘要里 8 条形如 ` (#N)`。
- 根因位置：`src/core/brief.ts:749-752`（`attachRef` 对空文本仍追加 ` (#N)`）；`normalize` 保留空的 assistant text 块，越界裁剪到 0 字符时正文为空。

### D4（排序质量）召回重复与代码块压过讨论

- 同一段脚本改写前后的两个条目（`#148` / `#150`）同时进入首屏；
- 搜 `CostMeter` 时首屏第一条是整屏命令（`#243`），设计讨论（`#112`）排在后面。
- 不是错误结果，但对“找回决策理由”的用途不够好。

### D5（脚本化）`-p` 模式无任何 stdout

- `/pi-vcc` 与 `/pi-vcc-recall` 均 exit 0、stdout 0 字节。
- 成功证据只在会话条目里（compaction 条目；`custom_message` 2643 字符）。TUI 有 toast，CI/脚本化场景没有回执。

## 6. 评价（判断，非测量）

1. **“确定性压缩 + 可回溯”是这个插件真正的价值。** 它把“摘要一定丢东西”变成可对账的事实：`#N` 跨压缩稳定，压缩三次后仍能取回原条目。相比让模型写摘要，这条路便宜、可复现、可验证。
2. **格式语法过载。** `[Section]`、`[user]`/`[assistant]`、`[omitted …; recall #N]`、`(#N)` 四种方括号加一种井号共处一个纯文本块。D1 不是笔误，而是“同一行 `[` 既是结构又是内容”的必然结果；D3 同理。结构化的 section/ref/omission 不应靠正则猜。
3. **发布工程落后于代码质量。** 867 个测试、50 个文件的干净包、真实会话等价性都已具备，但装在机器上的还是旧 dist、同版本号、重复注册。D2 是这个落差的直接后果。
4. **本次性能修复不该被当成用户体验卖点。** 264 条消息只快 7–15%；它的意义是长历史（上千条、上千候选）不退化。把它写进 CHANGELOG 的“Changed”是对的，写进宣传语是错的。

## 7. 复现步骤

占位符：`<repo>` 仓库根、`<launcher>` Pi 启动器、`<session>` 一份真实长会话（≥200 条消息，含 codemode 记录）。以下均在本机 Windows 11 / Git Bash / Node 24 / Pi 1.4.0 环境。

1. **确认实际加载的实现**
   ```sh
   pi list | grep -A1 pi-vcc
   ls <repo>/dist/pi-vcc-codemode-0.1.3/src/core/report.ts   # 存在 = 早于 F2.b
   grep -c CostMeter <repo>/dist/pi-vcc-codemode-0.1.3/src/core/rank.ts   # 0 = 修复前
   ```
   期望：两份注册并列；`report.ts` 存在；`CostMeter` 计数为 0。

2. **A/B 端到端与等价性**
   ```sh
   for i in 1 2 3; do
     for v in A B; do
       if [ "$v" = A ]; then EXT=""; else EXT="-ne -e <repo>/index.ts"; fi
       time MSYS2_ARG_CONV_EXCL='*' <launcher> -p $EXT --session-dir /tmp/t$v$i --fork <session> '/pi-vcc'
     done
   done
   ```
   期望：A 约 1.1–1.3 s，B 约 1.0–1.1 s；6 份新压缩条目的 `summary` sha256 相同、`tokensBefore` 相同、章节数相同。

3. **召回**
   ```sh
   MSYS2_ARG_CONV_EXCL='*' <launcher> -p --session <fork> '/pi-vcc-recall CostMeter'
   ```
   期望：`Page 1/N (M total matches)`、带 `#N`、末行为可复制的下一页提示。

4. **元数据污染**
   ```sh
   node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);const s=l.filter(e=>e.type==="compaction").at(-1).details.sections;console.log(s.length, s.filter(x=>/omitted|^user$|^assistant$/.test(x)).length)' <fork>
   ```
   期望：非章节项 > 0（本次为 21/25）。

## 8. 未验证

- TUI 下的 toast、颜色和分页提示未验证；本次只走 `-p` 文本模式。
- 只在 Pi 1.4.0 / Windows 11 / Bun 1.4.4（测试）/ Node 24（运行）上测过；Linux、macOS、Pi 1.0.0 未实测。
- 未做 >1000 条消息的端到端压力测试；性能数字来自 264 条消息与本仓库的合成基准。
- 未验证 `npm` 安装后的包行为；本次对象是本地 `dist/` 副本与仓库源码。
- `D1`、`D3` 的修复未实现，也未加回归测试；本文只记录现状。
