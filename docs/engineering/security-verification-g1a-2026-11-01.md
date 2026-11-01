# D-01 安全修复 · 四点核实结果（2026-11-01）

> 分支：`ops/security-g1a-legacy-execute-disabled`（本地，未推送）
> 依据：你点名的四个核实重点。结论均为**读代码 + 跑动态测试**得出，非提交信息背书。
> 状态：**核实通过，等待「推送 D-01」授权。**

## 核实点 1：`allowLegacyExecution` 不可被生产环境启用 —— ✅ 通过

- 定义：`packages/core/src/orchestration/orchestrator.ts:58`（`OrchestratorDeps.allowLegacyExecution?: boolean`），
  `legacyExecutionEnabled` 只在 `=== true` 时为真。
- **生产装配不启用**：唯一非测试构造点 `apps/server/src/main.ts:43` 的 `new Orchestrator({...})` 只传了
  `storage / artifactRoot / clock / stepDelayMs`，**不含** `allowLegacyExecution`。
- **全仓 `allowLegacyExecution: true` 只出现在 3 个测试文件**：
  `apps/server/src/http/app.test.ts:33`、`g1a-security.test.ts:157`、`packages/core/src/orchestration/orchestrator.test.ts:34`。
- 生产代码零引用（`git grep allowLegacyExecution | 排除 .test.ts 与 orchestrator.ts 定义` = 0）。
- `legacyDemoAllowed()` = `demoMode===true && legacyExecutionEnabled`，生产中 `legacyExecutionEnabled` 恒 false → 恒拒绝。

## 核实点 2：legacy execute 入口彻底失效 —— ✅ 通过（三重保险）

1. 路由层：`apps/server/src/http/routes/threads.ts:66` 的
   `POST /api/v1/threads/:id/actions/:actionId/execute` 直接返回 **403 `LEGACY_ACTIONS_DISABLED`**。
2. 编排器层：`orchestrator.executeCard` / `decideApproval` **首行**抛 `LegacyActionsDisabledError`（403）。
   即使路由漏网，执行入口本身拒绝。
3. legacy demo 面：`legacy-demo.ts` 的 `rejectLegacyDemo` 对 `projects / projects/:id / events` 等旧 demo 路由一律 403。

## 核实点 3：跨项目隔离无副作用 —— ✅ 通过

- `projects.ts` 新增的 `legacyDemoAllowed(deps)` 守卫在**访问 storage 之前**就 403，不产生任何跨项目读取。
- `chat.ts` 用 `isUnsafeLegacyMessage`（纯谓词）过滤 `proactive-* / progress-\d+ / result-\d+` 旧消息，
  使其**不进入聊天历史或模型上下文**——是收紧，不引入新的跨项目数据流。
- 未新增任何跨项目数据访问路径。

## 核实点 4：异常路径无副作用 —— ✅ 通过

- 所有 `rejectLegacyDemo` / `LegacyActionsDisabledError` 都在**任何写操作之前**返回/抛出。
- `isUnsafeLegacyMessage` 是只读谓词，无写。
- `config.ts` 把 `demoMode` 从 `!=='0'` 收紧为 `==='1'`（fail-closed 默认），并加 `typeof !== 'boolean'` 断言。

## 动态证据（本分支实跑）

| 项 | 结果 |
| --- | --- |
| `vitest run g1a-security.test.ts g1a-live.test.ts` | **21 passed**（20 安全 + 1 live） |
| `pnpm typecheck` | 0 错误 |
| 关键断言 | 端点 403、响应不得含「已完成」、spy 证明 `executeCard`/`decideApproval` 从未被触达 |

## 合入前还需一步

本分支相对当前 G0（`b2b70c27`）为 **ahead 3 / behind 3**（落后 #21 的 CI 三提交，无源码冲突）。
推送前需 rebase 到 `b2b70c27`，再由 G0 的 `ci-gate`（现在已 active + strict）跑全量验证。

## 状态

- 未推送、未合并、未与任何其他改动混在同一 PR。
- 只差你的「推送 D-01」授权；授权后我会：rebase → 推送 → 开独立安全 PR → 等 ci-gate 全量验证。
