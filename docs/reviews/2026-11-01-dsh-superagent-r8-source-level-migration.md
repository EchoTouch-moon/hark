# R8 · 源码级技术迁移分析：原型实现形态 × Hearth 现有落点

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**
> 本轮换方法：不再从文档推结论，而是**逐文件读两边的源码**，找"可迁移的实现形状"。
> 基线：`deepseek-ai/dsh-superagent-prototype@6337fc8`（本地全量检出，`src/` 12,390 行）；Hearth `e470436`。
> 承接：[R7 机制定稿](./2026-11-01-dsh-superagent-r7-mechanism-contract-freeze.md) 与 R7 的 6 项复核意见（PR 评论，2026-11-01 06:14）。
> 本文所有"代码事实"都带 `file:line`；凡未打开源码核过的，一律标 `UNVERIFIED`。
>
> 🔴 **RETRACTED（2026-11-01，见 [R10 复审](./2026-11-01-dsh-superagent-r10-core-runtime-deep-audit.md)）**
> 本文 §0、§2.4、M6 以及结论里"原型未实现生成列"的判断**是错的，必须撤回**。生成列在 `src/app/store.ts` 里真实存在：
> `SETS`（L30-48）定义 `ticket.open/active`、`thread.active/subscribed`、`outbox.pending/dropped` 的表达式；构造函数（L67-96）在建表后调用 `addColumns()`（L98-119）动态 `ALTER TABLE ... ADD COLUMN` 并建 `WHERE col IS NOT NULL` 部分索引。
> **我的检索失效原因**：SQLite 允许省略 `GENERATED ALWAYS`，代码写的是 `INTEGER AS (...)`；我用 `grep "GENERATED ALWAYS|generated"` 自然零命中。**"搜不到关键词"不等于"不存在"**，尤其当关键词有官方简写时。
> 更正后的判断：**JSON 行体 + 派生生成列/部分索引并存**（详见 R10 §1）。原文保留以留痕，但引用时必须以 R10 为准。

---

## 0. ~~先把同一个错误认领第三次~~ **RETRACTED：这一段本身就是错的**

> 🔴 本节结论（"原型未实现生成列"）已被 [R10 §1](./2026-11-01-dsh-superagent-r10-core-runtime-deep-audit.md) 用源码推翻，见文首横幅。下面保留原文只为留痕。
> 有意思的是：我以为自己在做第三次自我更正，实际上是**第四次犯错**——而且这次的错误类型是"用关键词检索代替读实现"。

这轮我抓到一个新的、指向**我自己**的问题，比前两轮更值得记：

**我上一轮架构对照表里写「单 SQLite，单进程锁，schema 只增，generated column 建索引，每种状态单一写者」——那描述的是 `docs/007` 的愿景，不是代码。**

实际 `src/app/store.ts:70-86` 的建表是**文档式存储**：

```sql
CREATE TABLE IF NOT EXISTS trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ticket  (id TEXT PRIMARY KEY, value TEXT NOT NULL);
...
```

九张表，绝大多数是 `id + JSON value`，只有 `trigger_thread`、`effect` 两张有复合主键的真实列。全仓检索 `open INTEGER` / `active INTEGER` **零命中**；`migration.ts` 里唯一的 `ALTER TABLE` 是 `DROP COLUMN sent`，没有任何 `ADD COLUMN ... GENERATED`。

**结论：公开原型的持久层比它的架构文档简单得多。** `docs/007` 描述的生成列与按集合建索引，在 `6337fc8` 里没有实现。

这是同一种错误的第三次：**把文档当实现**。前两次是（1）把"未实现"读成"未设计"，（2）把 `ensureThread` 的调用当无条件写入。三次的共同教训只有一句：**凡涉及代码，必须引用代码，不能引用描述代码的文字**。本轮起，本文所有结论都按这条办。

**顺带一个对 Hearth 的推论**：不要按 `docs/007` 的 schema 去做设计——那是别人没实现的愿景。若 Hearth 真要"按活跃集合建索引"，那是我们自己的工程决策，不能借"DeepSeek 也这么做"来论证。

---

## 1. R7 六项修订：逐条核实结果

