# G0 · 现状、差距与复用审查

> 审查基线：PR #6 `4d08d465239f4157bf920eb82903bc2a7726d553`，其父基线 PR #5 `fe5464e4e2cb4cfb0b6cb8dffbc4db16bf664b23`。本文件是 G0 的工程方案，未实现项不是现有能力；合同尚待用户审阅。

## 一、结论与优先级

产品闭环 **NOT IMPLEMENTED**：现有仓库有真实只读观察、确定性 Insight、人工发起的受控分析，以及对话和火影视觉资产；没有已验证的自动公开研究、可追溯 OpinionRevision、基于价值的主动呈现和真实端到端闭环。单元测试或历史真实 Pi 请求不能证明新 MVP。

先处理以下阻断，再接入任何自动研究或真实观点：

1. **跨项目候选暴露风险**：`apps/server/src/http/routes/threads.ts` 的 `GET /api/v1/threads/:id/proactive` 调用 `listCards({ status: 'proposed', limit: 3 })`，未传项目过滤；随后将卡标题及 `whyNow` 写入线程。该路径由 `apps/server/src/http/app.ts` 注册。代码审查足以确认无项目过滤，但跨项目实际利用及影响范围尚未动态验证；新真实模式必须 fail closed，并覆盖直接 API 和线程重放。
2. **演示结果误认真实完成**：同一文件的 action execute 采用请求体 `action.demo` 决定文案；`demo: false` 分支仍是本地 Mock，却返回“已完成”和 `ok: true`，并非独立执行回执。真实模式需禁用/隔离该路径，保留清晰 Demo 标识；不得将伪完成迁入新观点流。
3. **项目生命语义错误**：`apps/web/src/features/projectEmber.ts` 将 3 条消息视为繁盛、所有卡完成视为金火、观察关闭/陈旧视为休眠；`AppShell.tsx` 等仍呈现活力百分比与添柴。这违反新合同，需先写 N17–N19 负例再替换。项目缺失、未观察、停用、数据间隙不能推导休眠。
4. **真实验收阻断**：PR #5 和 PR #6 的 GitHub Actions 均失败。PR #6 运行 [40998662240](https://github.com/EchoTouch-moon/hark/actions/runs/40998662240) 中单元/集成 438 项通过，但浏览器 E2E 为 11 通过、11 失败、3 未运行；例子包括旧首页标题、主导航、模式错误和主题控件未找到。部分可能是旧 UI 测试与新界面不匹配，但不能据此推定所有失败都是过时测试，必须逐项分类并保留安全断言。PR #5 的 [40994397259](https://github.com/EchoTouch-moon/hark/actions/runs/40994397259) 同样为 11/11/3。两次分别测试 GitHub 的合并结果，不能等同于本地当前 HEAD 的新一轮验证。

旧 `docs/01-PRD.md` 的 Dashboard 信息架构与 MVP 对话优先冲突；按本次用户明确要求，新 MVP 产品行为采用 `docs/mvp/`，但不降低 `AGENTS.md`、`docs/05-SECURITY.md` 与 `docs/04-CONTRACTS.md` 的安全/证据约束。旧合同中可执行 L0/L1 不构成新 MVP 自动行动许可：真实模式需额外收紧到计划审阅及用户明确发起，MVP 执行仍禁用。

## 二、复用/迁移矩阵

状态定义：DONE＝已有局部能力和可核实证据，不代表新 MVP 端到端；PARTIAL＝部分满足；MOCK＝合成演示；MISSING＝未发现实现；BLOCKED＝缺授权/外部条件/红灯。审查范围为以上 SHA，未作全面安全认证。

