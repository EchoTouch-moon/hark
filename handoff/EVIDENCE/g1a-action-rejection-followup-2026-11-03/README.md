# PR #34 复审 follow-up：P1-1 错误出口与 P1-2 演示资格

上游复审（head `a47057f`，base `6ef6fe00`）结论为 `TARGETED_FIX_ACCEPTED` +
`CONDITIONAL_PASS / HOLD_FOR_FOLLOWUP`，要求补两条最小负例：空用户历史的错误出口、
ID 前缀不构成演示授权。本轮只做这两项，**不扩展执行能力**，也没有触碰
ProjectSource/绑定、migration、cards/runs/SSE、Demo reset、PATCH CSRF 或真实执行器。

- 本轮修复提交：`8f029d0`
- 变更文件：`apps/web/src/features/chat.ts`、`apps/web/src/pages/ChatPage.tsx`、
  `tests/unit/chat-execute-action.test.ts`、`tests/e2e/action-rejection.spec.ts`
- 证据：本目录 `round3/`，全部为 `.txt`（仓库 `.gitignore` 忽略 `*.log`）。

## P1-1 · 两条助手消息、零条用户消息时错误被吞掉

原因：`showSeed` 在“无 user message、2 条及以上 assistant”时为 `false`，`hasUserMessage`
仍为 `false`；而 `loadError` 只在 seed 分支或 `loadError && hasUserMessage` 下绘制。于是
点击 Action 收到 403 后，占位被移除，但页面没有任何可见原因。

修复（`ChatPage.tsx`）：非 Seed 布局的错误出口改为 `loadError && !showSeed`，与是否存在
用户消息无关；seed 分支保持原有出口，两者互斥，不产生重复 `role=alert`。

红灯：`round3/e2e-p11-red.txt` — 新增用例 **1 failed / 5 passed**：

```
✘ 两条助手消息、零条用户消息时，403 仍以 role=alert 显示
Error: expect(locator).toHaveCount(expected) failed
Expected: 1
Received: 0
```

红灯截图 `round3/p11-grown-no-alert.png`：两条助手消息、Action 仍在，页面没有任何错误提示。

绿灯：`round3/e2e-p11-green.txt` — **6 passed**（新增用例断言 alert 恰好 1 个、无
“正在处理”占位、Action 仍可见）。

## P1-2 · `mock-` 前缀可取得演示资格，但文案只看 `action.demo`

原因：`isLocalDemoAction()` 接受 `demo === true` **或** `mock-`/`demo-` 前缀，而最终文案
（`finalSteps` 第三项、`resultText`）只判断 `action.demo`。因此
`{ id: 'mock-rebuild', label: '重新构建', demo: false }` 在离线时会被模拟成真实完成并落盘。

修复（`chat.ts`）：

- 演示资格收紧为**仅 `demo === true`**，ID 前缀不再代表权限；
- 进入 Mock 分支后，进度尾项与结果文案固定为演示口径，不再读取 `action.demo`
  （资格与标识来自同一条实际 fallback 路径）。

红灯：`round3/unit-p12-red.txt` — **2 failed / 13 passed**，直接复现未标注的完成文案：

```
AssertionError: promise resolved "{ message: …, mock: true }" instead of rejecting
+ "content": "「重新构建」已完成。"
+ "text": "「重新构建」已完成。"
```

绿灯：`round3/unit-p12-green.txt` — **15 passed**。新增覆盖：

- 网络失败、501 两种离线条件下，`demo:false` 的 `mock-rebuild` 均被拒绝且零本地写入；
- `demo:true` 的非前缀行动仍可模拟，结果文案必定包含“演示跑通了”，且不含“已完成。”。

## 全量验证（本机 macOS，2026-11-03，`8f029d0`）

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `pnpm test` | 0 | 68 文件 / **636 项** | `round3/unit-full.txt` |
| `pnpm typecheck` | 0 | 全仓 + web | `round3/typecheck.txt` |
| `pnpm lint` | 0 | **0 errors / 10 既有 warnings** | `round3/lint.txt` |
| `pnpm build` | 0 | web + server bundle | `round3/build.txt` |
| `E2E_PORT=4358 pnpm test:e2e` | 0 | **39 passed**（原 38 + 新增 1） | `round3/e2e-mock.txt` |

Windows 按既有 CI 只跑 typecheck/unit/build；本机未跨平台复跑浏览器用例。

## 证据索引（全部已入库）

| 文件 | 内容 |
|---|---|
| `round3/unit-p12-red.txt` | P1-2 修复前：2 failed / 13 passed，含假完成文案 |
| `round3/unit-p12-green.txt` | P1-2 修复后：15 passed |
| `round3/e2e-p11-red.txt` | P1-1 修复前：1 failed / 5 passed，alert 期望 1 实得 0 |
| `round3/p11-grown-no-alert.png` | P1-1 红灯截图：两条助手消息、无错误提示 |
| `round3/e2e-p11-green.txt` | P1-1 修复后：6 passed |
| `round3/unit-full.txt` / `typecheck.txt` / `lint.txt` / `build.txt` / `e2e-mock.txt` | 全量验证输出 |

前两轮证据见 [`../g1a-action-rejection-2026-11-03/README.md`](../g1a-action-rejection-2026-11-03/README.md)；
该 README 引用的 `.log` 已全部补为 `.txt`（原路径被 `.gitignore` 的 `*.log` 忽略而未入库）。

## 仍未处理（复审 P2，登记为后续独立项）

1. `chat.ts` 的 700ms 本地演示延时：`AbortSignal` 触发后仍会保存 progress/result；
   当前 ChatPage 不传 signal。需要“取消中途不落盘”的单测与实现。
2. `runAction` 把任何带 `data.message` 的 2xx 视为成功并收起 Action；若将来服务端改为
   `200 + result.ok=false`，需区分“业务失败消息”与“执行成功”。
3. 真 API 成功后 Action 的消费只存在于内存，刷新后服务端历史仍返回同一张卡；
   迟到响应也只是被 UI 丢弃，服务端无幂等/执行记录可查。留给 cards/runs 真实状态 Gate。

## 复放

```bash
cd /private/tmp/hark-g1a-scope
pnpm exec vitest run tests/unit/chat-execute-action.test.ts
E2E_PORT=4357 pnpm exec playwright test -c tests/e2e/playwright.config.ts action-rejection.spec.ts
pnpm test && pnpm typecheck && pnpm lint && pnpm build
E2E_PORT=4358 pnpm test:e2e
```