| # | 修订 | 核实 | 结论 |
|---|---|---|---|
| 1 | `isWithinQuietHours` 是夜间静默，不是"用户正在输入"；`dismissalCooldownActive` 是 suppressionKey 的小时冷却，不是 `deferUntil` | 成立。`suppression.ts:82` 判的是 `quietHours` 区间；`suppression.ts:102` 签名是 `(dismissedAt, now, cooldownHours)`，无 per-view 语义 | **接受**，R7「可直接复用」改为「共享时间算术，语义各需重写」 |
| 2 | 24h 每项目呈现 ≠ 自然日全局卡片创建 | 成立。`discovery.ts:76-79`：`listCards({limit:200})` 过滤 `localDayKey(createdAt)===todayKey`，**全局、自然日、最近 200 条窗口** | **接受**，且比修订更严重：200 行窗口会低估，不能作为配额来源 |
| 3 | "新证据/目标关联完全没有"应限定为 FeaturedOpinion 路径 | 成立。`contracts/src/candidate.ts:36,38` 与 `card.ts:59,61` 早有 `whyNow` 与 `evidence: SourceRef[]` | **接受**，改为「字段已有，缺的是**判定**：presented 证据差集、GoalRevision 绑定」 |
| 4 | `USER_TYPING` 不能由服务端纯函数自证 | 成立，且与原型一致：DSH 的 `stage()` 只分类服务端可证事实，焦点类约束留在体验层 | **接受**，拆 eligible / presented / read 三级 |
| 5 | event/topic 两线 ≠ DSH 的 Subscription fan-out | 成立。ADR-05 有条目级 idempotency 与 watermark，但**没有**"活跃任务接收后续事件且不再全局 Eval"的所有权语义 | **接受**，V4 从 `REUSE` 降为 `REUSE 约束 + DEFER 语义` |
| 6 | 截断前缀不等于"拥有 Spill 一半"，不应记为 `C−I` | 成立。G0 无续读 Must，`files.ts` 的契约就是"只读前缀 + 前缀哈希" | **接受**，V5 改为 `DEFER`，`C−I` 标记撤销 |

---

## 2. 原型代码解剖：真正可迁移的五种形状

### 2.1 `engine.ts`：角色化 API（`Pick<>` 子集）

`src/core/engine.ts:261-270`：

```ts
export type EngineForSources     = Pick<Engine, 'receive' | 'bindThread' | 'threadClosed'>
export type EngineForMainSession = Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide' | 'attach' | 'reply' | ...>
export type EngineForPeople      = Pick<Engine, 'stopTicket' | 'retryTicket' | 'reevaluate' | 'unsubscribe' | 'dismiss'>
export type EngineForSettings    = Pick<Engine, 'policyChanged'>
export type EngineForExecutor    = Pick<Engine, 'assignmentStarted' | 'inputsDelivered' | ... >
```

**这不是文档，是类型。** 每个调用方拿到的是引擎的**能力子集**，编译期就调不到别的角色的方法。Source 拿不到 `decide`，Executor 拿不到 `policyChanged`。

Hearth 对应物：`apps/server/src/http/app.ts` 的 `AppDeps` 是一个大包，所有 route 注册函数共享同一份 `deps`；`buildApp` 把 `storage / services / observer / insight / analysis / coordinator` 全量传下去。**运行时无越权，但编译期没有任何"这条路由不该碰这个"的约束。**

### 2.2 `stage.ts`：19 行纯函数分类器

`src/core/stage.ts:9-21` 全文：

```ts
export function ticketStage(ticket: Ticket): TicketStage {
  if (ticket.ended) return { stage: 'ended' }
  if (ticket.delivery) return { stage: 'person', action: 'delivery' }
  if (ticket.attention) return { stage: 'person', action: 'answer' }
  const assignment = latestAssignment(ticket)
  const report = assignment?.report?.state
  if (report === 'ready') return { stage: 'person', action: 'review' }
  if ((report === 'blocked' || report === 'failed') && waitsForPerson(ticket)) return { stage: 'person', action: report }
  if (!assignment || assignment.state === 'pending') return { stage: 'working', action: 'queued' }
  if (report === 'waiting' || assignment.state === 'ended') return { stage: 'idle' }
  return { stage: 'working' }
}
```

三个性质：**只读已存事实**、**无 I/O 无时钟**、**首个命中即返回**。UI 标签由它派生，不另行判断。

Hearth 对应物：`apps/server/src/http/hearth/observe-view.ts:59-128` 的 `buildObserveView`。它也是纯函数，但**状态由控制流决定**（early return 出 `permission_denied` / `error` / `empty` / `ok`），没有一个可枚举的"当前处于哪一段"的对象；`featuredOpinion` 在 `viewBase()`（`:35`）里恒为 `null`，等于"观点这一段"根本没有状态机。

