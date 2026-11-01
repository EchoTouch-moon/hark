# R12.1 · 首个 PoC 的实现前冻结：门槛、口径、模拟客户端与落点

> 2026-11-01 · **IMPLEMENTATION AUTHORIZED BY OWNER（仅限本文 §5 的离线 PoC）**
> 补完 [R12](./2026-11-01-dsh-superagent-r12-group-b-fixtures.md) 留下的空格，并冻结"能开始写代码"所需的全部前置。
> 基线：Hearth `e470436`；G0-05 §5 为唯一 Must。
> 本文**不改变** G1-A `BLOCKED`、H1 `NOT_MEASURED`，也不授权任何真实 API/网络/模型/执行路径。

---

## 1. R12 留了什么空格

| # | 空格 | R12.1 的处理 |
|---|---|---|
| 1 | 人工 rubric 的通过门槛未填（我刻意留空，避免"为通过而设标准"） | §2 给出**事先承诺**的门槛与其失效条件 |
| 2 | 配额口径没有锁定（G0 写 24h，旧实现写自然日） | §3 锁定**滑动 24h**，自然日只做负对照 |
| 3 | 离线 PoC 没有真实 UI，`claim`/`presented` 由谁驱动未定义 | §4 定义**确定性模拟客户端**（三种投递结果显式指定，不用随机） |
| 4 | PoC 代码放哪、会不会污染工程 | §5 落点 `tests/unit/presentation-lab/`，附隔离断言 |
| 5 | 通过条件到具体断言的映射 | §6 一张映射表 |

---

## 2. 门槛冻结（事先承诺，事后不得下调）

### 2.1 自动断言（硬性，无分数）

N1–N6 六组共 **12 条判定**必须全部通过，且**反例必须判 FAIL 才算数**。任何一条未过即整轮不通过。

### 2.2 人工 rubric（五维，1–5 分）

| 维度 | 定义 | 门槛 |
|---|---|---|
| 相关性 | 与当前项目目标的关联强度 | ≥3 |
| 新信息 | 是否提供此前无法得知的事实 | ≥3 |
| 证据可信 | 能否点开核对、来源是否恰当 | ≥3 |
| 行动价值 | 能否给出可执行的下一步 | ≥3 |
| 打扰成本（反向） | 越高表示越不值得打断 | **≥3**（即"不算白打扰"） |

取两名评审的**一致区间**（分差 ≤1 的维度）求均值，要求：

- 一致区间均值 **≥3.5**；
- 五个维度中**无一项 <3**；
- 分差 ≥2 的维度不计入均值，并记录分歧理由。

### 2.3 稳定性门槛

单个用例若出现 **≥2 个维度分差 ≥2**，标记 `RUBRIC_UNSTABLE`，需第三人裁决后方可计入。全批 6 组中 `RUBRIC_UNSTABLE` **不得超过 1 组**。

### 2.4 门槛的失效条件（防止事后下调）

1. 门槛**只能上调**；下调必须新开一轮并写明理由，且不得早于看到本轮结果之后 24 小时；
2. 若本轮未达门槛，结论是"未通过"，**不得**改为"接近通过"或"样本不足故豁免"；
3. 若评审人不足两人，本轮判定为 `RUBRIC_NOT_RUN`，自动断言结果仍然有效，但**不得**宣称组 B 通过。

---

## 3. 配额口径：锁定滑动 24h

G0-05 §5 第 4 条原文是"同一项目 24 小时内主动呈现不超过 1 条"，因此 PoC **按滑动 24h 实现**：

```
eligible_quota(now, projectId) := presentedWithin(projectId, now-24h, now).length < maxPerProjectPer24h
```

- `maxPerProjectPer24h` 默认 1，可配置；
- 计数对象是 **`presented`**（含 `delivery_uncertain` 记为"可能已呈现"，保守计入）；
- 作用域是 **projectId**，不是全局。

**旧 `discovery.ts:76-79` 的自然日 / 全局 / 卡片创建口径只保留一个负对照用例**：证明"若误用该口径，projectB 会被 projectA 的用量拖累"——用来固化"为什么不能用它"，**不参与任何通过判定**。

---

## 4. 模拟客户端（离线 PoC 的 `claim → presented`）

没有真实 UI，因此定义一个**确定性**的客户端替身，投递结果由用例输入显式给出（**禁止随机**）：

