# R9 · 执行与恢复路径的代码级对照：命令式流水线的三处结构性差异

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**
> 承接 [R8 源码级迁移分析](./2026-11-01-dsh-superagent-r8-source-level-migration.md)。这一轮只看一件事：**"决定执行"和"执行"在两边是不是同一个东西。**
> 基线：`dsh-superagent-prototype@6337fc8`（`src/core/engine.ts`、`src/core/assignments.ts`）；Hearth `e470436`（`packages/core/src/orchestration/{orchestrator,executor}.ts`、`packages/storage/src/storage.ts`）。
> 本文不提出实现方案，只做结构对照；凡涉及运行时后果的，一律标 `UNVERIFIED`。

---

## 0. 为什么单独拉出这一轮

PR #12 的三条 P0 里，H-P0-03 是"旧卡片执行/审批 API 仍调用 Orchestrator"。前几轮的处置建议是"在真实/未知模式下服务端拒绝"。R8 之后我意识到这个建议**不完整**：如果拒绝检查加在路由层，而 `process()` 自己也会把 run 推进到 `executing`，那么只要有任何一条路径能让 run 进入 `queued`，后续就绕过了路由层。

要判断这件事，必须看 `orchestrator.ts` 的实际结构。看完之后，差异比预想的更根本。

---

## 1. 三种结构性差异

### 1.1 原型：Engine 从不执行，Executor 只上报事实

`engine.ts` 的 25 个方法全部是**同步的领域变更**，包在 `repo.atomic()` 里（`:48`、`:55`、`:100`、`:174-247`……）。没有任何一个方法启动子进程、等待 I/O 或跑流水线。

执行由外部组件完成，它只把**事实**回传：

| 事实方法 | 语义 | 位置 |
|---|---|---|
| `assignmentStarted(ticketId, assignmentId)` | 一个 Assignment 开始运行 | `engine.ts:174` |
| `inputsDelivered(...)` | 输入已送达该 Assignment | `:181` |
| `inputsRead(ticketId, inputIds)` | worker 的 Session 把消息读进了某一步 | `:189` |
| `turnEnded(...)` | 一轮结束 | `:193` |
| `deliveryFailed(...)` | 投递失败 | `:197` |
| `report(ticketId, report)` | 状态报告（7 种） | `:239` |
| `assignmentInterrupted(...)` | 宿主停机时的在途 Assignment | `:245` |

**关键性质**：Engine 不知道"怎么执行"，只接受"发生了什么"。状态由 `stage.ts` 从这些事实推导（R8 §2.2）。执行失败、进程崩溃、宿主重启，都只是**事实的缺失或异常值**，不需要 Engine 写补偿逻辑。

### 1.2 Hearth：一个 110 行的 async 流水线同时做决定与执行

`orchestrator.ts:69-121` 的 `executeCard` 做完校验后：

```ts
const pipeline = this.process(run, card, principal);
if (opts.awaitCompletion) await pipeline;
else void pipeline.catch((err) => this.deps.storage.audit('run.pipeline_error', 'system', run.id, { error: String(err) }));
return { run: storage.getRun(run.id) ?? run, alreadyRunning: false, card };
```

`process()`（`:215` 起）依次做：**重新读策略 → 判定 deny/await_approval → 转 `executing` → 调 executor → 验证**。

也就是说：**准入判定发生在流水线内部**（`:220-243`），而不是在入口。`executeCard` 本身没有任何模式检查——它只检查卡片是否存在、是否过期、是否已完成、是否已有在跑的 run。

这解释了为什么 H-P0-02/03 不能靠"隐藏 UI"关闭：**门禁在 `process()` 里，不在调用边界上**。任何能让 `createRun` 成功执行到 `queued` 的调用方，都会继续进入 `process()`。

值得肯定的一点：`process()` 的策略判定是**从 DB 重新读取**的，注释写着「never trust the request」（`:220`），这与原型"模型/提示词不能授予权限"同向，是已有正确设计。

### 1.3 门禁是**能力式**的，不是**模式式**的

`process()` 调 `evaluatePolicy(spec, ctx)`，ctx 里给的是 `allowedProjectIds`、`grants`、`actualSourceVersion`、`demoArtifactRoot`——**没有 `demoMode`**。

于是"真实模式必须拒绝"这件事，在现有策略层**没有表达位置**：`evaluatePolicy` 判断的是"这个动作在当前授权下能不能做"，不是"当前进程是否允许做任何真实执行"。后者是**运行模式**，属于配置层，不属于授权层。

这不是缺陷陈述，而是一个结构事实：**要让"真实/未知模式拒绝"真正生效，检查点必须落在所有路径的共同上游**（`executeCard` 入口与 `recoverInterrupted`），而 `evaluatePolicy` 不适合承担这个职责。

---

## 2. 双聚合写入：一处需要验证的窗口

`process()` 在多处成对写两个聚合：

```ts
storage.transitionRun(run.id, 'blocked', {...}, { actor: principal });   // 事务 A
storage.updateCard(card.id, { status: 'blocked' });                      // 事务 B
```