### 2.3 `intake.ts`：每个事件都留一条 disposition

`src/core/intake.ts:26-29`：

```ts
if (!filter.listened) {
  this.repo.triggers.save(trigger); this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], at })
  return 'filtered'
}
```

**被过滤掉的事件也写一行 disposition**，带拒绝原因码。正常路径同样写 `{ fanout, context?, at }`（`:54-55`）。

这条直接回答了我们争论两轮的"被拒绝的候选要不要持久化"——**原型在字段级别已经这么做了**，粒度是"一个事件一行、只存去向与码"。R7 开放问题里我倾向的"短期留存 reason + ruleRefs、不落正文"，与它同构，只是原型没有 TTL。

### 2.4 `store.ts`：JSON 行体 + **派生生成列与部分索引**（RETRACTED 后重写）

> 🔴 本节原判断"文档式存储、生成列不存在"**已撤回**。实际结构是三层：基础表（`id + JSON value`）→ `SETS` 定义生成列表达式（L30-48）→ `addColumns()` 在打开数据库时 `ALTER TABLE ADD COLUMN` 并建 `WHERE col IS NOT NULL` 部分索引（L98-119）。

可迁移的有三处：

1. **活跃工作集索引**：`ticket.open/active`、`thread.active/subscribed` 由 JSON 行体派生，passes 只扫活跃行——这是"状态在 JSON 里、索引在列上"的折中，Hearth 若坚持关系式 schema 则**不需要**它；
2. `effect(kind, key)` 复合主键 + `due/seq` 索引（延后队列的形状）；
3. `trigger_thread(thread, id)` 复合主键（避免重复 fan-out）。

**方法论补记**：`addColumns()` 还会在定义变更时先 `DROP COLUMN` 再重建，说明"schema 只增"这个我先前也写过的说法同样不准确——它对生成列是**可重建**的。

### 2.5 `atomic()` 包裹一切

`engine.ts` 里 25+ 个方法**全部**形如 `return this.repo.atomic(() => this.x.y(...))`。含义：每个领域变更是一次事务，且"决策 + 副作用入队"在同一事务内。

Hearth 对应物：`packages/storage/src/storage.ts` 只有两处 `BEGIN`（`:351`、`:681`，其中一处是 `transitionRun`）。**`executeCard` 跨 `runs / run_steps / evidence / cards` 多表写入是否同事务，本轮未核 —— 标 `UNVERIFIED`**，不据此断言缺陷。

---

## 3. 一个把两边连起来的证据：flaky 测试

`packages/project-insight/src/coordinator.test.ts` 在 CI 上失败过一次（期望 episode 数不变，实际 +2），同一代码重跑通过。

根因不是随机的。看 `packages/project-insight/src/coordinator.ts:14-40`：

- 构造函数依赖只有 `{store, port, projectIds, intervalMs, projectsPerTick}` —— **没有注入时钟**；
- `schedule()` 直接 `setTimeout(...)`，`tick()` 在定时器回调里异步执行并自增 `metrics.ticks`；
- 测试因此只能写 `intervalMs: 20` + `expect.poll()` 等真实时间，断言 `countEpisodes === before` 时，扫描尚未完成的那一拍就会多写 episode。

对照原型：`Engine.evaluateDue()` 是**外部驱动的唯一时间入口**（`engine.ts:75-85`），由宿主调用；状态判断由 `stage.ts` 这类纯函数从已存事实推导。**同一份逻辑在原型里是可注入、可单步执行的，在 Hearth 里是自驱动的定时器。**

这不是"DeepSeek 更先进"，而是**一个具体的设计选择带来的具体后果**：自驱动定时器 → 测试必须依赖真实时间 → CI 负载下抖动。而这恰好也是 R8 要冻的离线实验的前提条件。

---

## 4. 迁移清单 M1–M6

每条给：目标 / 形状 / 改动面 / 风险 / **可证伪验收**。全部 `NOT_STARTED`，且都在 G1-A 之后才谈实现。

### M1 · 协调器注入时钟 + 显式单步（**优先级最高**）

