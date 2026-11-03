# 前端交接 · 沉浸对话画布 v2（2026-10-29）

执行角色：前端。总工已开闸。**未 commit / 未 push。**

## 本拍结论

已把 `apps/web` 从「Mock 优先 + 探测」切到 **真 API 优先**；仅 404 / 501 / 网络失败才降级 localStorage Mock。真 API 可用时会清掉旧 Mock 注入，history 已有 `parts` 不再叠本地假行动。

对齐后端交接：`handoff/backend/v2-g1-g4-2026-10-29.md`。

## 改了什么

| 区域 | 文件 |
|---|---|
| CanvasShell / ThreadRail | `apps/web/src/app/AppShell.tsx`, `AppShell.css` |
| 路由 | `apps/web/src/app/routes.tsx`（`/t/:threadId`；cards/insights/activity/projects 留调试 URL） |
| 画布页 | `apps/web/src/pages/ChatPage.tsx`, `ChatPage.css` |
| ConfirmSheet | `apps/web/src/components/ConfirmSheet.tsx` + `.css`；`components/index.ts` |
| G1–G4 适配（本拍重点） | `apps/web/src/features/threads.ts`, `features/chat.ts` |
| 令牌 | `apps/web/src/styles/tokens.css` |

本拍相对上一交接的增量：

- `features/chat.ts`：`preferLiveApi` / `isLiveApi` / `clearStaleMockOverlay`；history 优先服务端 parts；live 下不 merge 旧 Mock 本地消息；proactive/execute 成功即 live；live 下 execute 失败不再伪造 Progress
- `AppShell.tsx`：`listThreads` 非 mock 时 `preferLiveApi()`
- `ChatPage.tsx`：live 下剥 actions 不再 `appendLocalMessage`

## 对接了哪些 API / 哪些仍 Mock

| 能力 | 状态 |
|---|---|
| G1 threads list/create | **真 API** `GET/POST /api/v1/threads`（list 非空 → live）；失败才 localStorage seed |
| G2 chat / history + parts | **真 API** `POST /api/v1/chat`、`GET /api/v1/chat/history`（`sessionId`≡`threadId`）；服务端 `parts` 原样用 |
| G3 proactive | **真 API** `GET /api/v1/threads/:id/proactive`；成功则清 `hearth.proactive.injected.*` |
| G4 action execute | **真 API** `POST /api/v1/threads/:id/actions/:actionId/execute` → 同线程 progress+result |
| G5 文案 | 跟后端；前端 Mock 降级文案仍不推「去 Home」、标明演示 |
| 降级 Mock | **仅** 真路由 404/501/网络失败（且尚未 live）时：空线程注入演示建议 + 本地 Progress |

## 如何清缓存（重看真 proactive）

DevTools → Application → Local Storage，删：

- `hearth.proactive.injected.*`
- `hearth.chat.localMsgs.v2`
- `hearth.chat.parts.v2`
- （可选）`hearth.threads.v2` — live 下 list 已走真 API，一般不用清

打开页若 `GET /api/v1/threads` 成功，前端会自动 `preferLiveApi()` 并清上述 Mock 叠层。

## 主路径怎么验

前置：API `:4317`、Web `pnpm --filter @hearth/web dev` → `http://127.0.0.1:5173/`。

1. 清上面 key 后硬刷新；侧栏应出现服务端线程（含 `日常` / 其它）；顶栏无「线程 Mock」灰点。
2. 打开 `thread-default`：应见服务端 proactive（有 proposed 卡则卡摘要 ≤3 行动；否则演示建议）；**不应**再出现旧的「mock-proactive-…」本地假条盖住。
3. Confirm → 批准 / 诊断 → 同线程 Progress+结果；再拉 proactive 应安静（或刷新后无新建议）。
4. 刷新：history 仍带 `parts`；行动结果仍在。
5. 发「你好」：reply 可含 parts；文案不推「去 Home」。
6. 关 API 再开页：应降级 Mock（空线程演示建议）；属预期。

curl（已对本机 `:4317` 跑通）：session → threads → proactive → execute → proactive `null` → history 含 parts。

## 给测试

对照 `handoff/qa/acceptance-checklist-v2-2026-10-29.md`。前后端已对齐真路由；可开测。只壳+Mock、无真路由 → blocked（本拍已接真 API）。

## 本地校验

- `pnpm --filter @hearth/web typecheck` ✅
- `pnpm --filter @hearth/web build` ✅
- curl G1–G4 主路径 ✅（API `:4317`）

## 已知缺口

- G4 服务端仍是同线程演示闭环文案，未接真实 approvals/runs SSE。
- 真洞察 / G6 未做。
- 服务端 chat 仍主要回 assistant；用户气泡靠乐观更新（刷新后靠 history）。
- Detail Drawer 插槽保留但画布默认不用。
- `/projects` 等仍是调试页。
- 未 commit / 未 push。
