# R11 · 两组非生产可证伪合同（**v2**）

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**
> 按 [R10 §5](./2026-11-01-dsh-superagent-r10-core-runtime-deep-audit.md) 的方向冻结两组非生产合同；**v2 按 R11 交叉复审（PR 评论，2026-11-01 06:48）的 5 项纠偏重写**。
> 基线：Hearth `e470436`。本轮**零运行、零外发、零代码变更**；所有用例状态 `DESIGNED / NOT_RUN`。
> v1 全文保留在 git 历史（`239dd7c`），本文件为**唯一现行版本**。

## 0. v2 变更表（为什么改）

| # | v1 的问题 | v2 的处理 |
|---|---|---|
| 1 | 「每格统一三条断言」与矩阵自身冲突：Demo 下执行**允许**、real 下恢复**允许核验** | 拆成**四类行为 × 四个维度**，不再全局套用三条（§1.3） |
| 2 | C4 直接标 `FAIL`；且假定"抛异常"能证明崩溃恢复 | 改为 `STATIC_EXPECTED_FAIL / NOT_RUN`；注入分两级，进程内异常**不能**证明重启恢复（§1.1、§1.2） |
| 3 | 把旧 `discovery.ts` 口径与 G0-05 §5 并列成"两种合法合同" | G0-05 §5 是**唯一 Must**；旧口径只能做负对照，不能参与选型（§2.2） |
| 4 | 「全局/项目两视图火焰必须一致」无条件断言 | 只在**同一 project + 同一证据/新鲜度 + 同一权限范围**下比较；全局是聚合态（§1.4） |
| 5 | 漏斗分母含混：`disposition 行数 = N 事件`；`presented` 当已读；`stale` 只剩静默 | 拆 Trigger Disposition 与 Candidate Decision Trace；`presented ≠ read` 且保留 `delivery_uncertain`；`stale` 走"明示未知"通道（§2.1、§2.3、§2.4） |

---

## 1. 组 A：G1-A 门禁与恢复故障矩阵

### 1.1 崩溃点矩阵

`orchestrator.ts`（`e470436`）的写入序：

| 段 | 行 | 动作 |
|---|---|---|
| P1 | `:248` | `transitionRun(→ executing)` |
| P2 | `:250` 起 | `executor.execute(...)` |
| P3 | `:281` | `transitionRun(→ verifying)` |
| P4 | `:287-296` | `transitionRun(→ completed)` ← 先标完成 |
| P5 | `:297` | `addEvidence(...)` ← 后写证据 |
| P6 | `:306` | `updateCard(→ completed)` |

恢复范围：`recoverInterrupted` 只扫 `executing` / `verifying`（`:181`）。

| ID | 崩溃位置 | 崩溃后磁盘状态 | 静态推断 | 状态 |
|---|---|---|---|---|
| C1 | `createRun` 后、`process` 前 | run=queued | `queued ∉ 扫描集` → 不动 | `DESIGNED / NOT_RUN` |
| C2 | `:248` 后、`:250` 前 | run=executing | 扫描命中 → 重算产物 | `DESIGNED / NOT_RUN` |
| C3 | `:281` 后、`:287` 前 | 有产物、verifying | 扫描命中 → 重算 | `DESIGNED / NOT_RUN` |
| **C4** | **`:296` 与 `:297` 之间** | run=completed、**无 evidence 行** | `completed ∉ 扫描集` → 该恢复路径不会修 | **`STATIC_EXPECTED_FAIL / NOT_RUN`** |
| C5 | `:297` 与 `:306` 之间 | run=completed、有 evidence、card 未完成 | 扫描不命中 | `DESIGNED / NOT_RUN` |
| C6 | deny 分支 `:236`-`:242` 之间 | run=blocked、card 未 blocked | 扫描不命中 | `DESIGNED / NOT_RUN` |

**C4 的准确表述**（按复审纠偏）：