- **目标**：让时间成为参数，而不是环境。
- **形状**：`InsightCoordinator` 增加 `clock?: () => Date` 与 `tickOnce(): Promise<void>`；生产用 `setTimeout` 驱动 `tickOnce`，测试直接调 `tickOnce`。
- **改动面**：`coordinator.ts` 一个类 + 它的测试；不改业务语义。
- **风险**：低。`tickOnce` 重入需显式禁止（现有 `active` 字段已近似该语义）。
- **验收**：把 `coordinator.test.ts` 里所有 `expect.poll` 换成三次 `await tickOnce()`，**测试不再依赖真实时间**；在 CI 上连跑 20 次不出现计数漂移。

### M2 · 呈现判定改成 stage 式纯分类器

- **目标**：把 G0-05 §5 的四门槛从"散在控制流里的 if"变成"可枚举的返回对象"。
- **形状**（对齐 `stage.ts`，且吸收修订 4）：

```ts
type Eligibility =
  | { eligible: true; opinionRevisionId: Id; evidenceDiff: EvidenceId[]; goalRef: Id }
  | { eligible: false; reason: 'NO_NEW_EVIDENCE' | 'NO_GOAL_LINK' | 'COOLDOWN'
            | 'DEFERRED' | 'DAILY_BUDGET' | 'PROJECT_NOT_FOCUSED'; ruleRefs: RuleRef[] };
```

焦点/打字**不进这个函数**（修订 4），它只回答"服务端可证的资格"；`presented` 由客户端回执另记。

- **改动面**：新增一个纯函数包（建议 `packages/core` 或 `packages/hearth-contract` 旁），`observe-view.ts` 改为消费其输出；`featuredOpinion` 从恒定 null 变为"由 Eligibility 决定"。
- **风险**：中。需要先把"已呈现 revision 的证据集合"变成可查状态，否则门槛 1 无法判定。
- **验收**：四门槛各一条否定例 + 一条正例，纯函数级断言；`featuredOpinion` 非空时 `whyNow` 必须与 `goalRef` 同时存在。

### M3 · 候选处置一行一事件

- **目标**：静默可复核，但不留正文。
- **形状**：每次候选判定写一行 `{ projectId, candidateHash, ruleRefs, ruleVersion, triggerKind, disposition, reasonCode, decidedAt }`；不存正文、路径、URL、模型原文。TTL 见 §5。
- **改动面**：新增一张表 + 写入点；`DiscoveryService` 与未来的呈现判定各写一处。
- **风险**：中。`candidateHash` 若输入低熵可被枚举反推（R7 复核意见已提），需受密钥保护的摘要。
- **验收**：给定 N 条事件，`disposition` 行数 = N（含 filtered），且任意一行都不含原文/路径/URL（正则扫描断言）。

### M4 · 路由拿到能力子集

- **目标**：把"这条路由不该碰这个"从评审意见变成编译期约束。
- **形状**：按路由族定义 `Pick<>` 型依赖（如 `PortsForHearth = Pick<AppDeps, 'storage' | 'observer'>`），`registerXRoutes(app, deps: PortsForX)`。
- **改动面**：`apps/server/src/http/routes/*` 的签名 + `app.ts` 组装；纯类型改动，无运行时变化。
- **风险**：低-中。会遇到现有路由确实跨域用依赖的情况，需要先分类再收窄。
- **验收**：类型层面 `registerThreadRoutes` 无法访问 `deps.services.orchestrator`（编译失败即可）；运行时行为零变化（现有测试全绿）。

### M5 · 事务边界显式化（**先核，不先改**）

- **目标**：确认 `executeCard` 的"写 run + 写 step + 写 evidence + 改 card 状态"是否同事务。
- **形状**：仿 `atomic()`，把执行路径的多表写入收进一个显式事务。
- **前置**：**本轮未核实**，需先做一次静态走查（`orchestrator.ts` → `storage.ts` 的调用链），确认是否已由 `transitionRun` 覆盖。
- **验收**：故障注入——在写 evidence 之后抛错，重启后不得出现"run 已完成但无证据"或反之。

### M6 · ~~明确不做：按文档做生成列索引~~ **RETRACTED**

> 🔴 本条基于错误前提（"生成列不存在"），**废除**。原型确实实现了生成列 + 部分索引（见 §2.4 重写与文首横幅）。
>
> 但结论方向仍然保留一半：**Hearth 是否需要活跃集合索引，是独立工程判断**——Hearth 的 schema 是关系式且已有显式状态列，没有 JSON 行体带来的扫描放大问题。所以不是"不能做"，而是"没有从原型得到做它的理由"。

