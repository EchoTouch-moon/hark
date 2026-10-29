# R2 产品质量整改 · 2026-10-29

状态：工程实现及本地验证通过；远端CI已通过（源码提交00121a2，Run40836527163）；建议价值门禁仍未通过。不得进入P2-B/C/P3。

## 实现与本地验证

- H08：任何非Mock分析先在本地组装preview，展示接收模型、项目metadata/事件/洞察/文档摘录，用户确认时带内容指纹；服务重组并匹配，不一致拒绝。发送确认在analysis schema v4按Run/指纹/接收方落盘并执行前回读。项目排除路径在schema v3持久化，采集前排除。通用敏感赋值/高熵启发式补充脱敏；不承诺任意源码安全，保密项目应取消。
- H11：assembledAt不进入内容指纹；规则集版本、文档捕获前缀、目标Insight理由和引用进入稳定内容。读取Run时比较输入，区分head/context/unavailable过期。大文档前缀外修改不在捕获内容的hash中。
- H12：仍只收集有限文档，不读取src；README和预览明确非代码审计，定向代码上下文保留到P2-B。
- H13：UI使用“来源引用已匹配，结论仍需判断”，不把身份白名单匹配称为语义核实。
- H14：默认HEARTH_DEMO=0，不自动seed；显式HEARTH_DEMO=1启用独立Demo。导航Demo Home、Chat Mock明确标识，顶栏从health读取实际模式；模式切换要求重启，settings不能伪造运行模式。
- H16/17/18：README真实现状与原规划归档；health单独暴露chatProvider/analysisProvider及确定性协调器状态；反馈等待持久化回读，成功/失败可见，刷新恢复。
- 提示改为中文，并要求按证据检查项目目标/阶段/演进/优先级，必要时保留工程健康建议，不凑维度配额、不虚构路线图。该提示调整尚无新的真实模型/人评验证，不将其当作质量已提高的证据。

本地：42文件343测试、全仓typecheck、lint零错误（6个既有warning）、web+server build通过；浏览器16/16通过。r2-browser.txt单项验证Pi预览身份拦截+实际Mock后端，取消/ESC零Run、保存排除、最新指纹确认、反馈刷新恢复与失败。新隐私截图r2-privacy.png，不是真实Pi调用截图。

r2-tests-initial-failure.txt保留首次子进程PID退出断言失败。排查发现marker文件创建与内容可见之间存在读取空字符串→PID0的潜在竞态；已要求正整数PID。首次失败未捕获实际PID，因此不将这一推断写成已证实根因；补强后局部和全量通过。r2-tests-initial-coordinator-failure.txt保留tick累计计数测试提前返回，改为相对tick目标后验证静默零写入。未掩盖失败或用重跑替代定位。

## 价值门禁

已有1个真实项目/6条历史真实建议、0条逐项二元人评；用户已给出真实定性评价：建议过于集中本地构建/检查，希望核对项目发展与演进、内容更多元。已在docs/evaluation/recommendation-ratings.json原样保存，未擅自转换成每项分数。

`pnpm exec tsx scripts/score-recommendations.ts` 当前返回NOT_MEASURED/exit2，有用精确度/噪声率为null。目标仍是至少两个真实项目、30条人工标注；当前不足24条样本、30条逐项标签。需由用户在新预览界面触发后续真实调用并评价，不由后台批量生成/花费。不能只以通信成功或工程检查建议可执行宣告R2通过。

远端CI结果在remediation-r2-ci.md追加实际Run链接/提交号/结论。此次GitHub提交与CI属于此前代码同步授权及本轮远端门禁范围，不启用任何模型凭证，不执行真实项目操作。