- 能**静态证明**的是：`recoverInterrupted` 不扫描该 Run，因此**这一条恢复路径**覆盖不到它；
- **不能**据此断言"整个系统不存在其他修复路径"（人工、未来补丁、启动一致性检查都可能补上），也**不能**在未执行时记 `FAIL`；
- 所以状态是 `STATIC_EXPECTED_FAIL / NOT_RUN`，只有实测失败后才可写 `FAIL`。

### 1.2 注入层级：进程内异常 ≠ 进程崩溃

v1 把"在指定行后抛错"当成可证明崩溃恢复，这是错的：`executeCard` 会捕获后台 rejection 并写审计（`:118` `void pipeline.catch((err) => storage.audit('run.pipeline_error', ...))`），**进程仍活着**，事务与内存状态都还在。

因此分两级，各证不同的事：

| 层级 | 做法 | 能证明 | 不能证明 |
|---|---|---|---|
| **L1 进程内异常** | `storage` / `clock` 替身在指定行后抛错 | 写入顺序、单次调用内的局部状态、失败分支走向 | 重启恢复是否覆盖（进程没死） |
| **L2 子进程强杀** | 独立子进程跑真实 SQLite；事务 **COMMIT 后**强制终止；重开同一 DB | 真实启动恢复路径是否覆盖该中间状态 | 并发/多实例行为 |

**约束**：L2 只允许在隔离的合成 DB 与 Demo artifacts 上跑，不得触碰真实项目目录、不得产生网络调用。

### 1.3 执行/恢复/读取：四类行为 × 四个维度

v1 的"每格三条断言"会把**正确行为判成 FAIL**（Demo 执行本来就该写库；real 恢复本来就该改状态）。改为按行为分类，每类给各自的维度期望：

**维度定义**：`admission`（准入结论）、`executorCallCount`（外部执行器调用次数）、`permittedDbDelta`（**允许**发生哪些写）、`auditSemantics`（审计语义）。

| 类 | 触发组合 | admission | executorCallCount | permittedDbDelta | auditSemantics |
|---|---|---|---|---|---|
| **A1 拒绝** | `real`/`unknown` + `execute`/`approve` | 拒绝 | **0** | **无**（run/steps/evidence/cards 不变） | **恰好一条**拒绝记录，脱敏（无路径/正文） |
| **A2 允许（Demo 闭环）** | `demo` + `execute`/`approve` | 允许 | Mock 执行器可调用（不计入真实执行） | **可写** Mock 专用存储与 demo artifact；**不得**触碰真实项目路径 | **不要求**拒绝记录；允许正常业务审计 |
| **A3 核验恢复** | `real`/`unknown` + `recoverInterrupted` | 允许核验 | **0** | **允许**修正 run/card 状态与证据一致性；**不得**启动新执行、不得重跑命令 | 允许恢复类审计；**不得**记为"拒绝" |
| **A4 纯读** | 任意模式 + `GET /proactive` | 允许或按权限拒绝 | 0 | **无**：不得 INSERT 线程、不得改卡片状态、不得 append 消息 | **不强制**产生拒绝记录（正常读取没有拒绝） |

**关键**：只有 A1 用"四表完全不变 + 一条拒绝审计"这套断言；把它套到 A2/A3/A4 会把正确行为判错。这是 v1 的实质缺陷。

### 1.4 作用域矩阵（修正火焰一致性）

| 场景 | 期望 |
|---|---|
| 只授权项目 A 的线程请求 B 的卡片 | 拒绝；返回体不含 B 的任何标识 |
| 全局 scope 下 `listCards` | 不得跨项目聚合，或必须显式带 projectId |
| 不存在的 thread id 请求 `GET /proactive` | **不得 INSERT 新线程**（今天会） |
| **火焰一致性** | ~~全局视图与项目视图必须完全相等~~ → 改为：**同一 project、同一证据/新鲜度版本、同一权限范围**下，两处投影必须一致；全局 scope 是**聚合态**，允许与任一单项目焰态不同，但必须**明确标注为聚合**，不得偷换成某个单项目的焰态 |

（依据 ADR-06：服务端 `NarrativeState` 是单一投影；G0-05 §3 的 `scope` 区分 global / project。跨 scope 直接比火焰，比的是两个不同的聚合粒度。）

---

## 2. 组 B：心智与克制实验

