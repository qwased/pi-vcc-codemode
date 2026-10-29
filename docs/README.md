# 工作文档归档

本目录保存开发计划、外部复核、评估报告和补丁记录。这些是历史工作笔记，不是安装或使用文档；当前行为以仓库根目录的 `README.md` 和 `CHANGELOG.md` 为准。

- [plans/CODEMODE_LONG_HORIZON_PLAN.md](plans/CODEMODE_LONG_HORIZON_PLAN.md) — codemode 长程任务改进计划、阶段门与实施状态。
- [plans/CODEMODE_0.1.3_PLAN.md](plans/CODEMODE_0.1.3_PLAN.md) — 0.1.3 工作计划第五稿：版本定位、候选机制与工期，实施顺序已被执行计划取代。
- [plans/CODEMODE_0.1.3_PLAN_REVIEW.md](plans/CODEMODE_0.1.3_PLAN_REVIEW.md) — 第五稿可行性审阅：数据管道、兼容契约、验收口径与工期，结论为需较大修订。
- [plans/CODEMODE_0.1.3_FIRST_PRINCIPLES_REVIEW.md](plans/CODEMODE_0.1.3_FIRST_PRINCIPLES_REVIEW.md) — 第一性原理评估与重建建议：收缩 0.1.3 范围，暂不重写整个压缩系统。
- [plans/CODEMODE_0.1.3_FINAL_REVIEW.md](plans/CODEMODE_0.1.3_FINAL_REVIEW.md) — 最终审阅与决策记录：逐条裁定前序评审并定下实施基线。
- [plans/CODEMODE_0.1.3_EXECUTION_PLAN.md](plans/CODEMODE_0.1.3_EXECUTION_PLAN.md) — 0.1.3 执行计划：可交接的实施项、验收方式、预算与源码基线，当前实施依据。
- [plans/暂时不做，仅留档.md](plans/暂时不做，仅留档.md) — 早期 Current Task 连续性方案草稿，本版不实施，仅留档。
- [plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES.md](plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES.md) — 0.1.3 分配器性能修复与测试探针清理计划（外部复核后的 v2）。
- [plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES_REVIEW.md](plans/PERF_FIX_ALLOCATOR_AND_TEST_PROBES_REVIEW.md) — 对该计划的外部复核：属实项、判断修正与被漏掉的展开点。
- [plans/CODEMODE_0.1.4_PLAN.md](plans/CODEMODE_0.1.4_PLAN.md) — 0.1.4 原计划：修复清单、T01–T23 验收矩阵与实施顺序（被审阅基线）。
- [plans/CODEMODE_0.1.4_REVIEWED_PLAN.md](plans/CODEMODE_0.1.4_REVIEWED_PLAN.md) — 0.1.4 审阅与修订计划（实施依据）：放弃无标签目标行、保留 note 文本、修正数据回流与验收口径。
- [plans/CODEMODE_0.1.5_UPGRADE_PLAN.md](plans/CODEMODE_0.1.5_UPGRADE_PLAN.md) — 0.1.5 升级计划（唯一范围定义）：围栏配平、结果导航、直接工具通道、最近长文本深度、历史来源与预算落库。
- [reviews/CODEMODE_REVIEW_AND_FIX_PLAN.md](reviews/CODEMODE_REVIEW_AND_FIX_PLAN.md) — 2026-10-26 外部复核、结论核实与修正计划。
- [reviews/PI-VCC-CODEMODE-EVALUATION-REPORT.md](reviews/PI-VCC-CODEMODE-EVALUATION-REPORT.md) — 0.1.1 真实工作测试与行为核对报告。
- [reviews/pi-vcc-codemode-long-horizon-review.md](reviews/pi-vcc-codemode-long-horizon-review.md) — 长程任务可寻回性、工作记录与目标保持审阅。
- [reviews/CODEMODE_0.1.2_DISCUSSION_RECORD.md](reviews/CODEMODE_0.1.2_DISCUSSION_RECORD.md) — 0.1.2 讨论记录：预算上限、第 N 次压缩可见性缺口、中文提取与截断边界。
- [reviews/CODEMODE_0.1.2_FIELD_NOTES.md](reviews/CODEMODE_0.1.2_FIELD_NOTES.md) — 0.1.2 现场札记：一次真实压缩的汇总数字、A/C/D/E/F 的验证结果与缺口建议。
- [reviews/CODEMODE_0.1.3_USER_PERSPECTIVE_REVIEW.md](reviews/CODEMODE_0.1.3_USER_PERSPECTIVE_REVIEW.md) — 0.1.3 真实使用视角：A/B 等价性、召回体验与 6 个用户可见缺陷。
- [reviews/CODEMODE_0.1.4_FIELD_REVIEW.md](reviews/CODEMODE_0.1.4_FIELD_REVIEW.md) — 0.1.4 现场复核：一次 40 万 token 压缩保留了什么、丢了什么，机制判断与同预算建议（仅聚合数）。
- [reviews/CODEMODE_BRIEF_FENCE_TRUNCATION_BUG.md](reviews/CODEMODE_BRIEF_FENCE_TRUNCATION_BUG.md) — 摘要代码围栏被头/尾摘录切断：现象、复现、根因与修复方向（未实施，仅聚合数与合成样例；含上游 v0.11.1 核对）。
- [patches/pi-vcc-codemode-patch.md](patches/pi-vcc-codemode-patch.md) — 上游 0.10.2 本地保真度补丁记录（已并入本 fork）。
- [patches/0.1.4-brief-and-metadata.md](patches/0.1.4-brief-and-metadata.md) — 0.1.4 实施记录：引用位置、章节元数据、limited note、动作标签与真实会话验证（仅聚合数）。
- [patches/0.1.5-brief-navigation.md](patches/0.1.5-brief-navigation.md) — 0.1.5 实施记录：P0 围栏、中性结果导航、直接工具通道、最近长文本深度、历史来源提示、预算落库与 87 条 golden 差异清单（仅聚合数）。

归档时已删除本机绝对路径和会话文件名；这里不包含会话正文。
