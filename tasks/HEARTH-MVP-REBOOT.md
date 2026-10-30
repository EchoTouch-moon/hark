# HEARTH-MVP-REBOOT · 给编码 Agent 的执行任务书

> 2026-10-30 · **任务类型：重新规划并实现一个可验收的 Hearth MVP，不是把 PR #5 换肤后宣称完成。**

## 0. 开发前务必阅读

按顺序读取：
1. `docs/mvp/00-START-HERE.md`
2. `docs/mvp/01-PRODUCT-CONTRACT.md`
3. `docs/mvp/02-MIND-LIFE-ARCHITECTURE.md`
4. `docs/mvp/03-ACCEPTANCE-SCENARIOS.md`
5. `NARRATIVE.md`、`docs/EMBER-STORY-SYSTEM.md`（注意：旧叙事存在矛盾，新合同对新产品意图优先）
6. `README.md`、`docs/05-SECURITY.md`、`docs/14-PROJECT-OBSERVER.md`、`handoff/STATUS.md`、现有 Observer/Insight/Analysis 测试、PR #5 UI 素材。

不得假定本仓库已有真实主动研究、观点生命周期、主动通知或自动规划能力；先证明再复用。即使 UI 故事富有情绪，也不得声称已经有模型意识或一直在后台工作。

## 1. 分支及工作范围

- 本任务文档基于 PR #5 的 `fe5464e` 起草；PR #5 仍待用户单独合并决定。
- 从当前文档分支另建 `feat/hearth-mvp-mind-loop`（开始前复核最新 Git HEAD）；不要直接写 `master`、不覆盖 PR #5、不强推。
- 先只交付需求评审/ADR/schema/traceability，随后分阶段改代码；每阶段 PR 或分离提交可独立审查。
- 本轮不是要求无约束连续跑多个付费模型；没有必要授权与密钥则报告 BLOCKED，并继续完成离线可验部分。
- 优先原生 TypeScript、Node >=22.13、React、SQLite；无需 Docker，不重构无关包。
- 不修改用户其他仓库、不删除本地 DB、凭证、历史证据、已跟踪设计素材。

## 2. 必须先产出的设计交付

- **Architecture Gap Audit**：把实际现存功能分类为 DONE / PARTIAL / MOCK / MISSING / BLOCKED，指向源码、测试及 CI 证据；
- **Migration/Reuse Matrix**：现有 Observer、Insight、Pi Analysis、chat、projectEmber、EmberAtmosphere、GSAP 如何复用/隔离/迁移；
- **PRD + Sequence Diagrams**：真实观察、受限自动研究、意见生成、通知筛选、用户反馈、观点修订、失败恢复、显式执行闸门；
- **ADR**：项目身份 vs 线程身份、Opinion 版本、Evidence/Source Ledger、研究许可/预算/敏感信息保护、后台调度与恢复、Flame/Story 的统一投影；
- **API / DB Contract**：Zod schema、存储迁移、删除及重置级联、幂等/来源引用、新鲜度、上下文隔离；
- **Threat Model**：模型幻觉、prompt injection（网页/README 都是非可信输入）、隐私外发、模型费用、无限循环、过时证据和权限扩大；
- **Acceptance Traceability**：`03-ACCEPTANCE-SCENARIOS.md` 每条对应测试/截图/状态。

这些资料不只是“附录”：实现必须对应其合同。旧安全合同不可因本 MVP 改弱。

## 3. 实施 Gate（先纵切，再精修）

### G0 · 基线审计与合同冻结

输出现状审计、接口图、失败风险、复用策略、精简数据 schema、反例测试设计。至少审查 PR #5 的 `deriveProjectFlame`：不能以 3 条消息推断推进，也不能由全部卡片完成推断项目完成。此阶段不得改动业务能力和 UI 主流程。

**Exit**：每项 MVP Must 有源码目标、验证方式、兼容/迁移方案；尚存阻碍明确 BLOCKED。

### G1 · Project Chronicle & Opinion Memory

新增最小项目目标/决定与证据引用端口，Opinion + Revision + Feedback 存储、来源跨项目隔离，删除/重置策略，幂等和重启恢复。保持 Observer/Insight 原有门禁。

**Exit**：可信/不可信来源、并发/重复、重启和多项目负例全通过；同一观点可版本修订而不覆盖历史。