| 资产 | 状态 | 源码与证据 | 新 MVP 决策 |
|---|---|---|---|
| Observer | PARTIAL | `packages/project-observer/src/{observer.ts,scanner.ts,contracts.ts,state/schema.ts}`；`docs/14-PROJECT-OBSERVER.md`；本次 `handoff/EVIDENCE/mvp-g0/baseline-tests.txt` | 复用授权登记、只读 Git/JUnit、快照、epoch/事件；项目目标、真实许可及完整覆盖度另建合同。不得运行用户仓库测试；真实仓库复验尚未做。 |
| Insight | PARTIAL | `packages/project-insight/src/{observer-read-port.ts,coordinator.ts,insights/processor.ts,store/schema.ts}`；同上日志 | 复用只读端口、checkpoint、断流冻结与规则；确定性信号不自动等于有价值研究问题或观点。 |
| Pi Analysis | PARTIAL | `packages/project-analysis/src/engine/service.ts`、`context/assemble.ts`、`providers/pi.ts`；`docs/verification/hearth-p2a-live-verification.md` 是历史环境证据 | 复用受控子进程、上下文预览/指纹、取消、输出校验、禁止工具和无隐式 Mock 回退；现有非 Mock 每次确认的合同不能直接用作后台长期授权。自动调用需另设计更窄的独立策略、recipient、范围和预算，保持现有一次性分析不降级。 |
| 对话/线程 | MOCK / PARTIAL | `apps/server/src/http/routes/{chat,threads}.ts`、`packages/storage/src/{migrations,storage}.ts`、`apps/web/src/pages/ChatPage.tsx` | 复用可恢复 UI/线程存储；真实模型连接和多项目显式绑定缺失，先隔离旧主动建议及执行假结果。当前线程只有一个 nullable `project_id`，不具备新合同的多对多。 |
| 项目身份/目标/决定 | PARTIAL | Observer 的 `observer_projects` 与通用 Demo `projects` 是不同存储；线程 `project_id` 为单值 | 不通过字符串相等猜测它们同一；新增稳定身份及明确 source/thread 关联、目标版本与决定；不自动迁移旧数据。 |
| 公开研究/观点/反馈修订 | MISSING | 现有 Insight 与 Analysis 分别是规则结果和单次推荐，未见所需 research job/source ledger/opinion revision | 新建受限端口及持久合同；独立证据链、预算、引用校验、版本、反馈、去重，初始关闭。 |
| 主动提示 | MOCK / PARTIAL | `routes/threads.ts` 线程级固定状态、演示建议或最多 3 张卡 | 不作为新主动观点；重建基于可证明价值、权限、去重、冷却/搁置的一条主提示，未就绪返回空。 |
| 叙事与火影 | PARTIAL | `apps/web/src/{features/projectEmber.ts,features/flameShape.ts,features/flameRenderer.ts,components/EmberAtmosphere.tsx,motion/emberMotion.ts}` | 复用视觉渲染、GSAP、磨砂、昼夜、静态降级、欢迎及对话布局；替换基于聊天/卡片的业务投影，不把强度当健康或完成。 |
| 隐私/安全/基础 API | PARTIAL | `docs/05-SECURITY.md`、`docs/04-CONTRACTS.md`、`apps/server/src/http/` | 维持 loopback、CSRF、Zod、项目隔离、撤销、来源版本及 append-only 审计；新路径额外覆盖研究网络和执行隔离。 |
| 真实 H1、价值评审 | BLOCKED / NOT_MEASURED | `docs/mvp/03-ACCEPTANCE-SCENARIOS.md` | 尚无当前真实研究授权、外部 Provider 配置及用户价值评审证据；离线 fixture 不能替代。 |

## 三、证据与边界

- 本次复跑 6 个现存测试文件、46 个测试通过：Observer、Insight coordinator、Pi 的合成进程及授权/恢复、旧火焰行为；详情 `handoff/EVIDENCE/mvp-g0/baseline-tests.txt`。命令含一个不存在的旧路径，Vitest 忽略了它，实际只运行日志列出的 6 文件；不声称覆盖该路径。旧火焰测试通过只证明旧行为仍存在，**不符合新合同**。
- 远端 CI 的实际 SHA、失败数量与链接见上；本轮没有重跑完整 CI 或 H1。
- 未读取/登记任何真实私人目录，未联网访问研究源或调用模型；未证明生产网络与模型可用。
- H1 中若以本仓库作为“真实项目”，工作树在审查过程发生本任务文档写入会污染“不发生开发写入”比较，需单独的用户明确授权只读仓库与基线，或另备隔离的明确标注真实验证环境，不能偷换合成数据。
