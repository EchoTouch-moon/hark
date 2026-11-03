# G0 → G1 证据与 Gate 状态矩阵（2026-11-03）

> 任务：GitHub Issue [#37 · Q-01](https://github.com/EchoTouch-moon/hark/issues/37)。
> 目的：把「PR 已合并 / 切片已验收 / Gate 已通过」三件不同的事实分行写清，避免用 CI 绿或合并动作推出整闸 PASS。
> 本文件只记录实时读回的事实与固定 SHA，**不修改** `handoff/STATUS.md`、业务代码或任何历史红绿日志。

## 1. 结论摘要

| 事实 | 值 | 判定 |
|---|---|---|
| G0 合同 | `CONDITIONAL_PASS` | 修订合同（v0.2）仍待复审，不是最终 PASS |
| G1-A 安全基线 | `IN_PROGRESS` / `NOT_PASSED` | 四个已合并 PR 只覆盖四个独立切片 |
| G1-B / G1-C | `BLOCKED` | 分别等待 G1-A、G1-B 通过 |
| G2 公开研究 | `BLOCKED` | 前置门禁未过，来源/授权/预算未定 |
| Experience | `IN_PROGRESS` | 基础实现存在，真实集成与 QA 受前置门禁约束 |
| H1 用户价值 | `NOT_STARTED` / `NOT_MEASURED` | 0 份逐项人评 |
| G3 | `UNKNOWN` | 核验材料中没有正式定义，留空不猜 |

**一句话**：G0 集成线上有 4 个已合并的安全修复 PR，每个都有独立的切片验收；**没有任何一个**构成完整 G1-A 的通过证据。

## 2. 核对基线

- 核对时间：2026-11-03 16:20（Asia/Shanghai）。
- 集成分支：`bot/hearth-g0-contract@e62f57d00a26ba6fd034be82a2daf97e77926b3a`（PR #34 的 merge commit）。
- 远端 `master@ca17007df9f2`（与 PM-2 记录一致，本轮未变化）。
- 数据来源：`gh pr view` / `gh api .../pulls/:n/reviews` / `gh pr view --json statusCheckRollup` / 合并提交正文。所有 PR 状态为**本轮实时读回**，不引用 Notion 快照或旧文档结论。

## 3. PR 审查矩阵（主表）

| PR | PR state | head SHA | merge commit | 切片范围 | 切片状态 | Gate 状态 | 未覆盖项 |
|---|---|---|---|---|---|---|---|
| [#29](https://github.com/EchoTouch-Moon/hark/pull/29) | MERGED 2026-11-02T02:45:51Z | `698f86b0bb80` | `de31607cea23` | 旧执行/审批入口 fail-closed；首启 Demo 初始化与 legacy 执行解耦；reset 缺可信归属时拒绝 | PASS（D-01，仅限执行安全范围） | G1-A 仍 `NOT_PASSED` | 事件三入口脱敏（→ #30）、可信数据归属后的 reset 恢复 |
| [#30](https://github.com/EchoTouch-Moon/hark/pull/30) | MERGED 2026-11-02T02:58:56Z | `4c876124aa57` | `5bcbcfb447b2` | `/events`、`/projects/:id`、`/cards/:id` 统一移除 restricted 事件的 `payloadRef` | PASS | G1-A 仍 `NOT_PASSED` | 仅该字段；不含 PATCH、不含跨项目矩阵 |
| [#32](https://github.com/EchoTouch-Moon/hark/pull/32) | MERGED 2026-11-02T08:38:58Z | `1715ea065094` | `6ef6fe00c905` | `PUT /api/v1/hearth/permissions` 移除 CSRF 豁免；冷启动 401 会话复用一次 | PASS（切片）+ 复审 CONDITIONAL_PASS 项已跟进 | G1-A 仍 `NOT_PASSED` | **PATCH** 写路由的 CSRF/Origin 负例（独立后续项） |
| [#34](https://github.com/EchoTouch-Moon/hark/pull/34) | MERGED 2026-11-03T05:43:43Z | `b1f1b19e1093` | `e62f57d00a26` | threads/chat 临时项目隔离 fail-closed；旧 Action 拒绝语义（401/403/404/409/500 与 2xx 空响应不降级 Mock） | PASS（`TARGETED_P1_PASS`，仅该切片） | G1-A 仍 `NOT_PASSED` | 见第 5 节全部 7 项 |

### 3.1 每行的「PR state / slice / Gate」三列分开写的理由

- **PR state** 是 GitHub 生命周期事实（MERGED / OPEN / CLOSED）。
- **切片状态** 是该 PR 自述并留证的验收结论，作用域限于它改的文件与负例。
- **Gate 状态** 是门禁结论，只能由完整出口条件 + 人类批准 + 固定版本证据共同推出。

三者互不替代：`MERGED` 不等于切片 `PASS`，切片 `PASS` 不等于 Gate `PASS`。

## 4. 各 PR 的 CI 与审查事实

| PR | CI（head 绑定） | GitHub Review | 说明 |
|---|---|---|---|
| #29 | 4 项 success：detect changes、Node 22 / Linux、Node 22 / Windows、ci-gate | 无 review 记录 | PR 正文记录 `D-01 PASS`，属用户提供的复审结论，非 GitHub 正式审批 |
| #30 | 4 项 success | 无 review 记录 | PR 正文注明「最终安全验收仍待单独审阅」 |
| #32 | 4 项 success（run 41412757239，head `1715ea06`） | `COMMENTED` × 2，无 `APPROVED` | 首次全量 E2E 曾因**并发测试争用服务端口**失败，停止并发后重跑通过 |
| #34 | 4 项 success（合并前 run 41567581799、合并后 41585596367） | `COMMENTED` × 1（旧 head），无 `APPROVED` | 合并依据 owner 明确授权；合并提交正文明确标注 `TARGETED_P1_PASS` 与完整 G1-A `NOT_PASSED` |

> **CI 绿 ≠ Gate PASS**：四个 PR 的 ci-gate 全部 success，但 CI 只证明该 head 在既定检查下可构建、可测、无已知回归；它不覆盖未编写的负例，也不构成人类批准。

## 5. PR #34 合并提交自述的未覆盖项（完整 G1-A 出口缺口）

合并提交 `e62f57d` 正文原文列出的缺口，逐项保留：

1. `ProjectSource` / `ThreadProjectBinding` 归属模型与多对多绑定；
2. 旧数据迁移；
3. `cards` / `runs` / `SSE`；
4. Demo reset 的可信归属（当前一律拒绝，未恢复能力）；
5. `PATCH` CSRF（本轮 #32 只覆盖 `PUT /permissions`）；
6. 多进程 E2E（端口 / SQLite / artifacts 隔离）；
7. 执行器崩溃恢复。

这 7 项与 PR #35 正文「已登记 P2」第 5 条完全一致；#35 是 `handoff/STATUS.md` 的状态收口文档，本矩阵是**逐 PR 的审查矩阵**，二者互补、不重复：本文件不复述 #35 的段落原文，也不改 `handoff/STATUS.md`。

- 状态收口文档：[PR #35 · docs(status): record PR #34 merge and G1-A slice scope](https://github.com/EchoTouch-Moon/hark/pull/35)（OPEN / Draft，head `7dced3544043`，1 文件 +35/−0）
- 切片合同：[docs/verification/g1a-thread-scope-contract-2026-11-02.md](./g1a-thread-scope-contract-2026-11-02.md)

## 6. Draft PR 与研究工作的事实边界

| PR | state | head | 规模 | 性质 | 能否作为 G1 证据 |
|---|---|---|---|---|---|
| [#31](https://github.com/EchoTouch-Moon/hark/pull/31) | OPEN / Draft | `0f037c041194` | 4 文件 +327/−0 | 阶段门禁与任务池规划 | 否，规划文本 |
| [#35](https://github.com/EchoTouch-Moon/hark/pull/35) | OPEN / Draft | `7dced3544043` | 1 文件 +35/−0 | 状态收口（仅 `handoff/STATUS.md`） | 否，状态文档 |
| [#12](https://github.com/EchoTouch-Moon/hark/pull/12) | OPEN / Draft | `ceba75dfc836` | 18 文件 +3353/−0 | 静态差异与安全门禁研究 | 否，研究文本 |
| [#15](https://github.com/EchoTouch-Moon/hark/pull/15) | OPEN / Draft | `5ee8ff02442e` | 5 文件 +643/−0 | 组 B 离线 PoC（19 用例，含变异测试） | 否，离线实验 |

- `#15` 是**离线 19 用例 PoC**，运行在合成场景里，不是上线模型、不是真实观点能力；其价值在于呈现资格判定逻辑的可验证性。
- `#12` 是研究/复审文本，不能当作 G1 业务实现。
- `#31` / `#35` 均为 Draft，合并前不改变任何 Gate。

## 7. 矩阵的负例自查（Issue #37 要求的三条）

| 反例 | 本文件如何处理 | 结果 |
|---|---|---|
| 把 CI 绿误判为整闸 PASS | 第 4 节单列 CI 事实并标注「≠ Gate PASS」；第 3 节把 slice 与 Gate 分列 | 未发生 |
| 把已合并的 #34 写成 OPEN | 第 3 节 #34 行 state=`MERGED 2026-11-03T05:43:43Z`，第 6 节 Draft 表中不含 #34 | 未发生 |
| 把 #15 的离线 PoC 写成上线模型 | 第 6 节标注「离线 19 用例 PoC」「不是上线模型」 | 未发生 |

## 8. 未测与限制

- 本文件是**只读核对**产物：未运行 Hark 产品测试，未复跑 636 单测 / 39 Mock E2E。
- GitHub Review 列表为空或仅 `COMMENTED` 的 PR，未补造 `APPROVED`。
- `statusCheckRollup` 只返回该 PR head 关联检查的结论，不构成对合并后分支的新验证。
- 私有 GitHub Project（`Hark · Engineering Board`）字段本轮未读取（连接器无 Projects 读工具），Board 状态不在本矩阵断言范围内。

## 9. 复现命令

```bash
cd <repo>
git fetch origin --prune
git rev-parse origin/bot/hearth-g0-contract
gh pr view 29 --json state,headRefOid,mergeCommit,mergedAt,statusCheckRollup
gh pr view 30 --json state,headRefOid,mergeCommit,mergedAt,statusCheckRollup
gh pr view 32 --json state,headRefOid,mergeCommit,mergedAt,statusCheckRollup
gh pr view 34 --json state,headRefOid,mergeCommit,mergedAt,statusCheckRollup
gh api repos/EchoTouch-moon/hark/pulls/34/reviews --jq '[.[]|.state]'
git log -1 --format='%H%n%b' e62f57d
```