| 输入 | 行为 | 结果 |
|---|---|---|
| `confirmed` | 客户端声明可见 + 服务器收到回执 | `presented` |
| `lost` | 客户端已渲染，但回执丢失 | `delivery_uncertain`（**不重发**、**不计为 `presented` 之外的静默**） |
| `rejected` | 客户端拒绝渲染（如被遮挡/未聚焦） | 回到 `claimed`，不视为已呈现 |

**三条不变量**：
1. `delivery_uncertain` **不得**被当成"未呈现"而触发重发（否则会重复打扰）；
2. `delivery_uncertain` **不得**被计为"已读"；
3. `presented` 与 `read` 是不同状态，PoC 只到 `presented`，`read` 留空并标 `NOT_MEASURED`。

---

## 5. 落点与隔离（这是本次授权允许改动的全部范围）

### 5.1 位置

```
tests/unit/presentation-lab/
  types.ts            枚举、两份账单记录类型、字段白名单
  eligibility.ts      G0-05 §5 四门槛（纯函数，无 I/O、无时钟注入以外依赖）
  ledgers.ts          TriggerDisposition / CandidateTrace 的追加与校验
  client-sim.ts       claim 与三种回执结果
  cases.test.ts       N1–N6 十二组断言
```

放在 `tests/unit/` 的理由：`vitest.config.ts` 已包含 `tests/unit/**/*.test.ts`，`tsconfig.json` 已包含 `tests/unit/**/*.ts`，**因此不需要改任何工程配置、不需要新增 workspace 包、不需要动 `pnpm-lock.yaml`**（新增包会要求 lockfile 更新并影响 `--frozen-lockfile` 的 CI）。

### 5.2 隔离断言（必须写进测试）

1. `tests/unit/presentation-lab/` 下的文件**不得** import `apps/*`、`packages/storage`、`packages/project-analysis`、任何 provider；
2. 生产代码（`apps/**`、`packages/*/src/**`）**不得** import `tests/unit/presentation-lab`；
3. 不读写文件系统、不建 SQLite、不发网络请求、不调模型；
4. 唯一的时间来源是入参 `now: Date`，**不得调用 `Date.now()`**（用一条断言扫描本目录源码）。

第 4 条是本轮的重点：它是 R8 那条 flaky 的直接对策——**时间必须是参数**。

---

## 6. 通过条件 → 断言映射

| R12 通过条件 | R12.1 的落地断言 |
|---|---|
| N1–N6 全过 | `cases.test.ts` 12 条 `it()`，反例断言失败分支 |
| 两份账单基数守恒 | Trigger Disposition 行数 = trigger 数（含 filtered）；Candidate Trace 行数 = 去重后候选数 |
| 字段白名单无泄漏 | 记录构造后逐字段与白名单比对；非法字段名测试必须抛错 |
| 人工 rubric 达门槛 | §2.2/§2.3；本轮 `NOT_RUN` |
| 状态如实标注 | 每条用例显式标 `DESIGNED/RUN/PASS/FAIL`；未跑的写 `NOT_RUN` |

---

## 7. 本次明确不做

- 不接 HTTP 路由、不改 `observe-view.ts`、不填 `featuredOpinion` 的真实实现；
- 不建数据库表、不写迁移、不碰 `Storage`；
- 不碰执行/恢复路径（组 A 全部继续只做设计）；
- 不引入模型调用、不引入网络、不读真实项目；
- 不并入任何 app 的依赖图。

**若后续要把 PoC 提升为生产实现**，必须另开一轮：明确落点、迁移方案、G1-A 前置与回滚方式，不能"从 tests 目录直接搬"。

---

## 8. 结论

R12.1 只做一件事：**把"能开始写"之前必须定死的东西定死**——门槛（且只许上调）、口径（滑动 24h）、替身（确定性回执）、落点（零配置的 tests/unit）。

三条最重要的约束，按重要性排：

1. **时间必须是入参**（`now: Date`），这是对 flaky 的直接免疫；
2. **反例必须判 FAIL 才算数**，否则六组用例只是六段自证；
3. **门槛只能上调**，否则它会在结果出来那一刻失效。

状态：`IMPLEMENTATION_SCOPED / GROUP_B_POC_AUTHORIZED`；G1-A 仍 `BLOCKED`，H1 仍 `NOT_MEASURED`。