`transitionRun` 内部自带 `BEGIN/COMMIT`（`storage.ts:68` 的文件注释与 `:351` 的实现），而 `updateCard` 是独立的预编译语句。**两次写入不在同一事务内。**

原型对照：`Engine` 的每个方法把"决策 + 副作用入队"放在同一个 `atomic()` 里（如 `receive` 里"存 trigger + 存 disposition + 入 Input"是同一事务）。

**后果需要验证，不能直接判定为缺陷**：

- 若进程在 A 与 B 之间崩溃，`run.state` 与 `card.status` 会不一致；
- 但 `executeCard` 的幂等短路读的是 **run**（`getRunByCard`），不是 card，所以"不一致导致重复执行"未必成立；
- 具体哪一对写入的窗口会导致用户可见的错误，**本轮未验证，标 `UNVERIFIED`**。

要确认它，最小成本的做法是故障注入：在 `updateCard` 前抛错，重启后看 `recoverInterrupted` 是否能把两者重新对齐——`recoverInterrupted` 里确实同时改 run 和 card（`:204`、`:208`），所以很可能自愈。

**本轮结论只到"窗口存在"**，不下"必须修"的结论。

---

## 3. 恢复路径的语义差异

`recoverInterrupted()`（`:179-213`）在启动时对 `executing` / `verifying` 的 run：读 action 快照 → 用 `IndependentVerifier` 重算产物 → pass 则推进到 `completed`，否则落到 `pending_verification`。

三处值得记的差异：

1. **恢复靠"重算证据"，不靠"重放动作"**。这是对的方向——原型也是"recovery note 让 Executor 自己检查目录与 git 历史"，而不是重跑命令。
2. **恢复会修改卡片状态**（`:209`），即恢复路径也在写第二个聚合，与 §2 同一类窗口。
3. **快照缺失时落到 `pending_verification` + `failureClass:'unknown'`**（`:186`），保留了不确定性；这与原型"未确认外发记 `outcome_unknown`"同源，是对的。

---

## 4. 对 G1-A 的结构性含义（研究，不是方案）

三条可以带进 G1-A 评审讨论的判断：

| # | 判断 | 依据 |
|---|---|---|
| A1 | 模式门禁必须**在 `executeCard` 与 `recoverInterrupted` 的入口**，不能只在路由层 | `process()` 在流水线内部，路由层拦截不到已入队的 run（§1.2） |
| A2 | 模式门禁**不适合塞进 `evaluatePolicy`** | 现有 ctx 无 `demoMode`；把运行模式混进授权判定，会让"授权正确但模式不允许"和"模式允许但未授权"两种拒绝无法区分（§1.3） |
| A3 | 两条写入路径（执行、恢复）应共用**同一个入口函数** | 现在两者各自 `transitionRun` + `updateCard`，是两处独立的双写窗口（§2、§3） |

三条都不涉及"要不要执行"的产品决策，只描述"检查点该在哪"。

---

## 5. 与原型可迁移性的边界

| 原型的做法 | 能否迁移 | 原因 |
|---|---|---|
| Engine 不含执行，只有事实方法 | **可借鉴形状，不可整体移植** | Hearth 的 executor 是 Mock/Verifier 一体的本地实现，改成"外部上报"要重构 Run 状态机；收益是崩溃语义更干净 |
| `atomic()` 包裹每个领域变更 | **可借鉴** | 与 §2 的窗口直接对应；但需要先确认 `transitionRun` 与 `updateCard` 能否合并 |
| `assignmentInterrupted` 这种"宿主停机事实" | **可借鉴** | Hearth 的 `recoverInterrupted` 已经在做同一件事，只是以"扫描 + 推断"而非"收到事实"的方式 |
| 7 种 report 状态机 | **不适用** | Hearth 的 Run 只有 6 态，且没有"等人回答"这一维；引入等于新造领域对象 |

---

## 6. 证据等级

- **SRC（本轮亲读）**：`orchestrator.ts:62-121,179-258`；`engine.ts:48,55,100,174-247`；`stage.ts:9-21`；`storage.ts:68,351`。
- **UNVERIFIED**：双写窗口的实际后果（需故障注入）；`recoverInterrupted` 是否总能自愈；任何运行时行为。
- **不改变**：G1-A 仍 BLOCKED；本文不提出实现，也不构成实施授权。

---

## 7. 结论

这一轮没有发现新机制，只把一句粗略的建议("真实模式服务端拒绝")拆成了三个可评审的结构判断：**门禁位置（A1）、职责归属（A2）、入口唯一性（A3）**。

原型的价值在这一轮特别清楚：**它把"决定"和"执行"放在两个不同的组件里**，所以"谁能开始执行"永远只有一个答案。Hearth 把两者放进同一条 async 流水线，代码更短，但把"门禁在哪"变成了一个需要在每个调用点重新回答的问题。

这不是优劣判断——是**缺陷半径**的判断：一处漏拦，原型里是"没人调用它"，Hearth 里是"任何能入队的人"。
