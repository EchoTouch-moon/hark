# R12.2 · R12 规格勘误（F01–F10 回执）

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION（本文不授权编码）**
> 回应 [R13 交叉复核](./2026-11-01-dsh-superagent-r13-r12-cross-review.md) 的 F01–F10。范围只限**规格**：fixture 语义、类型契约、评分口径。不重写架构、不新增服务。
> 与 [R12.1](./2026-11-01-dsh-superagent-r12.1-poc-freeze.md)（`d795bc3`）的分工：R12.1 冻结**门槛/配额口径/模拟客户端/落点**；本文冻结**fixture 语义与类型**。两者合起来才是完整前置。
> 基线 Hearth `e470436`。

---

## 0. 回执总表

| # | 级别 | 我的处理 |
|---|---|---|
| F01 | P0 | **接受，且我原 fixture 是错的**。拆成两类：重复投递（同 `sourceEventId+epoch+contentVersion`）vs 同 message 不同 SHA（必须重新判定） |
| F02 | P0 | **接受**。`reasonCode: ReasonCode \| null`；拆 `evidenceDiffCount: number` 与 `newEvidenceRefs: EvidenceRef[]` |
| F03 | P0 | **接受**。拆 `ack committed / response lost`（幂等重试返原确认、不重复计数）与 `rendered / ack never committed`（`delivery_uncertain`，过期后可能按去重规则重竞争） |
| F04 | P1 | **接受**。N4 期望改为 `blocked` + `PROJECT_SCOPE_DENIED`，测试**通过条件 = 泄漏被拦截**，不是"实现失败" |
| F05 | P1 | **接受**。总数改为 6 组 / **15 条列举情景**（N6 四反例） |
| F06 | P1 | **接受**。新增**非持久化** `CandidateEvaluationOutput`（含 `whyNow`、source refs、goal ref），与 `CandidateTrace`（审计，白名单）分离 |
| F07 | P1 | **接受**。打扰成本按 **cost（越低越好）** 记录；分歧 ≥2 标 `DISPUTED` 并**报告比例**，不剔除 |
| F08 | P1 | **接受**。"明示未知"是**被动状态可见**，不是主动推送；不因无新观点而打扰 |
| F09 | P2 | **接受**。fixture 设 `providerEnabled=false / externalNetwork=false`，并注入"任何外发立即失败"替身 |
| F10 | P2 | **接受**。字段白名单之外再加**值校验**：ID 格式/长度/上限、固定 project scope |

---

## 1. F01：事件身份 ≠ 证据语义（我原来的错误）

R12 原写：

> 反例 eA4「git 提交 a1b2c4，仅时间不同，内容同 eA1」→ `NO_NEW_EVIDENCE`

**这是错的。** 相同 commit message 不构成相同事实：新 commit 可能改动不同文件、不同父提交、不同影响范围。按内容去重会把真实变化吞掉。

修正后**拆成两个不同性质的 fixture**：

| ID | 输入 | 期望 | 依据 |
|---|---|---|---|
| **N1-a 重复投递** | 同一 `sourceEventId` + 同 `epoch` + 同 `contentVersion`，第二次到达 | 不产生新 Trigger（或 disposition=`duplicate`），**不参与证据差集** | 事件身份层去重 |
| **N1-b 同 message 不同 SHA** | `a1b2c4`（message 与 `a1b2c3` 相同，但 SHA/父提交/文件集不同） | **进入证据判定**：按"项目相关证据语义投影"比较——投影不同即为新证据；不得直接判 `NO_NEW_EVIDENCE` | 证据语义层判定 |

**「证据语义投影」在 PoC 中的最小定义**（必须显式列出，不能留给实现猜）：

```
evidenceProjection(evidence) = {
  kind,                  // commit | junit | decision
  contentVersion,        // 由来源提供的稳定版本（commit SHA / 报告哈希）
  changedPathsHash,      // commit 的改动文件集合摘要；junit 为 suite 名集合
  semanticDigest         // kind 内可比字段的摘要（不含时间戳、不含 message 文本）
}
```

判定：`newEvidenceRefs = { e | projection(e) ∉ presentedProjections }`。**message 文本不参与任何比较。**

---

## 2. F02 / F06：三个类型分开，别混用

| 类型 | 是否持久化 | 用途 | 关键字段 |
|---|---|---|---|
| `TriggerDisposition` | 是 | 事件去向 | `sourceEventId`、`epoch`、`contentVersion`、`filtered`、`fanout` |
| `CandidateEvaluationOutput` | **否**（仅合成实验内存） | 逻辑测试的被测对象 | `newEvidenceRefs`、`goalRef`、`whyNow`、`evidenceDiffCount` |
| `CandidateTrace` | 是（审计） | 可复核"为什么没说" | 白名单枚举 + 有界计数，**不含正文/whyNow 全文** |

`reasonCode` 类型修正为：

```ts
type ReasonCode =
  | 'NO_NEW_EVIDENCE' | 'NO_GOAL_LINK' | 'COOLDOWN' | 'DEFERRED'
  | 'DAILY_BUDGET' | 'PROJECT_NOT_FOCUSED' | 'SOURCE_STALE'
  | 'NOT_CLAIMED' | 'DELIVERY_UNCERTAIN' | 'USER_TYPING'
  | 'PROJECT_SCOPE_DENIED';        // F04 新增（此前缺失）

// disposition 与 reasonCode 的关联：
//   would_present / claimed / presented → reasonCode 必须为 null
//   ignored / withheld / blocked        → reasonCode 必须有值
```

`blocked` 是新增 disposition（F04），用于"泄漏被拦截"这类**授权拒绝**，与"不值得说"（`ignored`）区分。

