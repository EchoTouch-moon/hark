# R12 · 组 B 合成 fixture 与判定 rubric 冻结（首个离线 PoC 的前置）

> 2026-11-01 · **RESEARCH / NO IMPLEMENTATION AUTHORIZATION**
> 承接 [R11 v2 §3 顺序决议](./2026-11-01-dsh-superagent-r11-frozen-contracts.md)：「先 B 后 A，fixture 冻结在前」。
> 本文**只冻结规格**：输入形态、期望输出、断言、人工评分口径。**不含任何可执行代码**，不建表、不写迁移、不跑测试。
> 基线：Hearth `e470436`；G0-05 §5 为唯一 Must。全部用例状态 `DESIGNED / NOT_RUN`。

---

## 0. 本文冻结什么、不冻结什么

| 冻结 | 不冻结 |
|---|---|
| 合成项目的固定事实（id、时间、证据集） | 任何实现（表结构、函数签名、存储位置） |
| 每个用例的**期望判定**与理由码枚举 | 阈值数值（冷却小时数、字数上限） |
| 两份账单的字段白名单 | 保留期具体天数 |
| 人工评分 rubric 与分歧处理 | 真实 H1 的价值结论 |

**一句话**：冻结的是"什么叫对"，不是"怎么写"。

---

## 1. 合成世界（全实验共享）

两个项目，事实固定，不随用例变化：

```text
projectA "炉心"   evidence:
  eA1  git 提交 a1b2c3  2026-11-01T09:00Z   "refactor flame projection"
  eA2  JUnit 报告 run-77 2026-11-01T10:00Z   tests=12 failures=1
  eA3  用户决定 dA1      2026-11-01T08:00Z   "本季度优先稳定性，不上新视觉"
  eA4  git 提交 a1b2c4  2026-11-02T09:00Z   (仅时间不同，内容同 eA1)

projectB "灯下"   evidence:
  eB1  git 提交 b9f8e7  2026-11-01T09:30Z   "sync workspace metadata"
```

固定约束：

- `projectA` 已授权 observe/research/model；`projectB` 同样全授权（用于验证"有权限也必须隔离"）；
- `execute` 恒为 false；
- 时钟由用例显式给出，**不使用真实时间**。

---

## 2. 两份账单的字段（只允许这些）

### 2.1 Trigger Disposition（1 trigger : 1 行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `triggerId` | string | 去重后的事件标识 |
| `projectId` | string | 必填，保证可删 |
| `filtered` | `{code}` \| null | 被来源/规则过滤时的固定枚举码 |
| `fanout` | string[] | 送入哪些候选（可为空） |
| `at` | ISO | 判定时刻（由用例给） |

### 2.2 Candidate Decision Trace（1 候选 : 1 行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `candidateId` | string | 稳定标识 |
| `hash` | string | 受密钥保护的摘要（防低熵枚举） |
| `projectId` | string | — |
| `ruleRefs` | `{id, version}[]` | 命中的规则 |
| `triggerKind` | `'user_requested' \| 'system_suggested'` | **不参与执行授权** |
| `disposition` | 枚举（见 §3） | — |
| `reasonCode` | 枚举（见 §3） | **不接受自由文本** |
| `boundedCounts` | `{evidenceDiff:int, hasGoalLink:bool}` | 有界计数 |
| `mergedFrom?` | string[] | 合并候选时标注来源 |
| `decidedAt` | ISO | — |

**明令不落**：候选正文、查询词、绝对路径、URL、来源全文、模型输出。

---

## 3. 枚举（冻结，不得扩展）

```text
disposition:  ignored | would_present | claimed | presented | withheld
reasonCode:   NO_NEW_EVIDENCE | NO_GOAL_LINK | COOLDOWN | DEFERRED
              | DAILY_BUDGET | PROJECT_NOT_FOCUSED | SOURCE_STALE
              | NOT_CLAIMED | DELIVERY_UNCERTAIN | USER_TYPING
```

`SOURCE_STALE` 与 `NOT_CLAIMED` 的存在就是为了 §2.4 与 §2.3 的区分——**不得合并成"静默"**。

---

## 4. 六组用例（输入 → 期望）

### N1 新证据

| | 输入 | 期望 |
|---|---|---|
| 正例 | A 已有呈现过的证据集 {eA1}；新到 eA2 | `would_present`，`evidenceDiff=[eA2]`，`reasonCode=null`（无拒绝码） |
| 反例 | 只有 eA4（与 eA1 内容相同、仅时间不同） | `ignored`，`reasonCode=NO_NEW_EVIDENCE`，`evidenceDiff=0` |

**断言**：差集按**内容**而非时间戳；eA4 必须被判为"无新证据"。

### N2 目标关联

| | 输入 | 期望 |
|---|---|---|
| 正例 | 新证据 eA2 + `GoalRevision=dA1`（稳定性优先） | `would_present`，`hasGoalLink=true`，`whyNow` 必须能写出"测试失败与稳定性目标的关系" |
| 反例 | 新证据 eA2 + 目标为"优先视觉刷新" | `ignored`，`reasonCode=NO_GOAL_LINK` |

**断言**：`whyNow` 若为通用套话（不含目标要素）即判 FAIL——这是防 fake whyNow 的唯一硬闸。

### N3 时效

