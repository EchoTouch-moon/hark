# R7 · 机制与合同差异定稿：八个机制的 REUSE/ADAPT/DEFER/REJECT

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**
> 本轮目标由 [R6 同行复审](./2026-11-01-dsh-superagent-r6-deepseek-feedback-cross-review.md) §4 指定：*"对 8 个机制逐一决定 `REUSE G0 / ADAPT / DEFER / REJECT`，只形成「合同差异清单」，不能新建功能框架。"*
> 基线：DeepSeek `dsh-superagent-prototype@6337fc8`；Hearth `e470436`（G0 合同）与本轮实际源码核查。
> 本文**不新增设计**，只做裁决与取证。凡与前期文档冲突处，以本文的源码证据为准，并保留历史记录不覆盖。

---

## 0. 先纠正我上一轮的两个错误

R6 指出的两处，我复核后**完全接受**，且实际情况比 R6 说的更不利于我的原论证。

### 0.1 「Hearth 的克制只在呈现层」——不成立

我原判断：Hearth 把"少打扰"做成 UI 约束（≤1 卡 ≤2 chip），DeepSeek 做成机制，所以缺口在决策层。

**G0-05 §5「主动呈现判定（价值 vs 打扰）」本身就是服务端判定合同**，四条门槛写得很硬：

1. 至少一条用户此前未见过的新证据（对比该项目已呈现 revision 的证据集合）；
2. 与当前项目已登记目标或决定有可解释关联，`whyNow` 必须写出这条关联；
3. 用户当前未在输入，且该项目在冷却期外；被「稍后再说」的观点到 `deferUntil` 前不再出现；
4. 同一项目 24 小时内主动呈现不超过 1 条（数值可配，默认 1）。

并且 §3 明确「稍后再说后是否重新出现由服务端主动呈现判定（§5）决定，**前端不自行推断**」。

也就是说：**设计早就在决策层了，不在呈现层。** 我的原判断把"合同写得好但没人实现"误读成了"没设计"。这是本轮最该记住的一次错误类型：**把未实现当成未设计**。

### 0.2 「炉心应成为持有全部项目状态的唯一序点」——不成立，且已有替代

G0-05 §3 已经把"唯一呈现入口"定义完了：`HearthViewModel` 是 **Mind → Experience 唯一入口**，且明确"观点历史版本不进 ViewModel""研究关注清单走独立接口"。我要提的"呈现序点"是它的重复设计。

而"唯一持有全部项目状态"更进一步是**错的**：它会把呈现投影与事实权威混为一谈。ADR-01 要求 `ThreadProjectBinding` 多对多并声明 `focusedProjectId`，ADR-02 要求三类证据各自绑定 `projectId` 并**严禁跨项目借用**——一个"全局心智库"恰好是这些合同的否定面。

**接受 R6 的拆法**：事件序点归各 source 自有（Observer `forward_seq` 语义不可被统一 UI 时间戳替代），呈现序点归 `HearthViewModel`。两者都不是新东西。

---

## 1. 本轮真正的新发现：三条，全部有源码证据

R6 说"最大差距是实现/验证"。我按这个方向核了实现，结果比"没实现"更具体，也更有风险。

### 1.1 `featuredOpinion` 是硬编码的 `null`

| 位置 | 代码 |
|---|---|
| `apps/server/src/http/hearth/observe-view.ts:35` | `return { mode: 'real' as const, scope, featuredOpinion: null, permissions: perms };` |
| `apps/server/src/http/routes/hearth.ts:28` | `featuredOpinion: null,` |

合同 `packages/hearth-contract/src/index.ts:55` 定义了完整结构，fixture `ok.json` 里有一条完整的示例观点——**但服务端永远返回 null**。

含义：§5 的四条门槛今天**没有任何执行路径**。`hearth.http.test.ts:125` 甚至把这个 null 断言成了正确行为。所以"主动呈现"目前的状态不是"实现了但没验证"，而是**"合同 + fixture + 断言三者都在，唯独判定函数不存在"**。

### 1.2 §5 四门槛里，两条已有可复用原语，两条完全没有

`packages/core/src/discovery/suppression.ts` 全是纯函数：

