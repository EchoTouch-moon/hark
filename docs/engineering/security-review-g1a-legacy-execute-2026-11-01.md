# D-01 安全审查材料：legacy 执行路径 fail-closed（2026-11-01）

> 分支：`ops/security-g1a-legacy-execute-disabled`（**本地，未推送**）
> 基：`bot/hearth-g0-contract` @ `4fd0480b`（来源提交 `5c0a9101`，cherry-pick 自 `codex/project-first-conversation`）
> 状态：**待人工安全评审**。未推送、未合并、未与 G2 混在同一 PR。

## 0. 一句话

把 Hearth 里「客户端可伪造的旧模拟执行通道」从默认可用改为**默认关闭**，只允许在显式 opt-in 的隔离测试环境里打开；同时收紧 `demoMode` 的判定，防止「任何非 '0' 值」误开演示模式。

## 1. 为什么要做（问题本身，已逐行核对）

三条线对该端点的状态（`git grep "actionId/execute"`）：

| 线 | `POST /api/v1/threads/:id/actions/:actionId/execute` |
| --- | --- |
| `master` | **未注册** |
| `bot/hearth-g0-contract`（改动前） | **活的 handler**：`threads.ts:239` 会走到 `deps.storage` 与状态机 |
| 本分支 | 硬 **403 `LEGACY_ACTIONS_DISABLED`** |

来源提交是否已在任何主线：`git merge-base --is-ancestor 5c0a9101 origin/bot/hearth-g0-contract` → **NO**；`master` 同样 NO。

这就是交接包 §5 / #12 里记录为「仍未通过」的 **legacy execute/approval 可达**风险。它不在 master、不在 G0，只在这条旁支上被修掉了。

## 2. 实际改动清单（读代码，非看提交信息）

| 文件 | 改动 | 安全意义 |
| --- | --- | --- |
| `apps/server/src/http/routes/threads.ts` | `execute` 处理器整体替换为 403 stub；删除约 298 行旧执行逻辑 | 客户端提供的 demo 标签不能建立 mode/scope/completion |
| `apps/server/src/http/routes/legacy-chat.ts` | 新增 `isUnsafeLegacyMessage()`：识别 `proactive-*` / `progress-\d+` / `result-\d+` | 区分「来源/完成状态不可信的旧消息」，只判不删 |
| `apps/server/src/http/routes/chat.ts` | 在两处（历史与模型上下文）过滤不安全旧消息 | 旧消息留在存储，但**不得重放进聊天或模型上下文** |
| `apps/server/src/http/routes/threads.ts` | `safePreview` 用同一守卫 | 预览同样不回显不可信消息 |
| `apps/server/src/http/routes/cards.ts`、`core.ts`、`projects.ts`、`runs.ts`、`legacy-demo.ts` | 隔离 legacy demo 路由与执行 | 把旧 demo 面收敛到显式命名空间 |
| `packages/core/src/orchestration/orchestrator.ts` | `executeCard` / `decideApproval` 首行加 `if (!legacyExecutionEnabled) throw LegacyActionsDisabledError()`；新增 `allowLegacyExecution` 为**测试专用 opt-in** | 编排器层兜底：即使路由漏网，执行入口本身也拒绝 |
| `apps/server/src/config.ts` | `demoMode` 判定从 `!== '0'` 收紧为 `=== '1'`；追加 `typeof !== 'boolean'` 断言 | **fail-closed 默认**：任何非精确 `'1'` 都不再误开演示模式 |
| `packages/agent-adapters/src/mock-adapter.ts` | 文案：不再声称「行动会留在本线程闭环」，改为「旧主动建议和执行操作暂不可用」 | 演示自证：不暗示存在真实执行闭环 |
| `apps/server/src/http/g1a-security.test.ts`（新增 214 行） | 20 个动态断言 | 见 §3 |
| `apps/server/src/http/g1a-live.test.ts`（新增 65 行） | 实时模式回归 | 见 §3 |

## 3. 动态测试证据（已在本分支实跑，非纸面声明）

`apps/server/src/http/g1a-security.test.ts` 覆盖三个模式（`false` / `true` / `unknown`），关键断言：

```ts
const result = await app.inject({
  method: 'POST',
  url: '/api/v1/threads/thread-a/actions/forged/execute',
  headers,
  payload: { action: { id: 'forged', label: '执行', needsConfirm: false, demo } },
});
expect(result.statusCode).toBe(403);
expect(JSON.stringify(result.json())).not.toContain('已完成');   // 不得伪造「已完成」
// …以及卡片执行、审批决策的 403，并用 spy 证明 executeCard / decideApproval 从未被调用
expect(execute).not.toHaveBeenCalled();
expect(approve).not.toHaveBeenCalled();
```

实跑结果（本会话，证据 `handoff/EVIDENCE/g1a-security-preparation.txt`）：

| 项 | 结果 |
| --- | --- |
| `vitest run apps/server/src/http/g1a-security.test.ts` | **20 passed (20)** |
| `pnpm typecheck` | 0 错误 |
| `pnpm lint` | 0 error；11 条 warning 全为既有，本分支新增文件零告警 |
| `pnpm test`（全量） | **59 文件 / 485 passed / 1 skipped / 0 failed** |

## 4. 冲突解决记录

cherry-pick 仅两个文件冲突，都是**活状态文档**，均取 G0 线当前版本：

- `handoff/MORNING-REPORT.md` → 保留 G0 当前内容（`--ours`）
- `handoff/STATUS.md` → 保留 G0 当前内容（`--ours`）

理由：不该让一条落后 53 个提交的旁支把更新在后的状态记录覆盖掉。

## 5. 仍未完成、必须由人完成的部分

1. **人工安全评审**。改动的是 action 执行面与运行模式判定，不是 CI 或文档。
2. **确认无在用功能依赖该端点或 demo 模式宽松判定**。尤其 `demoMode` 收紧后，任何依赖 `HEARTH_DEMO='true'`/`'yes'` 的脚本都会失效——需要排查。
3. **回滚不免费**。`git revert` 会恢复「活端点 + 宽松 demoMode」，因此回滚前必须主动确认业务侧确实还需要，而不是随手执行。
4. **合入前需 rebase**。当前分支相对最新 G0（`b2b70c27`）`ahead 2 / behind 3`（落后的是 #21 的 CI 三提交，不含应用源码，rebase 应无冲突，但需在合入时执行）。
5. **master 侧**：master 从未注册该端点，因此本修复对 master 是「无操作」；真正相关的是 S8 把执行面带到 master 之前，要确保它带的是 fail-closed 版本。

## 6. 边界

- 本分支**未推送**；`--unset-upstream` 已执行，裸 `git push` 会报错，避免误推进 G0 主线。
- 未与 G2 配置混在同一 PR；两者分属不同分支、不同文档。
- 未修改 `risk/approved/completed` 决策逻辑、未放宽审计、未新增外部副作用——本改动是**收紧**，不是放宽。