| | 输入 | 期望 |
|---|---|---|
| 正例 | A 新鲜（staleMs 内） | 正常进入 N1/N2 判定 |
| 反例 | A 的 `observationFreshness=stale` | 观点通道：`withheld`，`reasonCode=SOURCE_STALE`；**观察通道：必须返回明示"暂无法判断"** |

**断言**：两条通道分别断言。只断言"静默"即 FAIL（会把"坏了"说成"没事"）。

### N4 跨项目

| | 输入 | 期望 |
|---|---|---|
| 正例 | 只有 A 的证据 | 候选与 `whyNow` 只含 A 的 id/标题/文件名 |
| 反例 | A 的候选生成时混入 eB1 | 判 FAIL：任一字段出现 `projectB` / `灯下` / `b9f8e7` 即失败 |

**断言**：对整个 Candidate Trace 行做**字段级**检查，不做自由文本匹配。

### N5 输入态

| | 输入 | 期望 |
|---|---|---|
| 正例 | 同一时刻、同一证据，用户输入前与输入后 | 服务端 `eligibility` **完全相同** |
| 反例 | 实现里以"用户正在输入"为由把 eligibility 改成 `ignored` | 判 FAIL |

**断言**：`eligibility` 是纯函数输出；`USER_TYPING` 只能出现在**客户端/claim 层**，不得出现在服务端 eligibility。

### N6 配额（G0-05 §5 第 4 条，唯一 Must）

| | 输入 | 期望 |
|---|---|---|
| 正例 | projectA 过去 24h 已 `presented` 0 条 | 第 1 条可 `claimed → presented` |
| 反例 1 | projectA 24h 内已 `presented` 1 条 | 第 2 条 `withheld`，`reasonCode=DAILY_BUDGET` |
| 反例 2 | A 已用满、B 未用 | **B 不受影响**（按 project 计，不按全局） |
| 反例 3 | 23:59 呈现 1 条，00:01 又来新证据 | 按**滑动 24h** 判：仍在窗口内 → `DAILY_BUDGET`（若未来改用自然日口径，此例期望会变，必须显式标注走哪套） |
| 反例 4 | 已 `claim` 但 ACK 丢失 | 记 `DELIVERY_UNCERTAIN`，**不重发、也不计为已呈现** |

**断言**：计数对象是 `presented`，**不是**卡片创建；作用域是 project，不是全局。

---

## 5. 人工 rubric（与自动断言分开）

自动断言只回答"逻辑对不对"；**值不值得说**必须人工评。五维，各 1–5 分：

| 维度 | 1 分 | 5 分 |
|---|---|---|
| 相关性 | 与项目无关 | 直指当前目标的核心 |
| 新信息 | 已知内容复述 | 提供了此前无法得知的事实 |
| 证据可信 | 无出处 | 可点开核对，且来源恰当 |
| 行动价值 | 无法行动 | 给出可执行的下一步 |
| 打扰成本（反向计分） | 打断也值 | 完全不值得打断 |

**分歧处理**：两人独立评，分差 ≥2 的维度必须记录分歧理由，不进平均分；只统计**一致区间**。

**明确不测**：真实用户感受、长期留存、真实项目上的准确性——这些属 H1，本轮 `NOT_MEASURED`。

---

## 6. 通过条件（整个组 B）

| # | 条件 | 说明 |
|---|---|---|
| 1 | N1–N6 六组正反例全过 | 反例必须 FAIL 才算数 |
| 2 | 两份账单基数守恒 | Trigger Disposition 行数 = 输入 trigger 数（含 filtered）；Candidate Trace 行数 = 去重后候选数 |
| 3 | 字段白名单无泄漏 | 用 schema 白名单校验，而非内容正则 |
| 4 | 人工 rubric 一致区间达到预设门槛 | 门槛值需在开跑前确定，不得事后调整 |
| 5 | 全部用例状态如实标注 | 未跑的写 `NOT_RUN`，不写 `PASS` |

**没有第 6 条**。尤其不能用"Demo 看起来对"替代上述任何一条。

---

## 7. 与组 A 的边界

- 本文不触碰执行/恢复路径，不评估 `executeCard`、`recoverInterrupted`、`runs` 路由；
- 组 B 全部在 `execute=false` 前提下运行，**任何用例都不得产生外部执行**；
- 组 A 的 L2 注入（子进程强杀）仍需单独授权，不因组 B 完成而启动。

---

## 8. 证据等级

- **SRC**：G0-05 §5（四门槛）、G0-05 §3（`observationFreshness` 与"暂无法判断"）、ADR-06（单一投影）。
- **DESIGNED / NOT_RUN**：N1–N6 共 12 条（正例 6 + 反例 6，N6 含 4 个反例）。
- **UNVERIFIED**：一切运行时结果；rubric 的区分度；配额口径的用户感受。

---

## 9. 结论

这份冻结的实质，是把"没事安静陪着"拆成**两种不同性质的安静**：

- **逻辑层的安静**（无新证据 / 无目标关联 / 配额用尽）—— 可以完全不出声；
- **通道故障的安静**（源 stale / 回执丢失）—— 必须出声说明"我现在不知道"。

v1 把两者混成"静默"，会让最该说的那句"我看不清了"被吞掉。这是本轮最该记住的一条。

状态：`RESEARCH_CORRECTED / IMPLEMENTATION_HOLD / G1-A BLOCKED / H1 NOT_MEASURED`。
