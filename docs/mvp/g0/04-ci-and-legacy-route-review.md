# G0 修订 · 旧接口边界与 CI 逐项分类

> 用户审阅结论 **CONDITIONAL_PASS**；这是代码和既有 CI 日志的静态审查，不是已完成的修复或动态安全验证。本修订只涉及文档，G1-A/B/C 尚未启动。CI 基线为 PR #6 head `4d08d465` 的 [run 40998662240](https://github.com/EchoTouch-moon/hark/actions/runs/40998662240)，其实际 checkout 是 GitHub 合并结果；本地提交尚未经用户独立验收。

## 一、旧服务端路径及 G1-A 处理合同

以下“要求”是待实现设计，不宣称现有代码已有该保护。代码按 `apps/server/src/http/routes/`、`apps/server/src/http/app.ts`、`apps/server/src/main.ts` 与 `packages/core/src/orchestration/` 审查；所有 `POST/PUT/DELETE` 仍需 session、Origin、CSRF、schema 及项目权限。

| 路由/入口 | 静态证据和可能副作用 | G1-A 服务端处置 / 必须断言 |
|---|---|---|
| `GET /api/v1/threads/:id/proactive` | `threads.ts` 使用未指定 projectId 的 proposed cards；`ensureThread`、`appendChat`、`updateThreadProactive`、`touchThread` 可写数据 | 改为只读且授权绑定/项目隔离；不存在的线程不能由 GET 创建。两项目、无绑定、跨项目猜测 ID、GET 前后各表及审计无变化；未动态证明此前利用范围。 |
| `POST /api/v1/threads/:id/actions/:actionId/execute` | `threads.ts` 接收客户端 action/demo，演示分支写线程与审计；`demo:false` 返回看似真实的“已完成”及 `ok:true` | 真实/未知模式在任何写入之前拒绝旧模拟执行；Demo 必须由服务端确认隔离数据和模式，不能信任客户端标签；绝不伪造真实完成。伪造 demo/risk、重复请求、并发和直接 URL 均不触发副作用。 |
| `POST /api/v1/cards/:id/execute` | `runs.ts` 无显式模式判断，调用 `orchestrator.executeCard`；`orchestrator.ts` 可创建 run 并执行 pipeline | MVP 真实/未知模式服务端拒绝旧执行；Demo 仅隔离合成 card/action/数据/产物根，且服务端独立校验。测试 L0/L1/L2、卡片伪造、幂等、race、恢复与 executor spy=0，不因“低风险”放行。 |
| `POST /api/v1/approvals/:runId` | `runs.ts` 调用 `decideApproval`，批准后持久化 grant 并进入 pipeline | 真实/未知模式拒绝以旧批准恢复/发起不允许动作，既有 run 和伪造 grant 不能绕过；Demo 限隔离合成数据，验证无 grant、无执行调用。允许只读查看历史。 |
| `POST /api/v1/runs/:id/cancel` 与重启恢复 | cancel 调用 orchestrator；`main.ts` 启动执行 `recoverInterrupted()`，源码注释说明不盲目重执行 | 必须审计恢复的每条分支和直接 service 调用；保留安全取消既有任务的能力但不能借 cancel/recovery 新启动工作。模拟执行中重启、撤销和注入旧 pending run，断言 executor=0；实际新合同尚未测试。 |
| `/api/v1/demo/seed`、`/api/v1/demo/reset`、`/api/v1/discover`、card dismiss/snooze | seed/reset 在 `core.ts` 有 demoMode 守卫；discover/卡片反馈在 `cards.ts` 可写本地状态 | 区分内部受控本地写与外部行动。测试真实/未知模式直接请求、持久库不混种或误删；discover 不得绕开新项目权限或触发执行。seed/reset 守卫存在不等同已验收。 |
| `/api/v1/observer/projects` 注册/扫描/启停/报告/删除 | `observer.ts` 这些路由改变观察配置/本地记录；观察扫描预期只读仓库 | 允许明确用户发起的登记、只读扫描、暂停和受控删除；不得执行用户仓库测试/脚本。检查 scope、路径、取消、删除 journal，保留权限和真实数据保护。 |
| `/api/v1/analysis/preview`、`/analysis/runs`、取消、反馈、privacy | `analysis.ts` 可发起当前 Pi Analysis，`engine/service.ts` 对非 Mock 要求匹配预览指纹和本地持久确认；不是自动开发执行器 | 不能将 ResearchPolicy 冒充该同意。现有显式、已预览的数据外发路径保留且不削弱；将来自动模型请求需另审接收方、数据范围和预算；无授权/不匹配 provider spy=0，取消可用。 |
| `POST /api/v1/chat`、`/threads`、`/insights/:id/*`、`PUT /settings` | 分别写内部消息/线程/反馈/设置；现有 chat 为 Mock | 只允许受控内部状态写入，不能伪装真实模型、改变授权或越过项目范围；验证持久化、CSRF、权限与 Mock 标识。 |

