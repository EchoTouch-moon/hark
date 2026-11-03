# PR #34 旧 Action 拒绝语义：第一、二轮修复证据

分支 `codex/g1a-thread-scope`；PR #34 的 base 是 `bot/hearth-g0-contract`，本批的
merge-base 为 `6ef6fe00c90545749f8beef25ac5753e13ccc8e9`（**不是** `codex/g0-preparation@5bcbcfb`）。
修复前的 head 为 `2f0f5e93`（CI run [41469896539](https://github.com/EchoTouch-moon/hark/actions/runs/41469896539) success）。

本批只处理复审 P1 的“服务端明确拒绝不得被前端改写成本地成功”。没有修改服务端拒绝行为，
没有触碰 ProjectSource/绑定、数据库 migration、cards/runs/SSE、Demo reset、PATCH CSRF、
真实执行器或模型调用。

> 第三轮复审 follow-up（P1-1 错误出口、P1-2 演示资格）的证据在
> [`../g1a-action-rejection-followup-2026-11-03/README.md`](../g1a-action-rejection-followup-2026-11-03/README.md)。
> 本目录记录的是 `9707137` / `7201a6d` 两轮的历史现场。

## 两轮提交

| 轮次 | 提交 | 范围 |
|---|---|---|
| 第一轮 | `9707137` | `apps/web/src/features/chat.ts` 的 `executeMessageAction()` + 对应单测 |
| 第二轮 | `7201a6d` | `apps/web/src/pages/ChatPage.tsx` 的行动执行状态机 + 浏览器回归 |

两轮分开提交，保留红→绿过程，未 squash。

## 第一轮：`executeMessageAction()` 把业务拒绝当离线

原实现 `catch { /* mock path */ }` 吞掉所有失败，只在 `liveApi === true` 时抛错。于是
“先进入离线 Mock、后端随后返回 403 `LEGACY_ACTIONS_DISABLED`”会被当作离线条件，写出
本地 progress 和「已完成」结果。

修复后：只有**网络失败（status 0）或 501 未实现**才算离线；401/403/404/409/500 等一律
原样抛出（保留状态码、错误码与服务端文案）；2xx 但没有 `message` 视为
`execute_empty_response`；离线路径也只对显式 `demo: true` 的行动开放，真实行动失败关闭。
（第一轮曾允许 `mock-`/`demo-` ID 前缀进入演示；第三轮按复审要求收紧为仅 `demo === true`。）

- 红灯：`round1-unit/unit-red.txt` — 在旧实现上 **11 failed / 1 passed (12)**，其中 403 分支
  直接产出「「重新构建」已完成。」。
- 绿灯：`round1-unit/unit-green.txt` — **12 passed**。
- 用例覆盖：401/403/409/500、404、2xx 空响应、live 会话拒绝、501/网络失败的演示正例、
  离线时的真实行动负例、live 会话断线不回退。

## 第二轮：`ChatPage` 提前持久化与失败占位

`runAction()` 原来的问题：

1. 在 `setMessages` 更新函数里调用 `appendLocalMessage()`——渲染期副作用，且在结果未知前
   就把“去掉 Action 的消息”写入本地 overlay；失败后卡片已被消费。
2. 失败时只 `setLoadError`，不撤掉本次 `progress-pending-*` 占位，界面停在“正在处理…”。
3. 迟到响应不判断当前线程，切换对话后仍会把错误写进新线程。

修复后：

- 状态更新保持纯函数；成功才收起来源消息的 Action，失败完全不动来源消息。
- 只有 `executeMessageAction` 返回 `mock: true`（明确离线演示）才补写本地记录；真 API
  结果交给服务端。
- 失败只删除本次占位，保留其他历史，并把服务端原因展示在既有错误条。
- 成功/失败都先比对 `currentThread`，切换线程后的迟到响应不进入新线程的 UI。

### 浏览器红灯（修复前，本轮最终用例）

`red/e2e-red.txt`：**3 failed / 2 passed**。

| 用例 | 红灯现象 | 截图 |
|---|---|---|
| 离线演示收到 403 | 卡在“正在处理「诊断」…”，无错误提示，Action 已消失，本地记录被改写成无 Action | `red/01-offline-403-stuck-progress.png` |
| 真实 API 会话里的 403 | 占位残留、Action 被提前消费 | `red/02-live-403-stuck-progress.png` |
| 切换线程后的迟到拒绝 | B 线程弹出 A 线程的 403 错误 | `red/03-late-rejection-leaks.png` |
| 501 / 网络失败的离线演示 | 通过（预期保留的演示边界） | — |

复现方式：把 `apps/web/src/pages/ChatPage.tsx` 还原到 `2f0f5e93` 后运行
`E2E_PORT=4355 pnpm exec playwright test -c tests/e2e/playwright.config.ts action-rejection.spec.ts`。

### 浏览器绿灯

`e2e-green.txt`：**5 passed**（`tests/e2e/action-rejection.spec.ts`）。

- `liveApi=false` + 403：错误可见、无占位、Action 保留、本地记录未被改写、无假结果。
- 真 API 会话 + 403：错误可见、无占位、Action 保留、`hearth.chat.localMsgs.v2` 不存在、
  同线程其他历史不丢。
- 501 与网络失败：仍生成明确标注「演示」的本地结果（不是真实执行）。
- 切换线程后的迟到 403：新线程不显示该错误、无占位、无假结果。

## 全量验证（本机 macOS，2026-11-03，`a47057f`）

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `pnpm test` | 0 | 68 文件 / **633 项** 通过 | `unit.txt` |
| `pnpm typecheck` | 0 | 全仓 + web | `typecheck.txt` |
| `pnpm lint` | 0 | **0 errors / 10 既有 warnings** | `lint.txt` |
| `pnpm build` | 0 | web + server bundle | `build.txt` |
| `E2E_PORT=4356 pnpm test:e2e` | 0 | **38 passed**（原 33 + 新增 5） | `e2e-mock.txt` |

Windows 只按既有 CI 配置跑 typecheck/unit/build，不跑浏览器 E2E；本机未跨平台复跑。

## 证据索引（全部已入库）

仓库 `.gitignore` 忽略 `*.log`，因此本目录所有原始输出统一使用 `.txt`。此前 README 引用的
`.log` 路径确实未入库，现已全部补齐并改为 `.txt`。

| 文件 | 内容 |
|---|---|
| `README.md` | 本文件 |
| `round1-unit/unit-red.txt` | 第一轮修复前：11 failed / 1 passed |
| `round1-unit/unit-green.txt` | 第一轮修复后：12 passed |
| `red/e2e-red.txt` | 第二轮修复前：3 failed / 2 passed |
| `red/01-offline-403-stuck-progress.png` | 红灯截图：占位卡死、无错误 |
| `red/02-live-403-stuck-progress.png` | 红灯截图：真 API 会话占位残留 |
| `red/03-late-rejection-leaks.png` | 红灯截图：迟到错误进入新线程 |
| `e2e-green.txt` | 第二轮修复后：5 passed |
| `unit.txt` / `typecheck.txt` / `lint.txt` / `build.txt` / `e2e-mock.txt` | 上述全量验证输出 |

## 已知限制（不在本批扩大范围）

1. **行动卡的服务端状态仍不存在**：真 API 执行成功只在内存里收起 Action；刷新后服务端历史
   仍会返回同一张卡。需要服务端 action/run 状态才能持久，属 cards/runs 后续 Gate。
2. ~~错误提示只在 seed 态或存在用户消息时显示~~：已在第三轮修复（非 Seed 布局统一错误出口，
   `loadError && !showSeed`），见 follow-up 证据。
3. **本地 overlay 只是展示缓存**，不是可信执行凭据；离线演示结果不能当真实执行记录。
4. **迟到响应只是被 UI 丢弃**：若将来 execute 接入真实副作用，仍需服务端幂等键与执行记录
   查询，不能只靠前端线程门闩。
5. 服务端仍恒定拒绝旧 Action（403 `LEGACY_ACTIONS_DISABLED`），本批未新增任何执行能力。
6. 未覆盖：ProjectSource/ThreadProjectBinding、多对多绑定、旧数据迁移、cards/runs/SSE、
   Demo reset、PATCH CSRF、E2E 多进程隔离。

## 复放

```bash
cd /private/tmp/hark-g1a-scope   # 或对应分支 worktree
pnpm exec vitest run tests/unit/chat-execute-action.test.ts
E2E_PORT=4355 pnpm exec playwright test -c tests/e2e/playwright.config.ts action-rejection.spec.ts
pnpm test && pnpm typecheck && pnpm lint && pnpm build
E2E_PORT=4356 pnpm test:e2e
```
