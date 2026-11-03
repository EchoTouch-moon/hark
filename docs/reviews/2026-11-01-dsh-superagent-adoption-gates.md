# DeepSeek 借鉴决策、Gate 与可交付任务包

> 来源：[审查主报告](./2026-11-01-dsh-superagent-hearth-gap-audit.md) · [证据登记](./2026-11-01-dsh-superagent-evidence-register.md)。  
> 状态：**PROPOSED, NOT AUTHORIZED FOR IMPLEMENTATION**。仅审查、记录与提议；不得把本 PR 合入/批准理解为开启实际 Agent 写操作或云模型使用。

## 1. 采纳决策（Decision log）

| 决策 ID | 机制 | 处理 | 理由/禁止的误用 |
|---|---|---|---|
| DEC-01 | 明确/推断 Trigger 分开 | **ADAPT** | Hearth 已有 Rule-first 及 Insight；只增加影子候选决策，不加全新 Dispatcher |
| DEC-02 | 默认 `observe` | **ADOPT** | 默认仅记录候选/原因；与公开研究预授权和模型授权严格分离 |
| DEC-03 | Context-only Subscription | **ADOPT** | 关联只带来可读背景，不可带来更多网络/执行权限 |
| DEC-04 | Versioned Mandate | **ADAPT** | 实现为独立的 ResearchPolicy/授权哈希/撤销记录；每次调用前必须重验 |
| DEC-05 | Ticket/Assignment 分离 | **DEFER / SELECTIVE** | 后续只复用持久 ResearchJob 恢复思想；不创建第二套外部写任务域 |
| DEC-06 | Effect/Outbox/Receipt | **ADAPT** | 研究与主动观点送达需可追踪；显示后确认前崩溃时诚实保留 uncertainty |
| DEC-07 | 无审批的 OS Worker | **REJECT** | 冲突于 Hearth 用户显式单次审批与只读默认 |
| DEC-08 | Inline/Spill 与 Chain of Recall | **RESEARCH BACKLOG** | 单独归 Context Runtime；R2 after/R3 Fact-Loss Gate 完成后再比较 |
| DEC-09 | Supervision dashboard | **REJECT AS MAIN UI** | 只将必要的审计/状态查看置于次级入口，保留 Hearth 单炉心对话 |
| DEC-10 | 全自动主动编码 | **REJECT FOR MVP** | H1 目标是有依据的观点、计划与用户反馈；不是完成大量 PR |

## 2. 必须先通过的安全闸门

### Gate S0 — 阻断旧入口的真实模式副作用（P0，阻断后续研究/模型链路）

**范围**：`apps/server/src/http/routes/{threads,runs}.ts`、`packages/core/src/orchestration/orchestrator.ts`、模式识别/授权中间件和关联 UI。必须基于 G0 原安全合同修复，不改变已有取消/诊断能力的合法边界。

- **S0-01**：真实/未知运行模式直接调用 `POST /threads/:id/actions/:actionId/execute` → 拒绝，检查 `demo:false`、`needsConfirm` 等客户端输入不影响服务端准入；拒绝时不写历史 run/Message。
- **S0-02**：真实/未知模式直接调用 `POST /cards/:id/execute`、`POST /approvals/:runId` → 拒绝/受限；审计间接 Orchestrator 与中断恢复。保留已有合法任务取消和只读查询。
- **S0-03**：`GET /threads/:id/proactive` **零写入**，不能 `ensureThread`、`appendChat`、`updateThreadProactive` 或 `touchThread`，不把全球 `listCards` 投进不关联项目的线程。明示绑定/项目权限不足则空结果或拒绝。
- **S0-04**：两项目各唯一 sentinel，测试无绑定、跨项目 ID、直接 API、重复 GET、重启后读取与并发读取；无数据串线。
- **S0-05**：本机 PUT observe 的 Origin-only 设计需要单独威胁复核，检查 Origin 缺失/伪造、全局 hooks、CSRF、DNS rebinding、凭据、授权持久化与撤销；动态证据不足则标 BLOCKED，不擅称已经被攻破。
- **S0-06**：`observer` read-only，异常/stale/gap/disabled 不能反推出项目健康或完成；N08/N17–N21 和 no-WebGL 等状态回归。

**出口**：S0-01..06 有真实测试命令、命中路径、测试计数、提交 SHA、失败日志、证据文件；服务端写/exec spies 为零；原 G0 N07/N08/N11/N12/N16/N17–N22/N25/N30/N31 覆盖；若原安全 E2E 失败，逐条保留并归类。结果由 owner/QA 确认，不以仅增加文档视为通过。

### Gate S1 — 影子主动性（仅在 S0 PASS 后立项）

**假设**：决策模型的推断候选能够低成本提出比原规则摘要更有价值的研究问题，同时不增加误报、越权或注意力负担。