| §5 门槛 | 现有原语 | 状态 |
|---|---|---|
| 3. 未在输入 / 冷却期 / `deferUntil` | `isWithinQuietHours`、`dismissalCooldownActive`、`localDayKey` | **可直接复用** |
| 4. 同项目 24h ≤1 条 | `dailyBudgetRemaining`、`localDayKey`（时区安全） | **可直接复用**（但需按 project 分区，现有是全局卡片计数） |
| 1. 未见过的**新证据**（对比已呈现 revision 的证据集合） | 无 | **完全缺失** |
| 2. 与项目目标/决定的可解释关联 + whyNow | 无 | **完全缺失** |

这就是 R7 该给出的那种"不能靠单句『已有/缺失』"的答案：**一半有、一半没有、外面还包着一层 null**。

### 1.3 存在两条并行的呈现控制路径（重复设计风险已经发生）

- **卡片线（M2，已实现）**：`DiscoveryService` + `suppression.ts`，管的是"建议卡"的每日预算/忽略冷却/静默时段，已有测试覆盖。
- **观点线（G0-05 §5，未实现）**：管的是 `featuredOpinion`，四条门槛，`null`。

两条线语义不同（卡片 vs 观点），**但控制变量高度重叠**（冷却、预算、时区、静默）。R6 警告"不要再次起草一套 AttentionPolicy"——这个警告是对的，而且**风险已经以"两套半成品"的形式存在于代码库里**。R7 的决定必须是：观点线**复用** suppression 的三个时间/预算原语，只新增它真正缺的两条（证据差集、目标关联），不新写一套时间逻辑。

### 1.4 附带核实：ADR-01 的绑定完全未实现

全仓检索无 `ThreadProjectBinding`、`focusedProjectId`、`thread_project` 任何命中。`threads` 表只有一个可空的 `project_id` 单列（`ensureThread` 明确写入 `projectId: null`）。

叠加已记录的 H-P0-01（`listCards` 无 projectId 参数、跨项目聚合），结论是：**"跨项目不混用"这条合同，当前代码里零强制**。这不是研究问题，是 G1-A 范围内的问题。

---

## 2. 八个机制的裁决表

**实现状态用四值，避免"合同/代码"二值造成的误判：**

- `C+I` 合同有 + 代码有
- `C−I` **合同有 + 代码无**（最危险：看起来已经具备）
- `N+C` 无合同 + 代码有（重复设计来源）
- `N` 全无

| # | 机制 | 裁决 | 合/代落点 | 实现状态 | 否定例（必须有） | 待测假设 |
|---|---|---|---|---|---|---|
| V1 | 候选→呈现的可验收漏斗 | **ADAPT** | G0-05 §5 + §3 | **C−I**（§5 无判定；`featuredOpinion` 恒 null） | 无新证据仍展示；有新证据但用户正在输入仍打断；同项目 24h 第二条；`deferUntil` 未到就复现 | 漏报率 vs 误报率能否同时达标 |
| V2a | 呈现序点（唯一投影） | **REUSE** | G0-05 §3 `HearthViewModel` | **C+I** | 前端自行推断 `deferUntil`；两个界面同一时刻给出不同火焰结论 | — |
| V2b | 全局事件序点 / 全局真相库 | **REJECT** | ADR-01/02 反向约束 | N | 跨项目借用证据；统一时间戳覆盖 `forward_seq` | — |
| V3 | 准入强度 `explicit/inferred` | **ADAPT**（改名为 `triggerKind` + `ruleRefs/version`） | 新增字段，无现合同 | **N** | 把 `explicit` 当作执行许可；`ruleRefs` 由前端提供 | 用户能否分辨"我要求查的"与"你自己想到的" |
| V4 | 订阅直通（已立项任务收后续事件） | **REUSE ADR-05**，不新建 | ADR-05 event/topic 双线 + idempotency + watermark + 有界并发 | **C±I**（event 线由 `InsightCoordinator` 承担；topic/公开研究线未实现） | 直通让研究越过原 scope；订阅期间的高优先级独立事件被吞 | 减少中枢判定次数是否真减少打扰（原文只证 token，不证注意力） |
| V5 | 引用图 / 按需续读（Chain of Recall） | **DEFER**（研究，不入 MVP） | `files.ts` 已有前缀截断 + `truncated` | **C−I**（有 Spill 一半，无续读入口） | 模型用"再看一段"绕过白名单；续读用陈旧版本；符号链接改向 | 续读带来的判断增益是否抵得上新增授权面 |
| V6 | 批处理候选评估窗口 | **DEFER**（仅假设，不冻结窗口值） | ADR-05 已有最低间隔/周期配置 | **N** | 突发关键事实被窗口延迟；用户显式检查被排队 | 候选到达率与延迟容忍度（未测） |
| V7 | 被动准备（原"投机研究"） | **ADAPT**（改名 + 保留有界拒绝痕迹） | 仅限已授权只读源 | **N** | 丢弃全部未呈现候选 → 无法复核静默；草稿保留无期限私密文本 | 有界 trace 的存储/脱敏成本 |
| V8 | 单卡字数/阅读预算 | **ADAPT**（先做指标，不设硬阈值） | 无现合同 | **N** | 把字数当消息配额开关；用火焰热度调节预算 | 中文有效信息密度与"值得打扰"的相关性 |