### G2 · Bounded Research

实现显式开启的 `ResearchPolicy`：公开数据源允许列表、查询脱敏、请求预算/频率、取消、错误、可审计摘要。检索 GitHub、论文或文档可选择一个真实可靠的数据入口先接通；接口要可替换。禁止执行 GitHub 写操作。

**Exit**：能完成一次真实公开资料检索并保留 URL/访问时间；未启用、私有路径、额度耗尽、网络故障均不外发/不伪造成功。

### G3 · Opinion Engine + Proactive Policy

对一个真实的项目事实产生相关研究候选；生成一个包含事实、推断、反例/局限、来源、自己判断、修改观点条件、计划草案的 OpinionRevision。可用现有显式 Provider 做人工触发测试；后台自主运行需要用户对这一 Provider 与预算的单独预授权。实现去重、搁置、非打扰显示、用户反馈、再审查与版本链。

**Exit**：真实项目与真实检索下产生一份有引用且经过安全/Schema 校验的观点；人工质量验收不可用时标 NOT_MEASURED，不假装通过。

### G4 · Project Life & UI Integration

让同一份 NarrativeState 驱动 StoryProjection 与 FlameProjection。保留 PR #5 的对话空间、欢迎、昼夜、WebGL/GSAP 资产。删除添柴/百分比；独立表达当前项目、来源新鲜度、建议/决定与真实进度。项目管理真实扫描重命名「立即检查」。

**Exit**：一段用户可理解的故事，项目切换不串线，无虚假进度；桌面截图/录屏、reduced-motion、无 WebGL、错误状态及键盘回归通过。

### G5 · 完整纵切、回归与交接

真实项目 → 真实观察 → 有限联网研究 → 有来源的可修正观点 → 主动呈现 → 人工反馈 → 重新打开恢复；提供至少一条新证据触发观点修订的验证。自动执行工作必须保持禁止，直到独立的方案版本审阅及单次用户主动发起接口获另行产品批准。

**Exit**：单元/集成/E2E、安全反例、手动价值评审、CI、日志、截图和代码指纹可交叉验证；未能实现部分一律标记 BLOCKED/NOT_MEASURED。

## 4. 运行与演示要求

- 不混用真实 DB 和 Demo，真实 Provider 失败不得悄悄转 Mock。
- 需要外部权限、API Key、付费模型时先给出清晰的预览与预算说明；无权限继续离线合同测试，不私自注册/配置服务。
- 优先演示一个具体、非平庸的产品意见，而非几十个无意义通知。
- 没有相应真实证据，不显示“刚观察”“已分析”“已经完成”“项目健康”等。
- 用户可以随时查看/停止研究，关闭建议，不影响已确认的观察事实。

## 5. 编码 Agent 可直接使用的启动指令

> 你现在接手 `EchoTouch-moon/hark` 的 Hearth MVP 重定向。先读 `docs/mvp/00-START-HERE.md` 及其全部链接文件和 `tasks/HEARTH-MVP-REBOOT.md`。复核仓库最新状态，确认 PR #5 与 master 的差异。新产品的目标是：在用户授权范围内持续观察本地项目、自主检索公开研究资料、形成有证据且可反驳可修正的观点，并主动提出可审阅计划；**未经用户看过具体计划并明确发起，绝不能执行任何项目开发、命令、PR、外部写操作**。项目生命驱动火焰，取消添柴/活力百分比，不造成功/健康分。请从 G0 现状审计开始，产出 gap/migration/ADR/schema/威胁模型与每条验收映射，再推进分阶段编码，保留真实来源、安全与独立验证。未经明示授权，不要合并 master、不要真实付费模型外发、不要更改其他用户项目。每阶段报告 PASS/FAIL/BLOCKED/NOT_MEASURED、相关 commit 和证据。

## 6. 完成的定义

“代码能启动”“有漂亮火焰”“模型生成了一份报告”都不足以宣称 MVP 已完成。

只有**一项真实、有价值且有来源的项目研究观点，在没有用户主动提问该问题的前提下形成，并在用户可控交互中展示、被反馈、随后可用新证据修订；期间无未授权执行或外发**，才算核心 MVP 闭环完成。用户是否认同其价值必须由用户实际评审。
