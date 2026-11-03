# Hark 仓库治理审查与 WorkBuddy 执行交接包

> 审查快照：2026-11-01；仓库 https://github.com/EchoTouch-moon/hark
> **执行前重新读取 GitHub 状态**。以下 SHA、数量、分支归属仅为审查基线，不是允许删除/合并的授权。
> 当前结论：**CONDITIONAL_PASS / GOVERNANCE_INCOMPLETE**。
> 工作范围：整理 CI、分支、PR、差异及执行计划；不自动关闭/合并 PR、删除分支、修改保护规则或执行真实 Agent 动作。

## 立即阅读

- 此文档即 WorkBuddy 下一轮执行任务入口。
- 独立任务分支：`ops/workbuddy-governance-handoff-20261101`，基于 `master`。这条分支仅存放交接文件，**不要把治理任务实现直接提交到本分支**；分别新建工作分支和 PR。
- 主线：`master`；新 MVP 集成线：`bot/hearth-g0-contract`。
- 当前未获授权的仓库操作：远端删除、PR 关闭/合并、分支强推、Branch Protection/Ruleset 写入、任何真实模型/网络研究或自动代码修改执行路径。

## 0. 审查结果（绑定基线）

| 项目 | 快照结果 |
| --- | --- |
| 仓库 | public；默认分支 `master` |
| master HEAD | `79fa67e03c8547476df1192e172ec00230381f9b` |
| G0 HEAD | `4fd0480b4883b97d95465ea844eb0ac271d5738e` |
| 分支 | 24 条，包含 2 条长期线 |
| PR | 19：7 open / 11 merged / 1 closed unmerged |
| Actions | 64 条历史记录 |
| master 最新 CI | [success #41289201540](https://github.com/EchoTouch-moon/hark/actions/runs/41289201540) |
| master 较早失败 | [failure #41286293193](https://github.com/EchoTouch-moon/hark/actions/runs/41286293193)，Unit and integration tests 阶段 |
| G0 #19 PR CI | [success #41289309838](https://github.com/EchoTouch-moon/hark/actions/runs/41289309838) |
| G0 合并后的 check-runs | `4fd0480` 返回 **0 个**；PR 检查成功不能等同于合并后 HEAD 通过 |
| 保护规则 | 全部远端分支 `protected=false`；rulesets 空；G0 protection.enabled=false |
| 两线分叉 | 与 master 比较，G0 ahead 87 / behind 8；diff 文件可能触及 API 300 文件上限 |

## 1. Branch Ledger（24 条）

以下 `ancestor` 是审查时使用 GitHub compare 验证的提交祖先关系，不意味着内容已进入 `master`。

### 保留的长期线（2）

- `master`：默认基线。必须先修 CI gate，再制定分支保护；不直接合并陈旧 WIP。
- `bot/hearth-g0-contract`：Hearth G0 集成线。需增加合并后 push CI；与 master 保持分离直至安全与产品门禁完成。

### 已包含于 G0，归档候选（16，G0 compare ahead=0）

| 分支 | 关联情况 |
| --- | --- |
| `bot/design-v6-ember` | #2 closed/unmerged |
| `bot/design-v7` | #7 已合并 G0 |
| `bot/experience-e1` | #8 已合并 G0 |
| `bot/experience-i1` | #11 已合并 G0 |
| `bot/frontend-v6-ember` | #4 open，先审查收口 |
| `bot/hearth-g3-empty-hearth` | #3 open，先复核语义 |
| `bot/hearth-v6-wip` | 历史 WIP |
| `bot/mind-m1` | #9 已合并 G0 |
| `bot/mind-m2` | #10 已合并 G0 |
| `ci/skip-docs-only-g0` | #14 已合并 G0 |
| `codex/ember-narrative-motion` | #5 open，旧版对话/动效实现，不直接合 master |
| `codex/ui-refresh-01` | 历史 UI 设计 |
| `docs/ember-narrative-experience-spec` | #1 open |
| `docs/hearth-mvp-mind-loop-20261030` | #6 open，依赖 #5 |
| `fix/coordinator-gap-flake-g0` | #19 已合并 G0 |
| `fix/windows-portability-g0` | #17 已合并 G0 |

### 已包含于 master，归档候选（2，master compare ahead=0）

- `ci/skip-docs-only`：#13 已合并 master，behind 7。
- `fix/coordinator-gap-flake`：#18 已合并 master，behind 1。

### 四条独有成果线（禁止直接清理）

| 分支 | 相对 G0 | 处理 |
| --- | --- | --- |
| `bot/qa-g0-checklists` | ahead 9 / behind 52；净差异 4 份 `handoff/qa/v7/` 文档 | **RESCUE**，检查价值后独立文档 PR |
| `codex/project-first-conversation` | ahead 23 / behind 53；差异涉及约 293 文件 | **REVIEW/QUARANTINE**，按安全、API、UI、测试、叙事拆解，不直接合并 |
| `poc/group-b-presentation-lab` | ahead 1 / behind 6；5 个 PoC 文件 | **KEEP**，关联 #15 Draft，不接生产 |
| `review/deepseek-superagent-hearth-gap-20261101` | ahead 20 / behind 6；18 份研究 Markdown | **KEEP**，关联 #12 Draft，保存研究证据 |

**数量核对：2 + 16 + 2 + 4 = 24。** 任一分支相对基线有变化，归类需重新计算；不要按分支名称删除。

## 2. PR Ledger

- **已合并（11）**：#7 #8 #9 #10 #11 #13 #14 #16 #17 #18 #19。
- **关闭但未合并（1）**：#2。
- **开放（7）**：#1 #3 #4 #5 #6 #12 #15。
- #12：DeepSeek Super Agent 架构研究，Draft，目标 G0。研究层结论不等于安全实现通过；应保留。
- #15：组 B 离线呈现资格实验，Draft，目标 G0。19 个例子和变异测试需要在最新基线上复核；应保留。
- #1/#3/#4/#5/#6：先建立取代关系和保留证据，具体关闭请提交审批清单；不得将旧实现直接并入 master。
- #16 Windows 修复已合并 master；#17 同步 G0；#18 Coordinator 测试 flaky 修复已合并 master；#19 同步 G0。

## 3. CI 诊断与必须修的门禁

唯一现存 workflow：`.github/workflows/ci.yml`。Ubuntu latest、Node 22、pnpm 11.9.0；typecheck、lint、Vitest、build、Chromium、Mock Playwright E2E。已固定 checkout / setup-node / pnpm/action-setup action SHA，`permissions: contents: read`，使用 Mock Provider 且禁用真实 Pi 路径。

当前问题：

1. `push.branches: [master]`，不触发 G0 合并后的 push 验证。G0 PR green、G0 合并 HEAD check-runs=0 已实查。
2. Linux-only CI，Windows 成功仅为 #16 PR 提交者本地记录（342 passed / 1 skipped，E2E 16/16），尚未变为持续门禁。建议 Windows Node 22 的 typecheck / test / build，浏览器部分按稳定性分阶段启用。
3. `paths-ignore` 在 workflow trigger 层。纯文档 PR 完全没有 check；如果以后把这个 workflow 设置为 required check，可能永远 Pending。必须改为 **PR 每次触发、内部 change detection、条件执行重型验证、固定名称始终结束的 gate job**。文档混代码一律全量验证；workflow 修改全量测试。
4. 无分支保护、无 ruleset；主线目前无强制评审和强制检查。
5. CI green 只覆盖 Mock 工程，不代表安全入口、跨项目隔离、H1 真实项目价值验收通过。

GitHub required-check skip 官方说明：https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

## 4. WorkBuddy 按顺序执行的任务

### G0 — Refresh and audit（只读，先做）

重新获取全部分支 SHA、compare、PR、Actions/Checks、rulesets；写 `docs/engineering/branch-inventory-YYYY-MM-DD.md` 和 `docs/engineering/ci-baseline-YYYY-MM-DD.md`。把本文件当历史审查快照，不允许凭旧 SHA 决定删除。要求每个分支列出 HEAD、vs master、vs G0、PR、unique commits、状态与处理建议。完成时仍不修改远端已有对象。

### G1 — CI 门禁改造（独立 PR）

- 先在 master 建 CI 改造 PR，之后以等价变更同步 G0（两条线独立验证）。
- 不再在 trigger 层 `paths-ignore` 必需工作流；引入 `detect-changes`、条件 `verify-linux`、固定 `ci-gate`（`if: always()`、明确检查上游 failed/cancelled/skipped 语义）。
- 视资源增加 Windows typecheck/test/build；macOS 可先非阻断；保持 mock-only 和最小权限。
- 在 G0 push 也触发 CI，确保 merge commit 最新 SHA 的独立检查。
- 测试矩阵：docs-only→快速 gate green；docs+code→完整 CI；workflow 改动→完整；代码失败→gate red；上游取消→不得假绿；G0 PR 和 G0 push→均存在检查；master push→成功。
- 禁止 `pull_request_target` 执行不可信代码。

### G2 — Ruleset/保护计划（先输出设置单，不直接应用）

在 G1 稳定且状态名固定之后，拟定 `master` 和 G0 的保护配置：要求 PR、必需 `ci-gate`、禁止删除与强推、明确管理者 bypass 审计。先检查 GitHub 个人公开仓库对相应保护能力的实际可用性；不要声称所有规则已启用。

### G3 — PR/分支归档（需用户逐项批准）

对 18 条历史候选与 7 条开放 PR 建立映射：原 SHA、Git 祖先证据、是否有唯一贡献、替代 PR、关闭/删除后找回方案。输出 `docs/engineering/ARCHIVE_CANDIDATES.md`。未获具体批准：`deleted=0, closed=0`。不因历史 open PR 看似陈旧而直接关掉；#12/#15 保留。

### G4 — 独有成果拯救（独立审查）

- QA：核对 `bot/qa-g0-checklists` 的 4 份文档及适用基线，必要时纯文档 PR。
- Conversation：拆解 `codex/project-first-conversation` 的 23 独有提交，逐个 REUSE / REWRITE / REJECT / OBSOLETE；先审安全和 API，再考虑 UI；禁止大分支整合。
- DeepSeek：PR #12 保留研究证据与 implementation hold，不拿研究结论作为产品动作授权。
- PoC：PR #15 继续离线、无模型/存储/网络/真实 API；检查 19 用例及 3 个变异用例，不接生产、不扩大权限。

### G5 — master / G0 收敛设计（只提议，不自动合并）

分辨 ahead 87 / behind 8 中的独有功能、等价 cherry-pick、冲突和行为变化，形成 staged integration 的候选 PR 列表和回滚路径。G1-A 安全门禁与必要的产品验收之前，**不得直接将整个 G0 合并至 master**。

## 5. 不可突破的 Hearth 约束

- Agent 可经授权只读观察项目、进行预算受限的公开研究、形成观点、拟定计划；修改代码、运行实验、PR/Issue/外部写动作，必须先展示具体方案、由用户明确批准再执行。
- 不将「观察/研究」权限当成「执行」权限，不使 Demo/Mock 的绿色状态替代真实执行审计。
- #12 中仍记录旧 proactive、demo 假完成、legacy execute/approval 可达等风险；G1-A / 跨项目隔离尚未完成动态验收，不得标记 PASS。
- 审查和治理流程中不调用真实模型或主动开展网络研究任务；本次仅针对 GitHub 元信息与 Mock CI。

## 6. 必须向用户交付

1. **Branch Ledger**：branch | tip SHA | vs master | vs G0 | PR | unique work | KEEP/REVIEW/ARCHIVE_CANDIDATE | evidence。
2. **CI Matrix**：event/path/target | Linux | Windows | required gate | expected | actual run URL。
3. **Decision Queue**：建议动作 | 影响对象 | 风险 | 前置条件 | 回退措施 | 需用户批准。
4. 合并/删除/关闭数量的精确记录，以及任何 BLOCKED 或未验证项；禁止以笼统「全绿」收尾。

**交接完成标准**：生成可审查的独立 PR 和证据，不做越权治理。WorkBuddy 本地执行前先 `git fetch --all --prune`（只更新本地远端引用，不清除远端分支），按所处工作树的干净状态建立新分支，先做 G0 再做 G1。