---

## 3. F03：回执的两种失败，不能合并

原 R12 写「ACK 丢失 → 不重发、不计已呈现」当作绝对规则。G0-02 §4 明确：展示后、确认前崩溃时结果不确定，租约到期可重新竞争，**恢复可能重复一次**。所以必须拆：

| 情形 | 状态 | 行为 | 断言 |
|---|---|---|---|
| **E1** 回执已提交、响应丢失 | `presented`（服务端已记） | 同一幂等键重试 → **返回原确认**，不重复计数 | 重试 N 次后 `presented` 计数仍为 1 |
| **E2** 已渲染、回执从未提交 | `delivery_uncertain` | **不得**宣称 exactly-once；租约过期后可**按去重/冷却规则重竞争** | 过期后允许再次 `claim`；同一时刻不得有两条同时在途 |
| **E3** 客户端拒绝渲染 | `claimed`（回退） | 不算已呈现 | 计数不变、不触发冷却 |

**不得**把 E2 写成"不重发"。正确表述是：**本地不能从沉默推断用户没看过，也不能断言系统应再次提醒**——两者都要靠幂等回查与有界不确定性状态。

---

## 4. F04：N4 的期望是「被拦截」，不是「实现失败」

| | 输入 | 期望 disposition | 期望 reasonCode | 测试通过条件 |
|---|---|---|---|---|
| N4 正例 | 只有 A 的证据 | `would_present` | `null` | 全字段无 B 标识 |
| N4 反例 | A 的候选混入 `eB1` | **`blocked`** | `PROJECT_SCOPE_DENIED` | **泄漏被拦截**；且拦截发生在任何呈现判定之前 |

原写法"反例判 FAIL"会被误读成"合规实现应该失败"，必须改。

---

## 5. F07 / F08：评分方向与"明示未知"的边界

**F07**：`attentionCost` 是 **cost，1 最好、5 最差**，不参与"越高越好"的均值。若需统一方向，用 `attentionBenefit = 6 − attentionCost`，并在报告里注明是转换值。

分歧 ≥2 的维度标 `DISPUTED`，**保留在分母里**，单独报告 `disputeRate`；**不剔除**（剔除会系统性夸大一致性）。门槛（R12.1 §2）仍按"一致区间均值 ≥3.5"计，但必须同时报告剔除率。

**F08**：`SOURCE_STALE` 的正确后果是**页面打开时明确显示"观察状态未知"**（`observationFreshness` + 文案），**不是**主动推送一条"我看不清了"。后者会用一个新打扰去修另一个打扰。命令式规则：

- 无新观点 → 静默（不推）；
- 源不可信 → **被动可见**（用户打开就能看到）；
- 只有"用户必须现在做决定"才允许主动推送，且需独立预算。

---

## 6. F05 / F09 / F10：计数、隔离、值校验

**F05**：总数改为 **6 组 / 15 条列举情景**：

| 组 | 正 | 反 | 小计 |
|---|---|---|---|
| N1（拆 a/b） | 2 | 0 | 2 |
| N2 | 1 | 1 | 2 |
| N3 | 1 | 1 | 2 |
| N4 | 1 | 1 | 2 |
| N5 | 1 | 1 | 2 |
| N6 | 1 | **4** | 5 |
| 合计 | 7 | 8 | **15** |

**N2 的地面真值**（R13 §1 附注）：不能让测试作者主观判断"JUnit FAIL 算不算影响视觉目标"。修正：fixture 显式给定 **goal 的 impact 边界**——

```
goal dA1 "本季度优先稳定性，不上新视觉"
impactBoundary: { paths: ['src/**'], suites: ['unit'] }
```

正例：失败的用例属于 `unit` 且改动路径在 `src/**` → 相关。
反例：失败的用例属于 `visual-snapshot` 套件、且项目本季度未启用视觉目标 → **明确不相关**（不是"换一段目标文字"）。

**F09**：全部 fixture 设 `execute=false, providerEnabled=false, externalNetwork=false`，并注入 `failOnEgress` 替身：任何网络/模型调用立即抛出，测试断言该替身**从未被调用**。

**F10**：白名单字段的值也要校验——`projectId` 必须命中 `projectA|projectB` 固定集合；`sourceEventId` 必须匹配 `^ev-[a-z0-9-]{1,24}$`；数组长度 ≤16；`reasonCode` 封闭枚举。

---

## 7. 编码前的最后一张检查表

| 检查 | 状态 |
|---|---|
| R11 v2 设计被 ACCEPT | ✅（R13 §0） |
| R12 fixture 语义已勘误（本文） | ✅ |
| 门槛/口径/替身/落点已冻结（R12.1） | ✅ |
| 15 条情景与期望全部写死 | ✅ |
| 三个类型分离（Disposition / EvaluationOutput / Trace） | ✅ |
| `blocked` + `PROJECT_SCOPE_DENIED` 已入枚举 | ✅ |
| 回执三情形（E1/E2/E3）已分离 | ✅ |
| 用户明确批准编码 | **待用户** |

---

## 8. 结论

F01 是最值得记的一条：我原来用"内容相同"当"事实相同"，而事件的**身份**（谁、哪次、哪个版本到达）与证据的**语义**（这次到达是否带来新事实）是两个层次。把它们合并，就会在"同 message 不同 SHA"这种极常见的场景里静默吞掉真实变化——而这恰好是 Hearth 最不能犯的错：**该说话时沉默**。

状态：`RESEARCH_CORRECTED / IMPLEMENTATION_HOLD（待用户批准编码）/ G1-A BLOCKED / H1 NOT_MEASURED`。