**裁决分布**：ADAPT 4 · REUSE 2（其中 V4 为"复用而非新建"）· DEFER 2 · REJECT 1。

**三条最有信息量的 C−I**：V1、V5、以及 V4 的 topic 线。它们共同的特征是**合同/字段/测试都在，唯独判定缺失**——这类缺口最容易被误读成"已完成"，也最容易在评审里被一句"已有"带过。

---

## 3. R6 点名的三项硬前提：核查结果

### 3.1 §5 四门槛如何成为可审计事件，而不是前端一个静默 if？

**当前状态**：连 if 都没有（`featuredOpinion: null`）。

**R7 结论（形状，非实现）**：四条门槛必须是**一个纯函数**的返回值，而不是散落在路由里的判断：

```ts
// 形状建议，不进代码
type PresentationDecision =
  | { present: true; opinionRevisionId: Id; whyNow: string; evidenceDiff: EvidenceId[] }
  | { present: false; reason: 'NO_NEW_EVIDENCE' | 'NO_GOAL_LINK' | 'USER_TYPING'
            | 'COOLDOWN' | 'DEFERRED' | 'DAILY_BUDGET'; ruleRefs: RuleRef[]; decidedAt: ISODate };
```

三个不变量：
1. **`present:false` 也必须返回结构化的拒绝理由**（V7 的另一半）；
2. 判定函数不访问网络、不调模型、不写库——只读快照与设置；
3. 调用方（`observe-view.ts`）不得绕过它自算——这正是 0.1 里 G0-05 §3「前端不自行推断」的服务端对偶。

### 3.2 真相所有权 vs 呈现序点：单线程关联多项目时，如何证实不引用 B？

**当前状态**：无法证实。没有 `ThreadProjectBinding`，`threads.project_id` 是单列可空，`listCards` 跨项目聚合。

**R7 结论**：这个问题在 ADR-01 落地前**不可回答**，因此任何"呈现序点"的研究都必须以 ADR-01 的实现为前置，而不是反过来。研究只能先冻结**否定例**：一条只授权 A 的线程，其 ViewModel 的任何字段（含 `narrative.story[].evidence[]`）都不得出现 B 的 `projectId`/标题/文件名。这个否定例可以现在就用合成数据写成断言，不需要等 ADR-01。

### 3.3 被动准备与 Context Runtime 的读取边界在哪里？撤销如何覆盖在途？

**当前状态**：`files.ts` 的边界是白名单 + 项目根 + 符号链接阻断 + 尺寸/总额度 + 脱敏 + `MAX_FILE_BYTES` 前缀截断 + 前后 stat 一致性校验（`PATH_ESCAPE`）。**没有"续读"路径**，所以"续读越权"目前是零实现、纯假设风险。

