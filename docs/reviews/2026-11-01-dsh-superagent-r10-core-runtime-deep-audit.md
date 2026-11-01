# R10 · DeepSeek Super-agent 底层机制复审：领域事务、活跃集合、可靠效果与 Hearth 的心智边界

> 2026-11-01 · [PR #12](https://github.com/EchoTouch-moon/hark/pull/12) · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**  
> 复核 [R8 源码级迁移](./2026-11-01-dsh-superagent-r8-source-level-migration.md)、[R9 执行/恢复对照](./2026-11-01-dsh-superagent-r9-execution-recovery-contrast.md) 及 [R7](./2026-11-01-dsh-superagent-r7-mechanism-contract-freeze.md)。  
> 固定上游代码 `deepseek-ai/dsh-superagent-prototype@6337fc823ce20251c8de8085948165c81aaa701e`、Hearth 代码 `EchoTouch-moon/hark@e470436d52f618de606b50b260c8734f11fb7a9c`。此报告从 **TypeScript/SQL 源码**判定，未安装/运行系统、未执行故障注入或真实模型/任务。  
> DeepSeek [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md) 明确这是研究原型，和文章及内部生产实现并不相同；不可把作者文章中的云端无状态计算、外部语义 Watchdog 和长期记忆都当成本 Repo 已交付。

## A. 给第一次读 Agent 架构的人：把它想成什么？

**DeepSeek 的核心不是“Router 有多聪明”，而是让模型推理成为一个由程序管理的可替换组件**。一个事件有身份、去向和来源；一次语义判断有基于哪个规则版本的理由；一个任务有比模型 Session 更长的生命周期；一次外部动作有可靠的待发送记录、确认或不确定性。

先辨认四种经常被称为“状态”的东西：

| 状态 | DeepSeek 中例子 | Hearth 应对应什么 | 不应混同 |
|---|---|---|---|
| **事件事实** | `Trigger`、`Thread`、`Disposition` | Observer Evidence/来源版本/用户 Decision | 事件不是授权 |
| **工作与授权** | `Eval`、`Mandate`、`Ticket` | ResearchJob/ResearchPolicy；未来逐案 ExecutionConsent | 工作任务不是长期项目观点 |
| **运行与送达** | `Assignment`、`Executor Session`、`Effects`、`Outbox Receipt` | Research/analysis 运行态、Presented Claim/Ack、不确定状态 | “已排队”不是“已成功/用户已读” |
| **长期项目认知** | **公开原型没有可等价对应物**；`core/memory.ts` 是测试用 MemoryRepositories，`app/cache.ts` 是进程 LRU | Hearth Project / GoalRevision / EvidenceRef / OpinionRevision / Feedback | Session transcript 和短期 LRU 不是“灵魂” |

### 源码级数据流

```text
GitHub / Feishu Source
    │  来源读取配置 + 稳定 Trigger ID
    ▼
Intake.receive ── Filtered? → Trigger + filtered Disposition
    │ allow / dedupe
    ├──→ 已订阅的 Ticket Input（context only，不授新权）
    ▼
Thread pending → Engine.evaluateDue
    ▼
Policy.gate [程序: 谁 / 哪个 Source / implicit/explicit]
    ▼
Eval Candidate → MasterAssessor [模型可提议 accept]
    ▼
Policy.assessmentOutcome [程序: rules, direction, intent evidence, mode]
    │                          │ observe inferred
    │                          └─→ ignore + would_accept 审计
    ▼ accept
Decision + immutable Mandate + Ticket + Assignment
    │  **同一 repo.atomic() 中提交领域变化和 Effect 入队**
    ▼
Effects SQLite queue (kind,key,seq,generation,due)
    │  仅 COMMIT 后，才异步调度
    ▼
DshExecutor / Session / external IO
    │  assignmentStarted / inputsRead / report / interrupted
    └─────────→ Engine 更新事实；Outbox 生成 receipt + reply effect
                                      │
                                      └─→ Source Channel / user
```

来源：[Engine](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/engine.ts)、[Intake](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts)、[Evals](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts)、[Policy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts)、[Ports](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/ports.ts)、[Effects](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts)、[Outbox](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts)。

## B. R8 必须撤回的一条重要错误：SQLite Generated Columns **已经实现**

R8 §0 说“`docs/007` 的 generated columns 是愿景，代码没有；`store.ts` 只是 9 张 JSON 表，全仓 `open INTEGER` 零命中”，并据此列 M6 为“不要按文档实现生成列”。**这项事实判断被固定版本源代码直接反驳。**

**可逐行复验的完整路径**：

1. [`src/app/store.ts:30–48`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L30-L48) 声明 `const SETS`：
   - `ticket.open`：当 `value -> '$.ended'` 为 NULL 时映射到活跃工作集；
   - `ticket.active`：`undelivered` 非空或最后一个 assignment 为 pending/running；
   - `thread.active`：有 pending Trigger 或正在 Eval；
   - `thread.subscribed`：含订阅时提取来源；
   - `outbox.dropped` / `outbox.pending`：送达状态的查询列。
2. [`src/app/store.ts:67–96`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L67-L96) 在 `Store` 构造函数的 `atomic()` 内创建基础 `id/value` 表后调用 **`this.addColumns()`**。因此只看 `CREATE TABLE` 自然会漏掉。
3. [`src/app/store.ts:98–119`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L98-L119) 的 `addColumns()` 读取 `pragma_table_xinfo` 与 `sqlite_master`，增改生成列，执行 `ALTER TABLE ... ADD COLUMN ...`，并执行 `CREATE INDEX ... WHERE column IS NOT NULL`（部分索引）。
4. [`src/app/store.ts:210–240`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L210-L240) 的 `threads.active()`、`tickets.open()`、`tickets.active()` **确实按列查询**；[`src/app/store-read.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store-read.ts) 使用 `subscribed` 与 `dropped` 索引；`subscribedThreads` 甚至显式 `INDEXED BY thread_subscribed`。

**正确结论**：表的**原始行体**是 JSON 文档，但活跃工作集的**索引与查询**采用生成列/部分索引；这两个事实同时成立。我们可以研究借鉴“模型 Domain Record 的持久 JSON 表达 + 可查询的派生索引”，而不意味着 Hearth 必须立即改成 JSON 存储。

**状态修订**：将 R8 §0、§2.4、M6 和总结中的“未实现”标为 **RETRACTED_FACTUAL_CLAIM**；该实现的性能改善、数据库兼容成本和是否优于 Hearth 现有关系表依然 **NOT_BENCHMARKED**。

这次误读比此前更加有教学价值：**不能以 grep 零命中/初始 DDL/文档口号之一单独证明“不存在”；要沿构造函数、迁移、索引查询和测试路径追踪。**

## C. 真正能迁移的“底层品质”，而不只是类名

### C1. 事务内做决定，事务外做副作用

[`Engine`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/engine.ts) 的 `receive`、`decide`、`assignmentStarted` 等用 `repo.atomic` 包住**同步状态变化**，与下游 `Executor/Assessor` 端口的契约明确规定“在该事务中只能排入队列”。实际网络/进程 IO 由 [`Effects`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts) 在提交后执行。

- 程序真正保证的是：**已提交的领域事实与待执行 Effect 同时存在**；队列后来执行失败不丢掉本地“应当发生什么”的记录。
- 它不保证外部 side effect 普遍 exactly-once：实际发送已成功、`Outbox.receipts.settle` 之前进程崩溃，可能再次尝试；是否重复取决于具体 Source 平台和使用的幂等键。
- 它也**不是全部零副作用 Engine**：`Engine` 会调用 `options.executor.start()`、`assessor.request()` 等，但端口实现只应在事务中 **enqueue**，而非同步执行 shell。所谓“Engine 不执行”是**分层契约**，不是“Engine 与执行没有关联”。

**Hearth 启发**：既有 `executeCard` 在 `createRun` 后直接启动 async `process`。无需照搬 Ticket/Assignment 全状态机，也应在**允许真实副作用之前**有可重验的服务端 G1-A 统一门禁；把“记录意图”与“实际执行”在可测试边界上分开。恢复操作只核验已发生结果，**不能与发起执行共用会悄悄重跑的动作方法**。

### C2. “活跃工作集”只索引要做的事，而非让模型读全历史

[`Store.SETs`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L30-L48) + `threads.active/tickets.active` 用派生列找待处理工作；[`Engine.evaluateDue`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/engine.ts#L69-L90) 只推进活跃 Eval/Ticket。这样**历史保留**和**调度负载**不必成正比，且更容易重启恢复。

**Hearth 启发**：Chronicle/OpinionRevision 可以持续增长，但只有 `unresolved evidence`、`due research`、`opinion needs review`、`pending presentation` 等工作集需要被调度。**不是把整个项目历史塞进一个永远运行的 LLM Session**。是否增加索引要先拿到实际访问模式和数据规模，不能以“DeepSeek 用了”自动立项。

### C3. “责任/工具权限”和 TypeScript 接口要分开

[`engine.ts:261–270`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/engine.ts#L261-L270) 给 Sources、Main Session、People、Settings、Executor 导出 `Pick<Engine,...>` 子接口；[`runtime.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/runtime.ts) 负责装配。这会减少误用并提升编译期可读性。

但 **`Pick<>` 是编译时形状，不是运行时 capability sandbox**。同进程若持有原始对象引用或 JS 可被强转/绕过，不能依赖它保证外部用户不可越权。DeepSeek Worker 本身可能按 OS 用户使用 shell 工具；Source 账号和 OS 权限仍是另外的边界。

**Hearth 启发**：把 Observer/Research/Presentation/Execution 的**端口依赖**收窄（审查上更好、更利于测试），同时必须保留服务端鉴权、项目 scope、action-time policy 和外部工具隔离。不要在安全验收中把“TS 类型检查通过”算作权限已强制。

### C4. 单步确定性 Engine 和周期 Scheduler 是两回事

DeepSeek [`Engine.evaluateDue`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/engine.ts#L69-L90) 可被宿主显式调用；但 [`Passes.start()`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/passes.ts) **仍然用 `setInterval(2000)` 定时驱动**，`Runtime` 还拥有各类真实时钟与后提交回调。因此 R8 的“外部驱动的单一时钟”应该精确写成：**核心领域推进接口可单步调用、确定性边界更清晰；整个原型并非无真实定时器**。

Hearth [`InsightCoordinator.schedule`](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/project-insight/src/coordinator.ts) 将定时与 `tick()` 私有执行混合在一起，测试会用 `intervalMs:20`、轮询等待。R8 的 `tickOnce(clock)` 建议可用于**隔离测试性**，但须先证明一次真实 CI 失败来自何种并发/时序竞争。即使重构了时钟，也不等于调度状态/持久性问题全自动解决。

### C5. 过滤事件仍留下去向，但 Hearth 不复制原始内容

[`Intake.receive()`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts#L19-L35) 对源过滤的事件同时存储 **原始 Trigger** 和 filtered Disposition。R8 说“一行一事件的 Disposition 只存去向与码”只对 **Disposition 自身**成立，**整个系统仍存了被过滤的 Trigger 文本/元信息**。

**Hearth 更好的独立选择**：仍可记录 `reasonCode,ruleVersion,projectId,decidedAt,匿名计数` 的最小审计，而**默认不存**被拒绝事件的私人正文/绝对路径/原始模型输出。先有完整的删除/保留协议，再定 TTL；不要声称复制 DSH 就天然隐私安全。

### C6. 双层 Gateway ≠ 第二个万能脑

DeepSeek 的 Main Session/Router 只负责判断与协调，其工作任务有 `Ticket` 和 `Mandate`。Hearth 有更重要的长期概念：**Project + GoalRevision + Evidence + OpinionRevision**。

产品心智循环应是：

```text
ProjectSource / User Decision
         ↓
Evidence intake (+ provenance/epoch/version/permission)
         ↓
Relevance → potential unresolved question → Opinion draft
         ↓              ↑
Counterevidence / stale / goal changes / revision
         ↓
OpinionRevision (immutable, auditable, revisable)
         ↓
Presentation Eligibility → AttentionBudget
         ↓
HearthViewModel (“炉心”, 只能投影一条核心观点)
         ↓
User feedback / human decision
         ↺ (new Goal/Opinion revision, NOT an automatic execute)
```

这比 DSH 的任务路由器多一层**认知正确性与意见可修正性**：一个任务完成，不证明项目观点正确；用户拒绝一个方案也不自动证明其技术论断是错误的。**Hearth 的创新不应来自重复 DSH 的 Ticket，而应来自“以证据维护长期项目判断的可检验闭环”。**

## D. R9 执行/恢复对照：哪些成立，哪些需更严格？

| R9 判断 | 核查 | 严格表述 / 研究建议 |
|---|---|---|
| Engine 状态变更不直接跑 shell，外部 Executor 回报事实 | **正确，需注明 enqueue port 语义** | Engine 在事务内可**触发副作用排队**，但 port 必须在事务外执行实际 I/O，避免“Engine 绝不触及副作用”过强 |
| Hearth `executeCard` 先创建 queued run 再启动 `process`，Policy 在 `process` 里二次检查 | **正确** | 恰好说明要同时审计所有入口、定时恢复、执行前最后重验；但“任何 queued run 都自动执行”不成立，仍要有相应调度路径 |
| `evaluatePolicy()` 无 `demoMode` | **正确** | G1-A 的**运行模式强制**应在所有会造成执行的入口与 final-effect 边界处理，而不能只在 UI/routing 或 prompt；与既有 ActionPolicy 正交 |
| `transitionRun` 与 `updateCard` 非同一 SQLite 事务 | **正确** | 可能产生 run/card 不一致的 crash window；严重性仍需基于可复现故障注入，不应直接称已发生严重漏洞 |
| “恢复应该能把两者自愈” | **缺条件；不能推断** | [`recoverInterrupted`](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/core/src/orchestration/orchestrator.ts#L179-L213) **只枚举 executing/verifying**。例如 `transitionRun(...,'completed')` 之后、`addEvidence` 或 `updateCard` 之前崩溃，run 已 completed，**不会进入该恢复扫描**。是否有其他独立校正路径本次未全量验证 |
| 恢复不重跑动作、结果未知时标 `pending_verification` | **源码成立** | 正确处理可观察产物，仍必须区分验证器是否真能证明原动作已完成；尤其不可从 Mock 验证推导真实项目执行安全 |
| “两条写入路径共用一个执行入口函数” | **需修正** | **执行启动和恢复不应合并为会重跑动作的同一入口**。共享的是统一的 capability/mode gate、稳定状态转移与恢复语义；恢复应仅核验/收敛已存状态 |

### D1. 不能因为有 double-write 就立即重构

故障模型先拆三层：  
(a) 领域事务被部分写入（同 DB 多表一致性）；(b) DB 已提交但外部 IO 未发生；(c) 外部 IO 已发生但 DB 未确认。  
三类问题解决方法不同：**原子事务**处理 (a)，**持久效果队列**改善 (b)，**幂等回执/状态核查/显式 unknown**应对 (c)。一个 `atomic()` 不能包住网络的恰好一次。

建议研究阶段只冻结故障注入矩阵：

| 失败点 | 需要证明的行为（NOT_RUN） |
|---|---|
| `createRun` 后、`process` 前 | 重启/合法入口不会出现无法解释的 queued 状态，也不擅自执行 |
| `transitionRun('blocked')` 后、`updateCard` 前 | 可检查/修复 run 与 card 展示不一致，不改变用户授权 |
| `transitionRun('completed')` 后、`addEvidence` 前 | **完成但缺证据**不能被显示成已验证；检查恢复范围是否覆盖 |
| 外部请求已发出但 receipt 更新前 | 标记 `unknown` 或核对真实目标，不能盲发第二次 |
| 新授权到期/项目取消，在 Effect 等待期间 | 实际派发前重验权限；不会用旧 Mandate 无限制继续执行 |

## E. R8/R9 之外最值得学的五个系统工程习惯

1. **Freeze invariant, not architecture name**：先决定 “Subscription 只传上下文不授新权” 这种不变量，后决定是否需要真正的 Subscription 表。
2. **Derive read model from facts**：状态 UI 用纯分类器读取已提交事实，而不是各路由各自推断“已完成/还在运行”。
3. **Every side effect gets a disposition**：source event、模型推断、拒绝、任务队列、送达和实际展示各有稳定可追踪的去向，不把“没有新卡”冒充“没有事件”。
4. **Separate owner by domain**：Engine/Store/Source/Outbox 分工明确，事务更可测；Hearth 当前已有 Observer→Insight→Analysis 分域，**无需合并成单体 Engine**。
5. **Use uncertainty as explicit state**：`unavailable`, `blocked`, `outcome_unknown`, `stale` 都是严肃语义；无法证明成功时，不应为了火焰或产品“有灵魂”做强行成功叙事。

## F. 对 Hearth 核心灵魂的硬约束

最根本的产品承诺不变：

- Hearth 不是开着许多 Coding Session 的工单墙，而是“项目的长期同行者”。**中央炉心 + 对话驱动 + 项目故事**，UI 可以低调但证据要可展开。
- Agent 应能**主动发现有用信息、形成意见、记住用户目标、修订自己观点、知道该沉默**，而非为了活跃度频繁刷存在感。
- 自动化的观察、受限公开研究和模型推理均受各自明确授权；**实际写代码、运行项目测试、提交/PR、外部第三方写入**在 Hearth MVP 内不能由“模型觉得风险低”自动发生；仍由用户对具体方案明确发起。
- `HearthViewModel` 是**唯一呈现契约**，不是整个数据库的唯一真实状态来源。原始证据归各 Source，用户决定归用户，OpinionRevision 归认知层，执行和部署状态不反写 Project/Flame 的真实因果。
- 语义 Watchdog 最多提出 challenge/withhold/needs_review，不可修改它审查的授权策略、Goal 或私有文件；事实新鲜度先用确定性监控。
- 对 Context Runtime：先通过真实 compaction 前后请求与 fact-loss Gate；DeepSeek 的 LRU/引用分页不是直接可复现的长期记忆保持率提升。

## G. 接下来如何收敛，而不是研究到无穷大？

**本次 R10 不是工程许可。** 现在不宜再反复“比较某个概念有没有”，而应把底层架构原理落成一份**可执行但暂不执行的实验合同**：

| 工作块 | 研究产物（非代码） | 正确性门槛 |
|---|---|---|
| R11-1 · G1-A 安全语义与恢复覆盖 | 入口矩阵 + pre-effect mode/policy gate + crash points | 在真实模式拒执行；恢复不重新执行；完成缺证据不冒充成功 |
| R11-2 · 对话/项目心智与克制 | `candidate → eligibility → claim → presented → feedback` 的纯函数契约 | 正反例覆盖跨项目、24h vs 自然日、stale、用户输入、重复呈现 |
| R11-3 · 证据/权限/工作集 | 必要时单独定义 SourceRef 读取边界 | 来源不能越权，新证据与目标绑定；不自动扩展文件续读 |
| R11-4 · Decision Trace | 低敏来源/拒绝理由的保留与删除合同 | 无正文/绝对路径/秘密，能追溯“为何没提醒”且可清理 |
| R11-5 · 原型实验选择 | 离线纯函数（先验证注意力准入）还是小型调度/恢复实验 | 不同问题选不同实验；避免用一个 PoC 声称全部机制 PASS |

**推荐顺序**：先 R11-1/R11-2 冻结行为，再由用户单独批准合成数据 PoC；正式产品接入之前完成 G1-A 安全验收和真实 H1 价值测试。研究已足够开始尝试证明一个小假设，但**不足以为自动 Coding Worker 或高权限 Watchdog 背书**。

## H. 本次修正账本

| ID | 对照来源 | 新裁决 |
|---|---|---|
| R10-C01 | R8 §0/§2.4/M6：生成列未实现 | **RETRACT**：`SETS → addColumns() → partial indexes → active() queries` 已在源码 |
| R10-C02 | R8 时钟“外部驱动的单一时钟” | **QUALIFY**：Engine 单步入口确实存在；Passes 仍有真实 `setInterval` |
| R10-C03 | R8 类型角色接口 | **QUALIFY**：编译期约束而非 OS/HTTP 级安全边界 |
| R10-C04 | R8 过滤记录只存拒绝去向 | **QUALIFY**：Disposition 很小，但 DeepSeek 同时持久化了 filtered Trigger 本文 |
| R10-C05 | R9 恢复自愈预测 | **NOT PROVEN**：`recoverInterrupted` 不扫描 completed/blocked，故有覆盖缺口的具体反例 |
| R10-C06 | R9 "Engine 永不执行" | **QUALIFY**：Engine 在事务中可调用 port 以入队；实际 IO 在提交后发生 |
| R10-C07 | R9 门禁位置 | **KEEP**：模式门禁必须覆盖实际出站/执行入口；不能仅 UI/route，且不得依赖 Prompt |
| R10-C08 | R9 “统一入口” | **REFINE**：共享权限判断和状态转换，恢复与开始执行不能共用会导致重跑的动作入口 |
| R10-C09 | R8 JSON Store 无工程价值 | **REFINE**：JSON 存储不必照搬，但生成列派生“活跃集合”的思想值得基准评测 |

**研究状态：`RESEARCH_CORRECTED / IMPLEMENTATION_HOLD / G1-A_BLOCKED / H1_VALUE_NOT_MEASURED`。**
