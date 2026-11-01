# DeepSeek Super-agent 完整架构复核与 PR#12 审查补遗

> 复核日期：2026-11-01（Asia/Shanghai）
> 被复核对象：PR [#12](https://github.com/EchoTouch-moon/hark/pull/12)（`ef036a9`，base `e470436`）的三份审查文档
> 上游基线：`deepseek-ai/dsh-superagent-prototype` @ [`6337fc8`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e)，**本地全量检出**：`src/` 12,390 行 TypeScript、`docs/000–008` 共 9 篇设计文档、`prompts/` 17 篇、`tests/` 全部用例
> Hearth 基线：`bot/hearth-g0-contract` @ `e470436`（已核对远端分支头与本审查基线一致）

**总判定**：PR#12 的方向判断（CONDITIONAL_ADOPT、先堵旧入口再谈主动性）**成立**，对 D01–D12 的事实核对**基本准确**，对 Hearth 侧三条 P0 **代码定位无误**。
但它存在三类实质缺口：

1. **机制层覆盖不足**——借走了「影子模式」这个结论，却没有借走让影子模式成立的机制；
2. **写路径治理缺项**——原型唯一能改变生产代码的通道（合并 PR）完全未被审查；
3. **两处证据定位偏差**——一条既有豁免被描述成「疑似缺失」，一条「无条件写入」被弱化成「可能写入」。

本文件是**补遗，不是替代**：原三份文档的结论与 DEC-01..10 不因此撤销，只在第 8 节给出增量修订。本次仍为**静态复核**，未运行原型、未授权任何真实调用。

---

## 0. 复核方法

- 全量克隆上游并逐个文件阅读，**不依赖 PR#12 的引用路径**，以免继承其取样偏差；
- 对 PR#12 的每一条 DeepSeek 事实性断言回到源码复核；
- 对 PR#12 的每一条 Hearth 断言回到 `e470436` 的源码行复核；
- 严格区分三种陈述：「源码事实」「审查表述偏差」「运行时未验证」。

上游共 **100+ 源文件**；PR#12 §范围声明覆盖 9 个源文件（`core/{intake,evals,tickets,model,replies}`、`app/{effects,outbox,cache}`、`policy.ts`、`executor/dsh.ts`）。以下复核显示：未覆盖的那些文件恰是安全与可靠性机制所在处。

---

## 1. 先确认 PR#12 说对的部分

不做无差别否定。逐条核对结果：

| 断言 | 复核 | 证据 |
|---|---|---|
| D01 Source→Trigger→Thread/Eval→Mandate→Ticket→Assignment | **准确** | `docs/001-domain.md` §Flow、§Concepts |
| D02 `off/observe(default)/auto`，推断准入需在规则内 | **准确** | `docs/002-authorization.md` §Accept mode and rules；`src/policy.ts` `admitsInferred` |
| D03 Subscription 只送上下文、不授新权 | **准确** | `docs/001-domain.md` §Concepts「Subscription」；§Rejected concepts「Admission checks on Subscriptions」 |
| D04 Mandate 绑 scope/strength/policyVersion，策略变更不即时撤销 | **准确** | `docs/002-authorization.md` §Policy version |
| D05 Ticket 独立于 Executor Session、可重启续做 | **准确** | `docs/003-execution.md` §Restart、§Stored work |
| D06 事务入队/重试/回执/排序；exactly-once 依赖通道 | **准确但不完整**（见 §4） | `src/app/effects.ts`、`src/app/outbox.ts` |
| D07 Worker 以操作者 OS 用户执行、无需逐条审批 | **准确** | `docs/003-execution.md` §The Executor；`docs/006-deployment.md` §Permissions and isolation |
| D08 提示词不能替代 host 强制检查 | **准确** | `docs/004-prompts.md` §Assembly and precedence |
| D09 「现在有事需要人吗」的注意力优先 | **准确** | `docs/000-philosophy.md`；`docs/005-panel.md` §Three questions |
| D10 工具按资源 ID 分页；`TextCache` 只是受限 LRU | **准确，且这一条很关键** | `src/app/cache.ts` 全文确为按 UTF-16 计量的 LRU |
| D11 单仓 GitHub、可选飞书、依赖 DSH | **准确** | `README.md`、`docs/006-deployment.md` §Prerequisites |
| E19/E20 未运行原型、未做动态验证 | **诚实** | 本次同样未运行 |

**特别值得肯定的一条**：PR#12 明确拒绝把文章里的 Inline & Spill / Chain of Recall / Watchdog 当作公开版已实现的事实。我做了全仓检索：

```
grep -rin "watchdog|inline.*spill|chain of recall" --include=*.ts --include=*.md .
（无命中）
```

这条防线是对的，而且**是本次审查最有价值的判断之一**——它挡住了一个很容易发生的过度推断。后文所有补遗都不推翻它。

---

## 2. 补遗一（最重要）：审查借走了「影子模式」的结论，没借走让它成立的机制

PR#12 的 DEC-02 写「默认 `observe` **ADOPT**」，DS-H-05 写「S1 shadow admission 最小 schema」。方向对，但**可实施性不足**，因为原型的安全性并不来自「有一个 observe 模式」，而来自下面这条三段式链路。三者缺一，`observe` 就只是个开关。

### 2.1 第一段：Gate 是纯确定性函数，先于任何模型调用

`src/policy.ts` 的 `settingsPolicy(...).gate(trigger, thread, tickets)` 是一个**同步、无 I/O、无模型**的函数，返回 `{admissible, strength, basis}`：

- `strength` 只有 `explicit` / `inferred`；
- `basis.via` 只有四个值：`addressed` / `followup` / `admission` / `bot`；
- 机器来源（bot、CI）走独立的 `machineGate`：未列入 bot 表的一律 `not_human`；有 `actor.id` 但不在 bot 表 → 拒绝。

**含义**：一条消息能不能变成请求，在消耗任何模型 token 之前就已经由代码定死了。这与 Hearth 的「规则先行」同源，**但 Hearth 目前没有把「准入强度」做成持久字段**。

### 2.2 第二段：Assessment 的结构化约束比「让模型判断」强得多

`assessmentOutcome`（`src/policy.ts`）不是「解析模型输出」，而是一组硬校验：

- `rule_assessments` **必须覆盖每一条启用规则、且各一次**，否则抛错（`docs/002-authorization.md` §Accept mode and rules 原文：*"Each assessment judges every enabled rule exactly once, whether it matches or not."*）；
- 接受必须同时满足：`direction` 已定（`implementation_requested === true`、`target_basis !== 'undetermined'`、`requires_design_decision === false`）、**至少一条匹配的启用规则**、且带 `intent_evidence`；
- 只有在 `auto` 模式下，`inferred` 才可能被接受；其余情形一律落成 **`would_accept` 的 ignore 记录**。

**含义**：模型没有「接受」这个动作，它只能提交结构化的证据；接受是 host 根据证据算出来的。这正是 Hearth 合同里「LLM 输出不能成为授权来源」的实现形态——**PR#12 引用了这条不变式（D08），却没有看到它在代码里是怎么被强制执行的**。

### 2.3 第三段：Admission table 是结构化数据，不是提示词

`src/admission.ts` + `docs/002-authorization.md` §Admission：每个 Source 一张表，行是接收范围（GitHub 的 issues/pulls/comments/ci、飞书的各个群/direct/other），每行**最多三个格子**：

| 格子 | 取值 | 默认 |
|---|---|---|
| 在名单内、未点名 | `inferred` / `ignore` | `inferred` |
| 不在名单、点了名 | `explicit` / `inferred` / `ignore` | `ignore` |
| 不在名单、未点名 | `inferred` / `ignore` | `ignore` |

而「未点名的消息」这一行只有在 Source 确实接收全部消息时才可用；CI 结果没有 sender，只开放第三格。

**含义**：这是把「谁在什么场合说什么话能开工」变成**可审计的二维表**，而不是一段自然语言规则。Hearth 的 G0 合同目前是「四类权限分离」，粒度尚不到「按来源 × 成员身份 × 是否点名」这一层。

### 2.4 对 DS-H-05 的具体增补

PR#12 提议的 `AdmissionDecision{candidateId, projectId, triggerRefs, ruleVersion, kind, disposition, reason, createdAt}` 只解决了**记录**，没解决**判定**。建议改为三段式最小形状：

```ts
// 1) 确定性准入（无模型、无 I/O、可纯函数测试）
type AdmissionStrength = 'explicit' | 'inferred' | 'not_admitted';
type AdmissionBasis = { via: 'addressed'|'followup'|'table'|'machine'; scope: string; sender?: string; cell?: string };

// 2) 结构化评估（模型只能填证据，不能填结论）
type RuleAssessment = { ruleId: string; matched: boolean; reason: string };  // 必须覆盖每条启用规则

// 3) host 换算（唯一能产出 accept 的地方；非 auto 一律降级为 would_accept）
type Disposition = 'ignored' | 'would_research' | 'research' | 'blocked';
```

**验收负例**（PR#12 未列）：漏评一条规则必须被拒；`intent_evidence` 缺失必须被拒；`off` 模式下任何 inferred 必须不产生候选；`would_accept` 记录**不得**携带执行 token。

---

## 3. 补遗二：遗漏了自动化写路径的真实治理形态（合并）

这是本次复核里**最应该补进安全章节**的一条。PR#12 的 D01–D12 里，「merge」「auto-merge」**零次出现**。

原型唯一能把改动落到生产代码的动作是**合并 PR**，而这条路径的治理是这样的（`docs/003-execution.md` §Merging）：

> *"Auto-merge is governed by the **Delivery requirements** prompt. The host has no merge-specific decision logic."*

三条具体事实：

1. **默认禁止**：「By default, the Executor never enables auto-merge as the agent account」——因为 GitHub 会把合并记在开启者名下；
2. **阈值写在提示词里**：`src/app/context.ts` 的 `autoMergeThreshold(lines)` 生成 *"it changes fewer than ${lines} lines (additions plus deletions)"*，默认 200 行；
3. **文档自己承认这不是强制**：「These instructions govern the agent, not GitHub's merge rules. To enforce approvals, require them in branch protection and dismiss stale approvals.」

**为什么必须写进审查**：

- 对一个**会写生产代码**的 agent，合并是最高后果的动作，其唯一约束是自然语言提示词 + 仓库外部设置。这是典型的 **prompt-as-policy 反模式**；
- 它与 Hearth 的合同**正面冲突**：Hearth 要求「提示词不授予权限、执行需持久化批准记录并执行前二次校验」，而这里恰恰是「提示词就是权限」；
- 若不记录，后续有人照搬「DeepSeek 用提示词管合并，我们也用提示词管发布」，就会在 Hearth 的威胁模型下开一个大洞。

**建议**：在 DEC 表中新增一条 **DEC-11（prompt-as-policy 作为反例，REJECT）**，并把「合并/发布类动作的授权必须在代码与持久批准记录里，不得落在提示词」写成 G1 之后的显式红线。

---

## 4. 补遗三：可靠性机制只写到「重试」，不足以指导实现

PR#12 的 D06 概括为「事务入队、重试、出站 receipt、每 Ticket/会话内排序」。这些都对，但**粒度太粗，Hearth 无法据此写出合同**。原型真正的可靠性骨架是四层，逐层各有硬语义：

### 4.1 Effects：持久副作用队列

`src/app/effects.ts`（`docs/007-architecture.md` §Effects）：

- **按 `kind + key` 合并**：同一 key 的等待中任务，新 payload 替换旧 payload 并立即到期，**但不改变队列顺序**；
- **每类独立并发**：`assessment` 4、`delivery` 4、`relay` 1、`notice` 1、`reply` 1；
- **`Later` 不算失败**：拿不到 worker slot 时延后而不计一次失败——这条是「排队」与「故障」分开的关键；
- **每类一条 health 条目**；`delivery` 的失败不上报到 health，而是挂在 Ticket 上（因为它是单 Ticket 的事实）。

### 4.2 Outbox：回执与顺序

`src/app/outbox.ts` + Store 的 `receipts`：

- 状态只有 `pending / sent / dropped`；**`dropped` 必带时间与原因**（`channelGone` 或 `channelIgnored`）；
- **同一 Ticket + 同一会话内保序**：`behind` 判定「同目标有更早的、失败次数 < 3 的消息在等」；
- 一个 id 永不重复入队；
- dropped 的确认消息读作「dropped」，**不得显示为 sent**。

### 4.3 Worker slots 与后台工作上限

`docs/003-execution.md` §Concurrency / §Background work：

- 并发上限 `maxWorkers`，**另加 1 个 slot 专供人工消息**，且人工唤醒优先于新任务启动——保证「人不会被机器排队挡住」；
- 前台命令 5 秒转后台（router/worker preset），作业等待上限 5 秒；主 Session 的 `noWait` guard 直接拒绝 `sleep`、>30 秒的 shell 超时、>5 秒的 job 等待（理由：**阻塞的一步会推迟所有新候选**）；
- 每轮结束后后台工作最多 30 分钟，超时杀 shell job 并如实报告「哪些被杀、哪些子代理仍在跑」。

### 4.4 模型预算重试

`src/app/retry-health.ts`：从会话事件流里识别 `budget_exceeded` / `Budget has been exceeded` 类失败，投影成 `models` health 条目，**不修改重试策略、不写日志**；401/403/429 与 AUTH/RATE_LIMIT 明确**不**算预算耗尽。

**建议**：把 DS-H-06（S2 ResearchJob）的合同从「借鉴 effect/outbox 原则」细化为上表四层；特别是 **`Later`（延后不计失败）**、**每类并发**、**每 Ticket+会话保序**、**人工优先的额外 slot** 这四条，应在 Hearth 的 ResearchJob 里逐条落成可测断言。

---

## 5. 补遗四：D12 的表述弱化了风险，实际比审查写得更宽

PR#12 D12 写：

> 「非原申请人的 Thread 后续消息在**特定情形**可恢复 Ticket，但仍受既有 Mandate 限制」→ **DO NOT COPY**

原文（`docs/002-authorization.md` §Resume and stop）：

> *"An ended Ticket keeps its Mandate. A person's message on one of its own Threads can resume the same work without a new Eval or Decision, **regardless of who sent it**."*

配合 §Revalidation before resume 的第一条：

> *"An **explicit** follow-up Mandate passes."*

**实际语义**：只要这条 Ticket 是**显式**授权产生的（哪怕授权人早已离开），**任何一个人**在它的 Thread 上说句话，就能让它无重新评估地续做。这不是「特定情形」，这是**默认路径**。

而 `docs/001-domain.md` §Rejected concepts 里还明确拒绝了「Executor 声明有人说停」——即「停」必须走 Eval。**开比停容易**，这个不对称在单信任域的代码仓里可接受，在 Hearth 的「多项目 + 私人资料 + 本地优先」场景里不可接受。

**结论不变（仍然 REJECT）**，但理由要升级：不是「要小心」，而是「该语义与 Hearth 的 Principal 校验要求根本不通约」。建议在 S2 合同里把 resume 写死为：**resume 必须重新校验请求者身份 + 项目绑定 + 当前作用域**，且 resume 的结果不得复用旧的批准记录。

---

## 6. 补遗五：两条 Hearth 证据的定位偏差

Hearth 侧三条 P0 的**代码存在性全部核对无误**，但其中两条的**证据锚点选错或表述偏差**，会直接影响修复方式与优先级判断。

### 6.1 H-P1-05：真正该引用的是一条**显式豁免**，不是路由

PR#12 的静态证据指向 `routes/hearth.ts` 的 PUT 路由「检查 Origin，没有在路由内做独立 CSRF 验证」。实际情况在 `apps/server/src/http/app.ts` 的全局 `preHandler` 里（`e470436`）：

```ts
if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
  // M2 授权写接口只校验同源 Origin，不做 CSRF（见总工裁定）
  const pathOnly = req.url.split('?')[0];
  const skipCsrf = req.method === 'PUT' && pathOnly === '/api/v1/hearth/permissions';
  if (!skipCsrf) { /* 校验 x-csrf-token */ }
  if (req.headers['origin'] === undefined) { /* 403 ORIGIN_REQUIRED */ }
}
```

两点修正：

1. **CSRF 不是全站缺失**，而是对**这一个路径**有意豁免，且**代码注释写明了「见总工裁定」**——性质是「有记录的设计裁定」，不是「漏做」；
2. 同一钩子对**所有**写方法强制要求 `Origin` 头存在（缺失即 403），所以「无 Origin 发送」这条威胁已被覆盖，PR#12 的 S0-05 把它列为待查项属于重复劳动。

**建议**：S0-05 的表述从「需复核是否必须补 token」改为「**复核既有的豁免裁定本身**」——要问的是：在「本机多用户 / 反向代理改写 Origin / DNS rebinding」三种情形下，Origin 是否仍是充分的同源证明；若是，豁免可保留并补一条注释与测试；若不是，撤豁免。

### 6.2 H-P0-01：是**无条件写入**，不是「可能写入」

PR#12 写「并**可能** `appendChat` / `updateThreadProactive` / `touchThread`」。

实际 `routes/threads.ts` 的 `GET /api/v1/threads/:id/proactive`：`ensureThread(id)` 在**第一行无条件执行**；只要走到「有用户消息、未 consumed」分支，三个写入**全部无条件执行**，`buildDemoSuggestion` 兜底还会造一张假卡。所以风险描述应为「**GET 必写**」，这比「可能写」严重一档，也意味着修复不能只加条件判断，而要拆成「读投影 + 显式写命令」。

同一处还有一处 PR#12 未提的事实：`listCards({status:'proposed', limit: 3})` **没有 projectId 参数**，即跨项目聚合；而 `ensureThread(id)` 会为一个不存在的 id 创建线程——**任意 id 都能开出一条新线程**。

### 6.3 H-P0-02：是「标记不一致」，不是「伪造完成」

PR#12 写「把模拟展示表达为真实完成」。原文（`threads.ts`）在 `demo === false` 分支的文案是：

> 「`${action.label}`」已完成（**本拍仍为本地闭环，未接外部执行器**）。

即：`ok: true` + 「已完成」与免责括号**同时存在**。这仍然是缺陷（`parts.result.ok` 与免责声明互相矛盾，且 `runRef` 仍是 `demo-run-`），但性质是**契约/文案不一致**，不是「冒充执行成功」。

**为什么要区分**：修复方式不同。若是「伪造」，需要服务端强制模式隔离 + 拒绝；若是「标记不一致」，只需在契约层把 `ok` 与 `mode` 分开表达，并把 `demo-run-` 改为显式 `mock` 前缀。前者是安全修复，后者是合同修复——PR#12 的 S0-01/02 目前按前者的力度设计，可能造成过度改动。

### 6.4 H-P1-06：证据准确，判断公允

`observe-view.ts` 在 `stale` 时确实仍调 `deriveFlame(story, now)`，只覆盖了 `reason` 文案（`观察已过期：…，暂按旧数据显示。`），并同时暴露 `observationFreshness: 'stale'`。PR#12 把它定为 **TEST GAP** 而非「已出现错误」是准确的，无需修正。

---

## 7. 完整架构图（供后续对照，非审查结论）

把原型的分层写成一张可对照的表，便于判断 Hearth 该借哪一层、不该借哪一层。

| 层 | 组成 | 硬约束 | Hearth 是否已有对应 |
|---|---|---|---|
| **运行形态** | 一个 DSH profile + 插件 bundle；主 Session（router）+ 每 Ticket 一个 Executor Session（worker）+ 每 Ticket 一个目录 | 池化：`maxWorkers` + 1 | 部分（Threads 有，Session/目录隔离无） |
| **领域对象** | Source、Thread、Trigger、Correlation、Channel、Policy、Eval、Mandate、Ticket、Assignment、Subscription | 11 个，拒掉了 Principal/Membership | Project/Insight/Card，缺 Mandate/Assignment |
| **准入** | Gate（确定性）→ Assessment（结构化）→ Decision | 模型不能授权 | 有规则，无 gate/assessment 分离 |
| **授权** | Policy version + strength + basis + admission table + revalidate | 三操作改 Mandate：accept/stop/revoke | 有 ApprovalGrant，无版本化与重验矩阵 |
| **执行** | Assignment → Executor Session；prepare 命令造目录；worker slots | 无逐条审批（Hearth 不接受） | 有 Orchestrator，逐条审批 |
| **交付** | Channel → Outbox（回执+保序）→ Effects | dropped 必带原因 | 有 Run/Evidence，无回执队列 |
| **持久化** | 单 SQLite，单进程锁，schema 只增，generated column 建索引，**每种状态单一写者** | 单写者表见 `docs/007` §Dependency rules | 有 SQLite，无「单写者」约束 |
| **可观测** | HealthBoard：每个部件一条、**只能被声明一次**；4 值退出码 | 一处失败不冒领 | 有 audit，无 health 契约 |
| **提示词** | 8 段固定组装顺序 + 版本化覆盖 + `base` 漂移检测 + 5 级优先级 | 提示词不得改变工具/门禁 | 有 prompt，无版本与漂移检测 |
| **面板** | 三问 → 7 原则 → stage 表即「需要人」的定义 | 健康态不占空间 | 有 UI，无 stage 定义 |

### 7.1 原型自述的两个缺陷，借鉴时不能一起搬

1. **无界增长**（`docs/007-architecture.md` §Persistence 原文）：*"Nothing deletes old records yet, so these grow without bound"*——涉及 `trigger`、`disposition`、`decision`、ended Tickets、outbox receipts、全部 settings/prompt 版本。PR#12 的「工程复杂性」只提了重复建设，**没提数据保留策略**。Hearth 若照搬这套持久化，必须同时给出保留/归档合同。
2. **wrapper 不是安全边界**（`docs/003-execution.md` §Execution variables 原文）：*"These wrappers and directories establish defaults, not a security boundary. A worker can still execute a program by absolute path."* PR#12 D07 的判定是对的，但没引用这句话——它是「为什么不能把 DeepSeek 的 worker 直接接进 Hearth」最有力的原文依据。

### 7.2 值得单独学习的一个设计手法：Rejected concepts 表

`docs/001-domain.md` §Rejected concepts 用一张表列出**被明确拒绝的概念及理由**（Principal、Eval 自调度、等待中的 Eval 状态、每 Thread 单 Ticket、Subscription 上的准入检查、Correlation 路由、Policy 变更取消运行中 Ticket……共 12 条）。

这不是文档装饰：它把「为什么不这么设计」变成可复查的资产。Hearth 的 `docs/mvp/g0/02` 与 `handoff/DECISIONS.md` 值得采用同一形式。

---

## 8. 对 PR#12 的增量修订建议

不推翻原结论，只做最小增量。

### 8.1 DEC 表增补

| 决策 ID | 机制 | 处理 | 理由 |
|---|---|---|---|
| DEC-11 | 提示词作为合并/发布授权（prompt-as-policy） | **REJECT（新）** | 原型唯一的生产写路径靠提示词约束，与 Hearth「提示词不授权威」正面冲突；见 §3 |
| DEC-12 | Gate / Assessment / 结构化换算 三段分离 | **ADOPT（shape）（新）** | 是 DEC-02 影子模式成立的前提；见 §2 |
| DEC-13 | Admission table（范围 × 身份 × 是否点名） | **ADAPT（新）** | 可作为 Hearth 影子候选的判定表，不必引入新领域对象 |
| DEC-14 | 单写者 + HealthBoard 单声明 | **ADOPT（新）** | 与 Hearth 审计要求同向，成本低；见 §7 表 |

### 8.2 任务包增补

| 任务 | 前置 | 交付 | 与既有任务的关系 |
|---|---|---|---|
| DS-H-05a | S0 PASS | 确定性准入函数 + 纯函数测试（无模型、无 I/O） | 拆分自 DS-H-05，**先于**影子日志 |
| DS-H-05b | DS-H-05a | 结构化评估合同（覆盖每条规则、缺一即拒）+ `would_accept` 降级路径 | 同上 |
| DS-H-07（新） | — | 复核 `skipCsrf` 豁免裁定本身：Origin 在三类威胁下是否充分；结论写回 G0-03 | 替换原 S0-05 的表述 |
| DS-H-08（新） | S1 立项后 | ResearchJob 的四层可靠性合同（effects 语义 / outbox 保序 / 人工优先 slot / `Later` 不计失败）+ 保留期策略 | 细化原 DS-H-06 |

### 8.3 证据登记增补（接 E20）

| ID | 类型 | 来源（固定版本） | 支撑的事实 | 未覆盖 |
|---|---|---|---|---|
| E21 | SRC | `src/policy.ts` `gate`/`admitsInferred`/`revalidate` | 准入门禁为纯确定性函数，返回 strength+basis | 未测真实策略组合 |
| E22 | SRC | `src/policy.ts` `assessmentOutcome`、`docs/002` §Accept mode | 评估必须逐条覆盖启用规则，接受需 intent_evidence；非 auto 降级 `would_accept` | 未测模型实际产出偏差率 |
| E23 | SRC | `src/admission.ts`、`docs/002` §Admission | 三格准入表及其默认值、CI 无 sender 特例 | 未测跨 Source 组合 |
| E24 | SRC | `docs/003` §Merging、`src/app/context.ts` `autoMergeThreshold` | 合并仅由提示词约束，host 无合并逻辑；默认不以 agent 账号开 auto-merge | 未验证分支保护实际配置 |
| E25 | SRC | `src/app/effects.ts`、`docs/007` §Effects | kind/key 合并、每类并发、`Later` 不计失败、health 每类一条 | 未压测 |
| E26 | SRC | `src/app/outbox.ts`、`docs/007` §Store | 回执三态、`behind` <3 失败、dropped 带二值原因 | 未对真实通道验证 |
| E27 | SRC | `docs/003` §Concurrency、§Background work | `maxWorkers`+1 人工 slot 且人工优先；30 分钟后台上限；5 秒转后台 | 未测大并发 |
| E28 | SRC | `src/app/retry-health.ts` | 模型预算重试的识别与 health 投影；401/403/429 不计入 | 未对真实 provider 验证 |
| E29 | SRC | `docs/007` §Persistence | 记录无界增长的自述缺陷 | — |
| E30 | SRC | `apps/server/src/http/app.ts`（`e470436`） | `skipCsrf` 是对 `/api/v1/hearth/permissions` 的显式豁免，且全局强制 Origin | 豁免裁定本身待复核 |

---

## 9. 边界与未验证事项

- **未运行**原型（本机无 DSH profile，未装 `@deepseek-ai/dsh`，未授权 `gh`/`lark-cli` 账号）；所有运行时性能、误报率、恢复成功率判断保持 **UNVERIFIED**；
- **未做动态验证** Hearth 侧任何入口（未跑 e2e、未构造跨项目请求）；P0 的「可利用性」仍为静态可达；
- 本文引用的上游行号/章节以 `6337fc8` 与 `e470436` 为准，任一基线前进后必须重新对齐；
- §2 的三段式合同是**形状建议**，不是已评审的实现方案；真正落地需另立任务与授权；
- 本次复核**未改变** G1-A 的安全状态（仍 BLOCKED）、H1 的价值状态（仍 NOT_MEASURED）、以及原审查的 CONDITIONAL_ADOPT 结论。

---

## 10. 一句话结论

PR#12 把「该不该学 DeepSeek」判对了；它没做完的是「**到底学它的哪一层**」。
真正可迁移的是那套让自动化安全成立的**结构**——确定性准入、结构化评估、版本化授权、单写者状态、把副作用先存后做；
真正该引以为戒的是同一份代码里**用提示词当授权**的那条捷径（合并路径）——而这条恰好被漏掉了。
