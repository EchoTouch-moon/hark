# DeepSeek dsh-superagent × Hearth：架构与安全差异审查

> 审查日期：2026-11-01（Asia/Taipei）  
> 审查类型：**静态源码/合同差异审查，非渗透测试、非动态端到端验收**  
> 结论：**CONDITIONAL_ADOPT（只选择性借鉴） / G1-A SAFETY BLOCKED（已有高风险入口尚待修复和验证） / H1 VALUE NOT_MEASURED**。  
> 本文件是审查记录，**不是产品方向变更、实施授权、付费模型使用许可或分支合并许可**。

## 0. 版本与可追溯性

| 对象 | 精确基线 | 说明 |
|---|---|---|
| DeepSeek 公共研究原型 | [6337fc8](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e)；2026-10-31 | 只有公开版；README 明确“研究原型、非正式产品、与内部和文章实现不完全一致” |
| Hearth 当前 MVP 集成线 | [e470436](https://github.com/EchoTouch-moon/hark/commit/e470436d52f618de606b50b260c8734f11fb7a9c)；`bot/hearth-g0-contract` | 本审查主要代码/合同基线；该分支已有 E1/M1/M2/I1 等合并 |
| Hearth 主分支 | [e5752ce](https://github.com/EchoTouch-moon/hark/commit/e5752ce7894d77461e780c84609c7fe26d6ccf61)；`master` | **不同于 G0 实施线**，尚未拥有完整 `docs/mvp/g0` |
| 当前合同 | [G0-02](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/02-contract-and-decisions.md)、[G0-03](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/03-plan-threats-traceability.md)、[G0-05](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md) | 历史计划中的 “NOT STARTED” 行应视为该文档编写时状态，不覆盖后续合并 |
| 价值门禁 | [R2 质量整改](https://github.com/EchoTouch-moon/hark/blob/e5752ce7894d77461e780c84609c7fe26d6ccf61/docs/verification/remediation-r2.md) | 工程测试记录与人工价值证明不是一回事 |

**范围**：DeepSeek README、000–008 设计文档、`src/core/{intake,evals,tickets,model,replies}`、`src/app/{effects,outbox,cache}`、`src/policy.ts`、`src/executor/dsh.ts`；Hearth 产品/MVP/G0 合同、旧线程/审批路由、Observer→Insight→Analysis、M1/M2/I1 的只读 ViewModel 与授权写接口。**没有**运行 DeepSeek Harness、安装其依赖、调用模型、操作用户真实项目或重跑 CI。文章讨论的 Inline & Spill / Chain of Recall / Watchdog 不得直接当成公开版已经达到的工程事实。

## 1. 总结裁决

**核心判断**：两者在“事件驱动、跨对话连续性、权限与上下文解耦、持久恢复、节制主动打扰”上相似，但核心产品对象不同。DeepSeek 是 *authorized coding work / Ticket*；Hearth 是 *持续项目理解 / Project + OpinionRevision*。不得为了追赶 Super-agent 而把 Hearth 重建成自动编码工单系统。

- **直接参考（仅设计/测试）**：`observe` 影子准入、Trigger 的去重与去向、context-only 订阅不扩权、授权版本及恢复时重验、可靠状态/结果送达、向用户解释为何被触达。
- **沿用 Hearth 原合同**：Project/Source/Goal/Decision/OpinionRevision、三类证据类型、计划先展示、实际开发操作每次具体确认、默认关的研究与模型授权、火焰/故事单一 NarrativeState 投影、只读 Observer 和有限公开研究。
- **不采纳**：Worker 以 OS 当前用户身份无审批运行命令、源消息自动变更执行授权、`auto` 为 MVP 默认、把非正式 GitHub/飞书 Thread 直接等同项目身份、用 Supervisor Dashboard 替代炉心对话、在未证明关键事实丢失前开展复杂上下文 Planner。
- **优先级**：先完成已经在 G0 找出的真实/未知模式执行入口和跨项目暴露安全基线，再谈影子主动发现/研究；当前 H1 的价值门禁仍是 NOT_MEASURED。

## 2. DeepSeek 源码与合同复核

| ID | 事实 / 精确来源 | 观察结论 | Hearth 处理 |
|---|---|---|---|
| D01 | [001 Domain](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/001-domain.md)、[intake.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts) | `Source → Trigger → Thread/Eval → Mandate → Ticket → Assignment`；Trigger 稳定身份用于重复摄入抑制；Thread 可关联多个 Ticket | **ADAPT**：保留独立 Event/Insight，不新增重复的 Ticket 领域模型；为来源和候选增加显式 disposition |
| D02 | [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md)、[policy.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts) | 显式消息与推断候选区分；`off / observe(default) / auto`；推断性自动准入必须在规则范围内 | **ADOPT concept**：`shadow_proactivity` 默认候选审查不引发出站模型/执行；自动研究仍另取 scope+budget 授权 |
| D03 | [001 Domain](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/001-domain.md)、[002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md)、[tickets.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/tickets.ts) | Subscription 将新消息送给既有任务作为上下文，但**不授予新的权限**；Worker 可 hand-back 出界需求 | **ADOPT invariant**：跨线程关联只增加可读证据，不扩大项目/网络/执行授权 |
| D04 | [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md)、[model.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts) | Mandate 绑定 scope/strength/policyVersion；策略变更可通知运行任务，已运行任务不是即时全部撤销；结束后恢复需重验 | **ADAPT, stricter**：Hearth 每次出站/执行前均重验当前版本、撤销与预算；不得复制“策略变化只通知、仍继续”的宽松语义 |
| D05 | [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md)、[tickets.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/tickets.ts) | Ticket 独立于 Executor Session，Assignment 可迭代，重启后保留部分工作/输入、失败/阻塞分类 | **ADOPT selective**：先用于只读 ResearchJob 与 OpinionRevision，逐步验证恢复；不引入可写 Worker |
| D06 | [effects.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts)、[outbox.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts) | 事务入队、重试、出站 receipt、每 Ticket/会话内排序；外部恰好一次依赖通道 idempotency key/回执 | **ADAPT**：内部状态可幂等；真实外发结果未知时标记 unknown，不能保证 exactly-once；针对主页展示确认保留不确定性 |
| D07 | [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md) | Worker 命令按操作者 OS 用户执行、无需逐条审批；prepare 可创建 worktree | **REJECT for MVP**：与 Hearth “执行必须由用户对具体计划发起”冲突，不能将其作为沙箱或安全担保 |
| D08 | [004 Prompts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/004-prompts.md)、[policy.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts) | 提示词可调整协作方式，但不能替代 host 强制的 Policy / Mandate 检查 | **ADOPT invariant**：LLM 输出不能成为授予权限的来源，Hearth server 的授权是唯一权威 |
| D09 | [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/005-panel.md)、[000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md) | 首先问“现在有事需要人吗”，强调注意力开销 | **ADAPT UX**：炉心对话保留主位；最多一主观点，其他记录按需展开；后台管理页非主页 |
| D10 | [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md)、[cache.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/cache.ts) | 工具按资源 ID 取分页的 Thread/Ticket/输入；TextCache 是受限 LRU 文本缓存 | **DO NOT OVERCLAIM**：并非公开实现中的 provider-neutral Context Universe/WorkingSet/Transition/因果重放 |
| D11 | [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md)、[007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md) | 面向单 GitHub Repo、可选飞书、依赖 DSH；公开原型与文章/内部实现有差异 | **BOUNDARY**：不可把文章全部设计或第三方性能图表作为本代码的可复现结果 |
| D12 | [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md) | 非原申请人的 Thread 后续消息在特定情形可恢复 Ticket，但仍受既有 Mandate 限制 | **DO NOT COPY**：Hearth 的多项目/私人资料场景必须严格校验用户身份、项目绑定与当前作用域 |

## 3. Hearth 实际差异与风险（截至 e470436）

### H-P0-01：旧 `GET /threads/:id/proactive` 跨项目候选混入、GET 有副作用

**静态证据**：[threads.ts#L175-L235](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/threads.ts#L175-L235)：`ensureThread(id)`，无 projectId 的 `listCards({status:'proposed',limit:3})`，并可能 `appendChat` / `updateThreadProactive` / `touchThread`。  
**影响**：一个无项目约束的线程可收到其他项目卡片标题和 whyNow；读取触发持久写入。跨项目动态利用、浏览器权限边界尚**未测量**，不宣称已完成攻击。  
**判断**：**HIGH / 已在 G0 发现、未见 G1-A 修复证据**。任何新主动观点 API 不得复用该旧路径；G1-A 先以真实/未知模式 fail-closed，后建立项目绑定和只读投影。  
**回归**：双项目不同 canary、无绑定与无权限线程、直接 HTTP 查询；GET 前后 DB/审计、消息与 Thread 完全不变。对应原 G0 N07/N16/N25。

### H-P0-02：旧 Thread action 通过客户端 `demo:false` 返回“完成”

**静态证据**：[threads.ts#L239-L328](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/threads.ts#L239-L328)：传入客户端 `body.action`；`action.demo !== false` 决定输出，非 demo 分支仍构造 `demo-run-` 与 `ok:true` 的 Mock progress。  
**影响**：把模拟展示表达为真实完成，污染用户信任和历史任务记录；不等同于已确认发生外部命令执行。  
**判断**：**HIGH / 已知旧问题**。真实/未知模式拒绝、演示模式由服务端辨别并隔离存储；禁止调用侧伪造 mode、risk、card 或 plan。  
**回归**：篡改 `demo:false`、actionId、needsConfirm、scope；真实模式无新增 run、消息或“成功”，Mock 只能呈现“演示”。

### H-P0-03：旧卡片执行/审批 API 仍调用 Orchestrator

**静态证据**：[runs.ts#L19-L58](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/runs.ts#L19-L58) 调用 `executeCard` / `decideApproval`；[orchestrator.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/core/src/orchestration/orchestrator.ts) 的动作/恢复流水线。  
**影响**：仅隐藏 UI 不会阻止直接 API；任何新的研究许可不能借助旧 Action/ApprovalGrant 触发副作用。  
**判断**：**HIGH / 静态可达风险，未做真实动态执行验证**。对真实和未知模式做服务端拦截，并审计启动恢复、执行路径、历史 Run 与独立取消。  
**回归**：直接 POST 各执行/审批入口与伪造 L0/L1/action/approval；验证 executor 调用=0、worktree/HEAD/status 不变，同时仍可取消合法已有任务。原 G0 N11/N12/N22/N30。

### H-P1-04：M1/M2/I1 已有 ViewModel 闭环，但不是独立“项目心智”

**静态证据**：[hearth.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/hearth.ts)、[observe-view.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/observe-view.ts)、[hearth-contract](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/hearth-contract/src/index.ts)、[hearthViewModel.tsx](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/web/src/features/hearthViewModel.tsx)。  
**已实现的局部能力**：只读 `GET /api/v1/hearth`、observe 权限持久化、真实模式错误不回退 fixture、Chronicle/Flame 投影、`featuredOpinion:null`、`execute:false`。对应 E1/M1/M2/I1 的已合并 PR [#8](https://github.com/EchoTouch-moon/hark/pull/8)、[#9](https://github.com/EchoTouch-moon/hark/pull/9)、[#10](https://github.com/EchoTouch-moon/hark/pull/10)、[#11](https://github.com/EchoTouch-moon/hark/pull/11)。  
**仍未在本基线证实**：公开研究的持久授权/外发、项目 Goal/Decision、OpinionRevision、用户反馈修订以及 H1 的真实验证。**不得仅凭新 UI/合并记录宣布“心智已具备”。**

### H-P1-05：权限写入口采用 Origin 单独门禁；需单独威胁复核

**静态证据**：[hearth.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/hearth.ts) 的 `PUT /api/v1/hearth/permissions` 检查 Origin，并没有在路由内执行独立 CSRF token 验证；[前端调用](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/web/src/features/hearthViewModel.tsx) 明确标记 Origin-gated/no CSRF。  
**判断**：**REVIEW REQUIRED（不是已证实可利用漏洞）**。与 [docs/05-SECURITY.md](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/05-SECURITY.md) 的请求保护目标比较：确认全局服务 hooks、反向代理 Origin、浏览器凭据/同源、无 Origin 发送、DNS rebinding 及本机其他进程威胁模型；不要仅因是 localhost 就视作充分。按真实测试结果裁决是否必须补 token、double-submit 或统一服务端 CSRF。

### H-P1-06：新鲜度与火焰投影尚需反例评审

**静态证据**：[observe-view.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/observe-view.ts)：stale 时仍调用 `deriveFlame(story, now)`，仅覆盖 reason；[G0 05](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md) 要求错误态不得暗示健康。  
**判断**：**TEST GAP**，不等于已出现错误。需要检查过期/间隙/禁用/无覆盖与章节点/视觉强度是否可能出现误导；N08/N17–N21。

### H-P1-07：当前开发/合同状态不能混为一谈

`master` 是较旧主线；新 G0 集成线已经合并 E1/M1/M2/I1，但 [G0-03](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/03-plan-threats-traceability.md) 仍有初拟 “NOT STARTED” 表。此冲突属于**状态文档滞后**，不代表旧实施被撤销，更不能推导 G1-A 安全 Gate 已通过。后续更新状态索引应引用实际 SHA/测试/PR，不改写历史审查文字。

## 4. 能力映射（防止重复建设）

| 关注点 | 现有 Hearth 对应 | 缺口 | 决定 |
|---|---|---|---|
| Git/项目事件来源 | P0 Observer、P1 Insight、SQLite/epoch | 数据源及跨项目授权边界一致性 | 复用，绝不重写第二套 Source Framework |
| 候选筛选 | `DiscoveryService`、Insight、suppression | 推断候选 shadow decision、价值审查理由、可测 attention cost | 独立小切片引入，不直接 dispatch |
| 会话和项目 | Threads、M1 HearthViewModel | Project/Thread 明确多对多、Goal/Decision | 按 G1-B，不以 DSH Thread 替代 Project |
| 观点记忆 | 旧 Recommendation Card / 有设计合同 | Opinion / Revision / 反例 / 可证伪条件 /反馈 | 按 G1-C、G3，Hearth 独立优势 |
| 执行与授权 | Policy / ApprovalGrant / 旧 Orchestrator | 真实模式旧路径隔离和新研究授权模型 | G1-A 阻断，保持 execute:false |
| 恢复和消息 | Observer forward seq、analysis recovery、审计 | ResearchJob crash/外发 unknown、proactive delivery receipt | 借鉴 effect/outbox 原则，不引入自动执行 Worker |
| 上下文工程 | [Canvas Agent v0.4](https://github.com/EchoTouch-moon/canvas-agent/blob/main/docs/research/context-runtime-v0.4-direction.zh-CN.md) | R2 after-context / R3 factual loss 未闭环 | 不因为 Inline/Spill 概念就跳过 R3 Gate |
| UX | 单炉心/对话/一条观点 | 注意力收益与实际信息价值尚无评审 | 保留现有产品主线，新增拒绝原因与反馈指标 |

## 5. 研究交叉性裁决

### 与 Context Runtime

DeepSeek 的“历史可检索、资源按需读取、LRU 缓存”与我们的 `Universe → WorkingSet → Transition` 处于相邻层次，但不是同一可验证机制。我们研究的是**真实压缩/替换后 critical state 是否丢失，以及怎样度量 rehydration 的增益**。不得把文章中 Inline & Spill / Chain of Recall 与这个公开 Repo 的 `TextCache` 画等号。

**可登记的后续假设（本次不开展）**：静态 Durable State 与确定性 Rehydration 通过 R3 后，再比较沿引用链召回带来的事实保持增量/成本变化。设计实验臂必须保持真实 Provider request binding、对照组与 fail-closed 证据。

### 与 Agent Internet Lab

本原型属于中心化 Router+Worker、单信任域的协作机制，不等于独立 Agent 之间的 A2A 协议网络；可以借鉴任务身份、幂等、状态/去向记录，但不能作为 A2A 语义与可靠性实验的替代物。

## 6. 风险/成本/不确定性

- **安全**：DeepSeek worker 是有副作用的 OS 执行主体；Hearth observer/research 默认不能接它的工具权限。
- **重复 / exactly once**：网络外发或 UI 显示成功前崩溃不可承诺绝不重复。入库事务唯一性、幂等出站和确认回执是不同层。
- **上下文污染**：Source 原文/Issue/README/模型结论始终是数据；允许引用≠获得新权限。
- **注意力**：降低模型调用成本不一定降低打扰成本；`would_present` 与用户真实反馈要分别记账。
- **工程复杂性**：复制整套 Event/Thread/Ticket/Assignment/Sources 将与现有 P0/P1/G0 重复，造成迁移/回归风险。
- **许可证**：公开仓库标记 MIT；本次只引用与比较概念，没有复制源代码；未来若复制实现需检查对应 LICENSE、保留告知并单独审查供应链。

## 7. 结论与边界

**本次可结束的工作**：完成静态差异审查、风险排序、来源冻结、建议任务与验收矩阵。  
**本次不能宣称**：DeepSeek 原型的运行效果、Hearth 新 G1-A 修复完成、真实项目分析完成、公开研究启用、人工建议价值通过、无需用户确认即可执行工作。  
**最终意见**：不改 Hearth 核心产品叙事；先堵旧执行/跨项目入口，再以 shadow mode 实证“主动评价本身是否有价值”，只把持久任务恢复用于只读研究。
  
配套文件：[证据索引](./2026-11-01-dsh-superagent-evidence-register.md) · [采纳决策与门禁任务包](./2026-11-01-dsh-superagent-adoption-gates.md)
