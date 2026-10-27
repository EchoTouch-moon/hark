# 07｜开发 WBS、阶段范围与交付清单

## 夜间资源优先级
单 Agent 或主 Agent+至多 2 子 Agent。每个任务 ≤ 一个可 review 的小变更；循环为：contract → test → implement → run → evidence → commit → handoff。**不因开发时间长自动扩大权限**。

## 阶段与里程碑
| 阶段 | 今晚? | 核心产出 | Gate |
|---|---|---|---|
| M0 规则与环境 | 必须 | workspace、开发脚本、Contracts、Policy、SQLite、测试 | Schema/ACL/审批负例通过 |
| M1 用户闭环 | 优先 | server API、fixture ingest、cards、run+verifier、5 页 UI、E2E、证据 | real test/build + 真实可交互 demo |
| M2 主动性 | 视剩余时间 | 规则评分、去重/冷却、持久设置、fixture benchmark | 可解释排序、可测错误率 |
| M3 Browser | 不作为夜间目标 | Playwright localhost-only browser adapter、审批恢复 | 外部动作无越权，trace 可重放 |
| M4 Panels/Skills | 非今夜目标 | PanelSpec renderer、Skills candidate learning | DSL 不执行任意代码，审查可追溯 |

## 任务 ID & 依赖
权威、细粒度定义在 `tasks/manifest.json`。下面是分组导航：
- M0-T01 环境与仓库；M0-T02 Schema；M0-T03 Policy；M0-T04 DB；M0-T05 Fixture/Test。
- M1-T01 后端 API；M1-T02 事件与卡片；M1-T03 可验证 Mock Executor；M1-T04 UI Shell；M1-T05 Home；M1-T06 Chat；M1-T07 Projects；M1-T08 Activity/Settings；M1-T09 E2E 和 demo gate。
- M2-T01 规则排名；M2-T02 suppress/cooldown；M2-T03 可选 Hermes 能力探测。
- M3/M4 的后续开发任务含在文档，但不能跳 Gate 开始外部高风险操作。

## 计划交付文件（Agent 须按真实代码调整）
- 根 `package.json` scripts、`pnpm-workspace.yaml`、TS Strict config、pnpm lockfile。
- `apps/web`, `apps/server`, `packages/contracts/core/storage/connectors/agent-adapters/eval`。
- SQLite migrations、API handlers、契约类型、Mock events 与 executor、独立 verifier。
- Home/Chat/Projects/Activity/Settings 可访问路由、状态与交互。
- tests unit/integration/e2e/security（可执行）；Demo seed/reset 脚本。
- `handoff/*` 实测报告（命令、退出码、失败路径）、脱敏证据、开发日志与最终 git HEAD。

## 单任务“完成”的定义
- 代码与接口可构建；基本正常和失败测试已补；对本任务的验收语句有实际证据。
- 修改对应 `handoff/STATUS.md`（DONE, BLOCKED, PARTIAL 需严格区分）；`git commit` 只在完成一个可识别增量后；禁止提交 secrets/真实 DB。
- 未完成任务即使代码已写 90% 仍标 PARTIAL，避免让明早接手者误判。

## 支持并行的边界
- 可并行：视觉 UI shell、fixtures+qa 文档、非依赖核心的场景资源。
- 不可并行：Contracts schema 合同冲突、同一个 SQLite migration、权限实现、Run 状态机。
- 合并时主 agent 跑全量 typecheck/test/build；子 agent 只能建议完成，不能替代 Gate 负责人。