---

## 5. 关于"候选处置是否持久化"：与本轮复核意见的合并结论

R7 的我方倾向、R7 复核建议（14 天 TTL、不记正文）、以及原型的 `disposition` 实现，三者收敛到同一个形状。合并成一条**研究默认**（非工程批准值）：

| 字段 | 存 | 说明 |
|---|---|---|
| `projectId` | ✅ | 保证可按项目删除 |
| 候选稳定标识（受密钥保护摘要） | ✅ | 防低熵枚举反推 |
| `ruleRefs` / `ruleVersion` / `triggerKind` | ✅ | 可解释"凭什么" |
| `disposition` / `reasonCode` / `decidedAt` | ✅ | 可复核"为什么没说" |
| 有界计数（证据差集数、是否有 goalLink） | ✅ | 用于漏斗统计 |
| 候选正文、查询词、绝对路径、URL、来源全文、模型输出 | ❌ | 一律不落 |
| 保留期 | 详细 trace 短期；过期后仅留聚合原因计数 | 具体天数待测，不声称某个值最优 |

与原型唯一的差别是**原型没有 TTL**——这正是我们要补而不是照抄的地方。

---

## 6. 不能迁移的（附理由）

| 项 | 理由 |
|---|---|
| JSON 文档式存储 | Hearth 是关系式 schema，改造收益为零、迁移风险高 |
| `Engine` 那种"一个类装下全部领域变更"的粒度 | Hearth 的域已按包拆分（observer / insight / analysis），合并会破坏现有边界 |
| Subscription fan-out 的所有权语义 | ADR-05 没有等价结构；引入等于新造一个领域对象（R7 修订 5 已裁 DEFER） |
| `danger-full-access` 的 Worker preset | 与产品合同 §4 逐案确认正面冲突 |
| 按 `docs/007` 的 schema 建生成列 | 见 §0，文档未实现 |

---

## 7. 证据等级

- **SRC（本轮亲读，带行号）**：`engine.ts:75-85,261-270`、`stage.ts:9-21`、`intake.ts:26-29,54-55`、`store.ts:70-86`、`migration.ts:158`、`policy.ts`。
- **SRC（Hearth）**：`observe-view.ts:35,59-128`、`coordinator.ts:14-40`、`coordinator.test.ts:19-32`、`discovery.ts:76-79`、`suppression.ts:82,102`、`candidate.ts:36,38`、`card.ts:59,61`、`storage.ts:351,681`、`app.ts`（`AppDeps`）。
- **DOC**：G0-05 §5、ADR-01/02/05、`docs/007`（**注意：与代码有背离**）。
- **UNVERIFIED**：`executeCard` 的事务边界（M5 前置）、任何运行时行为、漏斗率与用户价值。
- **不改变**：G1-A 仍 BLOCKED，H1 仍 NOT_MEASURED，本 PR 仍只增文档。

---

## 8. 结论

这轮的净产出不是"又发现一个机制"，而是**四种可以直接照形状写的实现形态**，以及一个必须先改的前提：

1. **角色化 API**（`Pick<>`）——把越权从"评审意见"变成"编译错误"（**仅编译期，非运行时沙箱**，见 R10 §2）；
2. **19 行纯分类器**（`stage.ts`）——把"当前处于哪一段"变成可枚举对象，Hearth 的 `featuredOpinion` 正缺这个；
3. **一行一事件 disposition**（`intake.ts`）——静默可复核；但注意原型同时保存了原始 Trigger，**Hearth 的差异点应是不存正文**；
4. **核心逻辑与 scheduler 分离**（`evaluateDue`）——注意原型另有 `passes.ts:28` 的 `setInterval(2000)` 驱动，所以是"可单步推进的核心"，不是"全局唯一时钟"。

§0 那条"自我更正"**已被证明是错的**（生成列真实存在），已全文标注 RETRACTED。它留下的真正教训不是"原型比文档简单"，而是：

> **用关键词检索代替读实现，会得出精确而错误的结论。** 关键词有官方简写（SQLite 的 `AS` 省略 `GENERATED ALWAYS`），也有动态构造（`addColumns()` 里的字符串拼接），两种都会让 grep 干净地漏掉。

状态：`RESEARCH_CORRECTED / IMPLEMENTATION_HOLD / H1_NOT_MEASURED`（R10 更正后）。