### 2.1 漏斗与基数口径（先定义分母，再谈比率）

```text
Trigger ──(去重/过滤)──> Trigger Disposition   1 : 1（每个 trigger 恰好一条，含 filtered）
   │
   └──(规则/评估)──> Candidate Decision Trace  1 : 0..N（一个 trigger 可 0 或多候选；多 trigger 可并 1 候选）
                        │
                        ↓ eligibility（服务端可证）
                        ↓ claim（同一时刻仅一条主观点）
                        ↓ presented（客户端回执 + 服务器确认）
                        ↓ feedback
```

**两个必须分开的账单**：

| 账单 | 基数 | 主键 | 用途 |
|---|---|---|---|
| **Trigger Disposition** | 1 个 trigger 1 行 | triggerId | 证明"进来的事件都去了哪"，含被过滤的 |
| **Candidate Decision Trace** | 1 个候选 1 行 | candidateId（+ 幂等键） | 证明"这个候选为什么说起/没说" |

v1 写"disposition 行数 = N 条事件"是把两者混为一谈：若记的是 Trigger Disposition，N 是 trigger 数；若记 Candidate Trace，分母是**去重后的候选数**，必须同时给出去重口径（同一幂等键只记一次、合并候选记一次并标注 `mergedFrom`）。

### 2.2 配额：G0-05 §5 是唯一 Must，旧口径只能做负对照

v1 说"两种口径都实现并等数据选择"，这是错的——它把**遗留实现**抬成了与**已冻结合同**并列的候选。

| | G0-05 §5 第 4 条 | 旧 `discovery.ts:76-79` |
|---|---|---|
| 地位 | **新路径唯一 Must**（同项目 / 过去 24h / 真实呈现 ≤1，数值可配） | **遗留实现**，服务的是卡片体系 |
| 作用 | 实现与验收基准 | **仅作负对照**：若误用于新体系，会产生什么后果 |
| 能否用于选型 | 是 | **否**。合成数据证明不了"哪种更符合用户感受"；若真要改产品约束，须另走真实 H1 评价与用户决议 |

**必测**：23:59→00:01 跨天、项目 A/B 隔离、多设备并发、`claim` 未获（有资格但被别的观点占位）、`presented` 回执丢失。**不得**把"卡片创建"当"呈现"计数。

### 2.3 `presented` 的语义：回执 ≠ 已读

- `presented` = **客户端声明可见 + 服务器确认回执**；
- 显示后 ACK 丢失 → 记 `delivery_uncertain`，**不得**当成"未呈现"重发，也不得当成"已读"；
- 用户是否读过，是**第四态**（`read`），需要单独信号，否则"打扰成本"会被系统性低估。

**"漏报"必须拆成四类**，否则把逻辑失误和展示链故障混在一起：

| 原因 | 含义 | 归属 |
|---|---|---|
| `ineligible` | 资格判定拒绝（无新证据/无目标关联/冷却/配额） | 逻辑层 |
| `not_claimed` | 有资格但没被选中（同一时刻只允许一条主观点） | 选择层 |
| `typing_delay` | 因用户正在输入而延后 | 客户端状态 |
| `delivery_uncertain` | 已 claim 但回执不明 | 展示链 |

### 2.4 `stale` / `epoch reset`：静默 ≠ 明示未知

v1 把 stale 归入"应当静默"，这会让"观察坏了"看起来像"项目没事"。v2 拆成两条通道：

- **主动观点通道**：stale 时新观点可 `withheld`（不推送），这是静默；
- **观察状态通道**：**必须明示**当前无法判断（G0-05 §3 已有 `observationFreshness` 与"暂无法判断"文案规则）。

两者不冲突：一个说"我没有新看法"，另一个说"我不知道现在怎么样"。前者可以安静，后者不能。

### 2.5 隐私：字段白名单，不是内容正则

v1 的"扫描全表无斜杠/无 http"证明力不足——理由码本身可能被用户数据污染（例如把文件名拼进 code）。

v2 改为三条：