**入口审查完成条件**：所有注册路由和可从启动/后台触发的 orchestrator、provider、连接器调用构造调用图，对每条声明 data/effect、模式、项目、鉴权与取消方式，并用集成测试逐一验证。不能只列出以上三个典型端点就宣称所有绕行已关闭；不支持的或用途不明的能力默认禁用。未来确有人工发起真实执行的需求须独立方案、具体授权和安全验收，本 MVP 不提供该路径。

## 二、PR #6 的 11 项失败逐条分类

日志显示 unit/integration **438 passed**；浏览器 **11 passed、11 failed、3 did not run**。表内“首次失败”仅指出日志停在哪个断言；不能由首次定位失败反推出之后的安全/业务断言仍然正确。所有行当前为 **NOT FIXED / NOT RE-RUN**，三项未运行用例亦需查清并实际运行。

| # | CI 用例 | 首次失败及分类 | 后续处理与不可丢失的断言 |
|---|---|---|---|
| 1 | `hearth.spec.ts:130` Chat Mock | 未找到“离线演示/不连接模型”文字 | 处理欢迎及对话新入口；验证真实模式能力标识、Mock 回复、持久化和重启恢复，不得只改 locator 掩盖伪真。 |
| 2 | `insights.spec.ts:18` 项目/观察导航 | 未找到“发现与建议”链接 | 适配新导航；仍需从真实模式到项目、观察及真实数据读取并返回，不用 Demo 代替。 |
| 3 | `responsive-layout.spec.ts:4` 导航折叠 | 未找到“主导航” | 废弃具体旧侧栏宽度假设；保留键盘、可访问名称及桌面无横向溢出。本轮不新增手机设计。 |
| 4 | `responsive-layout.spec.ts:36` 导航尺寸 | 等待旧主导航超时 | 不再要求固定 200px 工作台；以新桌面布局验证 1280×800/1440×900 可读及可操作。 |
| 5 | `responsive-layout.spec.ts:74` 抽屉 | 未找到旧工作区详情按钮 | 定位新的按需详情入口；保留打开、关闭、Esc 与焦点恢复，不能删无障碍语义。 |
| 6 | `runtime-mode.spec.ts:3` unknown/real | 未找到“正在确认运行模式…” | 保留未知模式和真实模式对 Demo 的失败关闭；覆盖直达 URL **及服务端 API**、未获取到 health 时不可执行。现状未验证。 |
| 7 | `runtime-mode.spec.ts:34` invalid mode | 未找到“无法确认服务端运行模式，请重试。” | 用新错误 UI 验证非法/不可用模式不启用 Demo、明确重试后才能恢复；覆盖 API 和持久状态，无静默默认成功。 |
| 8 | `theme.spec.ts:3` 主题 | 旧“显示主题”组合框等待超时 | 以实际新设置入口测试主题选择、系统模式及重启持久；焦点与无空白抽屉检查不得移除。昼夜表达与用户工作状态无关。 |
| 9 | `workbench.spec.ts:64` 首页过滤 | 未找到“今日概览”标题 | 以对话焦点/项目绑定替代四区布局；保留项目过滤、刷新后恢复和其他项目不泄漏。 |
| 10 | `workbench.spec.ts:115` 观察时间线 | 旧导航“观察记录”超时 | 迁移到新项目/依据入口；仍验证真实观察事件、项目筛选、分页与来源。 |
| 11 | `workbench.spec.ts:142` Observer→Insight | 未找到旧首页“今日概览” | 保留由合成 JUnit 引发 Observer→Insight 的业务链、自动协调和不调用模型断言；将结果落点迁移到新界面，不称其真实 H1。 |

G1-A 优先修复模式隔离、项目边界、虚假完成及相应 E2E；依赖新项目绑定/新 UI 的其余断言分别纳入 G1-B/G4，迁移状态须逐项列明，不能把删除或 skip 计为通过。相关完整 CI 必须在允许的后续阶段重新运行并记录 commit、日志及未运行项。

## 三、审阅状态与未决问题

- G0：原版架构方向获 CONDITIONAL_PASS；本次修订完成后需再次审阅。用户审阅的是此前提供的文档及远端基线，并未独立复验本地 `94a8575`、本次新提交或局部测试日志。
- G1-A 及之后：**未启动**，需用户另行明确发起；本次不推送、不合并、不进行真实研究/模型调用。
- 需要后续具体决策：真实项目及授权范围；允许主题/边界、公开来源、检索周期和预算；模型接收方及私有数据范围；投递 claim 租约时长与可见性标准；G1-A 旧 action 子类型/历史 run 的具体冻结及数据保留；重启后的不确定状态恢复策略。
- 价值门禁：G2/G3 尽早用获授权的真实项目验证“用户未主动提出、但有价值的问题及独立研究”，但须真实获取来源、用户人工评估；目前 **NOT_MEASURED**，不能用 LLM 打分代替。