- 给候选加最小 `AdmissionDecision`（`candidateId,projectId,triggerRefs,ruleVersion,kind:explicit|inferred,disposition:ignored|would_research|blocked,reason,createdAt`），此对象**不携带执行 token**。
- 默认 `shadow`：允许本地确定性判定和来源/去向记录；禁止云模型、网络出站、自动发卡、命令执行。后续真实授权可单独启用允许域内公开研究；研究授权不可产生执行授权。
- 规则变更、source epoch 变化、项目删除/暂停、授权撤销、重复事件以及重启的去重与决定状态可查询。
- 如果新增的影子候选只是“测试失败、请看日志”等低价值噪声，必须有负反馈/降噪闭环。
- 与 H1 的意见价值手工评价联动；不能以候选数量或模型热词证明提升。

**出口**：不少于两个明确授权的真实项目（涉及私人数据时需单独确认）形成影子日志；无权限、重复、新旧规则、跨项目、离线和重启负例全部正确；人工评价不低于事先约定的价值门槛，未评价时 NOT_MEASURED。本任务不允许自动尝试调用 Pi。

### Gate S2 — 受限公开研究 + Opinion Revision（另行发起）

**输入合同**：仅按 [G0-02](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/02-contract-and-decisions.md) 的四项授权，公开主题必须脱敏；ResearchJob 每次重验 `projectId/source/scope/policyVersion/budget/recipient`。外部网络与模型分别授权，不能复用旧 Analysis 的一次性确认。

- 事务预留配额并设有界并发/最大超时；一旦网络外发结果不确定，记录 `outcome_unknown`、不得盲目重新计费。
- 向 OpinionRevision 填充事实、来源、推断、反证、时间限制、可证伪条件、用户反馈；新版本不可覆盖旧结论。
- 主页面最多一条主观点；`would_present`、`presented`、`acknowledged` 区别保存，重试须保留“可能重复显示”的真实不确定性。
- 多项目关联严格使用 project scope；公共研究来源不能证明私有项目事实。

**出口**：H1 真实纵切、独立用户价值评审、无未批准执行/私有外发、有效的审计及证据留存，全部 PASS 才可提升状态；目前 **NOT_MEASURED**。

### Gate S3 — 长任务上下文与多 Worker（DEFER）

- Context Runtime：先真实记录 Compaction before/after 请求（现有 R2 缺 after 的问题），再通过 R3 关键事实丢失 Gate；之后才评估 durable state、deterministic rehydration、Chain of Recall 试验臂。
- 多 Worker：只有在单项目 H1 的意见质量与授权恢复通过后，才考虑并发研究；无需把 DeepSeek DSH Executor 原封不动迁入 Hearth。
- A2A：继续由 Agent Internet Lab 研究跨信任域协议，不以 Super-agent Router+Worker 的中心化机制替代。

## 3. Agent 可直接领取的审查/实施分工（仅任务建议）

| 任务 | 推荐负责 | 前置 | 交付 |
|---|---|---|---|
| DS-H-01 | Security/Backend Agent | owner 明确批准、锁定正确分支 | S0-01/02 的负例先行、入口修复与恢复审查 |
| DS-H-02 | Backend Agent | DS-H-01 安全协议冻结 | S0-03/04 的 GET 无写和 project scope、DB diff |
| DS-H-03 | Security Agent | 可独立审计 | S0-05 Origin/CSRF 威胁模型、最小修订建议 |
| DS-H-04 | QA Agent | 变更入候选分支 | S0 全套 e2e 安全断言；历史失败分类 |
| DS-H-05 | Agent Mechanism | S0 PASS + 用户发起 | S1 shadow admission 最小 schema + replay + 价值标注 |
| DS-H-06 | Research/Opinion | S1 门禁与网络权限另批准 | S2 ResearchJob/Opinion Revision 与 H1 真实评审 |
| DS-CR-01 | Context Lab | R2 after + R3 Gate | DSH 链式召回只做研究提案，不改 Hearth Runtime |

## 4. 合并与状态治理

1. 本审查分支基于 `bot/hearth-g0-contract` 的 **e470436**，**不是**基于老 `master`；评审 PR 应先瞄准 G0 集成分支。
2. 仅添加三份 `docs/reviews/2026-11-01-dsh-superagent-*.md`，不修改现有 G0 合同、不引入 DSH 依赖/源码、不改业务或测试，也不自动合并。
3. 若 G0 后续继续合入，必须重新对齐最新 SHA，解决冲突；不能沿用本次已阅旧代码推断它仍存在。
4. 下一轮实施必须附具体授权范围、执行分支和开销限制；任何出站公开检索/真实 Pi 调用都需要独立授权。此报告不提供授权。
5. 这套 Gate 的最高优先级依然是 **先消灭现有安全问题，再证明意见价值**，不是提升自动 PR 数量。

## 5. 本次审查通过标准

| 审查项 | 当前 |
|---|---|
| 冻结两方 Git SHA / 代码和文档证据 | PASS (静态) |
| 区分现有实现与文章设想 | PASS (静态) |
| 从已有 G0 合同核实安全冲突 | PASS (静态) |
| 列明 ADOPT/ADAPT/REJECT/DEFER | PASS (静态) |
| 写出负例与开发顺序 | PASS (审查文档) |
| 运行新的安全测试 / CI | NOT_RUN |
| 证明 G1-A 修复通过 | BLOCKED |
| 证明 H1 人工观点价值 | NOT_MEASURED |
| 执行实测 DeepSeek 原型 | NOT_RUN |

本轮文档审查完成不应改变以上后三项状态。