1. **字段白名单**：只允许 `projectId` / 受密钥保护的 `candidateHash` / `ruleRefs` / `ruleVersion` / `triggerKind` / `disposition` / `reasonCode` / `decidedAt` / 有界计数；
2. **固定枚举**：`reasonCode` / `disposition` 必须是代码内常量枚举，**不接受自由文本**；
3. **保留策略**：详细 trace 短期 TTL，过期只留聚合计数；项目删除与权限撤销按既有删除协议执行。

正则扫描可以保留为**辅助**断言，但不能作为唯一证据。

### 2.6 六组正反例（更新）

| 组 | 正例（应展示） | 反例（应静默/应拒绝） | 观察点 |
|---|---|---|---|
| N1 新证据 | 出现未呈现过的证据 | 证据与上次相同，仅时间戳变 | 差集口径 |
| N2 目标关联 | 与当前 GoalRevision 有可解释关联，`whyNow` 能写出 | 与目标无关但"看起来重要" | 有无 fake whyNow |
| N3 时效 | 新证据新鲜 | 源 stale / epoch reset | 静默**且**明示未知（§2.4） |
| N4 跨项目 | 只谈 A | A 的候选混入 B 的证据 | 任一字段无 B 的 id/标题/文件名 |
| N5 输入态 | 服务端 eligibility 在输入前后不变 | 以 typing 为由改 eligibility | 客户端状态不得进纯函数 |
| N6 配额 | 24h 内第 1 条 | 第 2 条；跨天边界；A 已用满但 B 未用 | 按 project 计、按 presented 计 |

---

## 3. 顺序决议（采纳复审建议）

**先 B 后 A**：

1. **组 B** 先做首个合成数据、零模型、零网络、零真实项目的离线 PoC —— 它直接检验"有证据、能说明 whyNow、值得开口或克制沉默"这条灵魂；
2. **组 A** 的注入点与矩阵**同步继续设计**，不现在启动执行/恢复重构；
3. 任何真实 API 接入或执行能力暴露前，**G1-A 必须严格通过**；
4. 编码本身仍需**用户明确批准**（本 PR 的研究完成不等于授权）。

---

## 4. 纪律

1. 不运行真实模型、公网检索、真实用户项目、任何执行器；全部合成 fixture。
2. `DESIGNED` / `NOT_RUN` / `STATIC_EXPECTED_FAIL` / `FAIL` / `PASS` 五态，不许用"设计完整"代替结果。
3. 组 A 的 L2 注入属代码改动，需单独授权；未授权前只设计不实现。
4. 组 B 的 fixture 冻结在前、rubric 冻结在后；rubric 变更另开一轮。
5. 两组都不改变 G1-A `BLOCKED` 与 H1 `NOT_MEASURED`。

---

## 5. 证据等级

- **SRC**：`orchestrator.ts:118,181,248,281,287-296,297,306`；`discovery.ts:76-79`；`observe-view.ts:35`；ADR-06；G0-05 §3/§5。
- **CORRECTED BY R10**：生成列存在、`recoverInterrupted` 不能自愈、`Pick<>` 仅编译期、Disposition 上游同存原文。
- **CORRECTED BY R11 复审**：本章 §0 五项。
- **DESIGNED / NOT_RUN**：C1–C6、4 类×4 维门禁、4 条作用域、6 组正反例。
- **UNVERIFIED**：C4 外部可达性与用户可见损害；任何运行时行为；配额口径的用户感受。

---

## 6. 结论

v2 的核心变化不是加了用例，而是**把断言从"一刀切"改成"按行为分类"**——A1 才用"零写 + 一条拒绝"，A2 允许写 Mock，A3 允许修状态，A4 允许纯读。这一步不改，矩阵跑起来会先把正确行为判死。

第二个变化是**承认证明能力的边界**：进程内抛错证明不了进程崩溃，静态行序证明不了全局无修复路径。所以 C4 只能写 `STATIC_EXPECTED_FAIL / NOT_RUN`，等 L2 子进程强杀实测后才配叫 `FAIL`。

状态：`RESEARCH_CORRECTED / IMPLEMENTATION_HOLD / G1-A BLOCKED / H1 NOT_MEASURED`。