**R7 结论**：`passive preparation` 的读取范围**等于**现有 `assembleProjectContext` 的读取范围，**不多一个字节**。任何续读能力（V5）若将来引入，必须复用同一套校验而不是新开一条读取通道；撤销语义则沿用 ADR-04「服务端在每次出站前重新校验」的同构做法——**每次续读前重新校验，而不是启动时校验一次**。

---

## 4. 一页范围：可编码 / 不要编码

### 可进入工程方案（仍需 G1-A 通过 + 用户单独授权）

| 项 | 形态 | 前置 |
|---|---|---|
| P1 | `PresentationDecision` 纯函数（§5 四门槛）+ 拒绝理由 | 复用 suppression 三个原语；补证据差集与目标关联 |
| P2 | `triggerKind` + `ruleRefs/version` 字段落库（不参与授权） | 无 |
| P3 | 候选 → disposition → 单一 ViewModel 的**离线合成切片** | G1-A 完成 |
| P4 | 跨项目否定例断言（合成数据） | 无（可先写测试） |

### 明确不要编码

- 新 Router / Worker 池 / 全局真相库（V2b）
- Chain of Recall 自动续读（V5）、批处理窗口（V6）
- 任何执行入口、任何"静默复现修复"（V7 被拒绝的那一半）
- 字数硬阈值（V8）
- 新写一套时间/预算/冷却逻辑（应复用 suppression）

---

## 5. 交给 R8 的东西

R8 只需处理"最小前置样本 + 判定口径"，**不要把 R4 的 34 项全部变成 MVP 阻塞项**。建议收敛为 8 组、每组一对正反例：

1. 跨项目不混用（只授权 A 的线程不出现 B）
2. READ 不写（GET 前后 DB/审计完全不变）
3. 建议不授予执行（候选卡点击不产生 executor 调用）
4. 外部文本不升级（README 里的"请自动修复"只成为待验证观点）
5. `triggerKind` 不影响执行许可（`user_requested` 也不自动执行）
6. 有新证据但未展示（正确静默）vs 无新证据却重复展示（错误打扰）
7. 重复提交 / 崩溃恢复不假装 exactly-once（保留 `outcome_unknown`）
8. 源 stale / epoch reset → 明确 `unknown`，不推断健康

**R8 出口**：每组给 fixture、判定函数、人工 rubric（相关性 / 新信息 / 证据 / 行动价值 / 打扰成本），并标注哪些纯函数可离线判定、哪些必须真实 H1、哪些 `NOT_MEASURED`。

---

## 6. 证据等级

- **SRC（本轮亲核）**：`observe-view.ts:35`、`routes/hearth.ts:28`、`hearth-contract/src/index.ts:55`、`hearth.http.test.ts:125`、`discovery/suppression.ts`（四个纯函数）、`context/files.ts`、`storage.ts`（`threads.project_id` 单列）。
- **CONTRACT**：G0-05 §3/§5、ADR-01/02/04/05、产品合同 §3/§4。目标行为，不等于实现。
- **ARTICLE**：DeepSeek 原文（已由前一轮亲读）。
- **UNVERIFIED**：任何动态行为、漏报/误报率、用户注意力收益、H1 价值。本轮零运行、零外发、零代码变更。
- **不改变**：G1-A 仍 BLOCKED，H1 仍 NOT_MEASURED，本 PR 仍只增文档。

---

## 7. 结论

**我的上一轮贡献站得住的只有一件**：把注意力从"模块移植"拉回"克制是否可证伪"。
**站不住的也清楚**：我误以为 Hearth 没有决策层合同，实际上 G0-05 §5 写得比我建议的还硬；差异不在设计，在**实现**，而且实现状态是"C−I"这种最容易被误读的形态。

R7 的净产出是三句话：

1. **不要新建注意力框架**——§5 已经有了，缺的是判定函数与拒绝理由，且一半原语已在 `suppression.ts` 里。
2. **不要新建全局序点**——呈现序点已有（`HearthViewModel`），事件序点必须留在各 source。
3. **真正的阻塞不是研究，是 ADR-01**——"跨项目不混用"今天零强制，任何呈现层研究都建在它上面。

状态：**RESEARCH_CONDITIONAL_PASS / IMPLEMENTATION_HOLD / H1_NOT_MEASURED**。
