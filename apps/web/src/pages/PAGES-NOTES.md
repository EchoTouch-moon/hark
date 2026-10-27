# PAGES-NOTES — M1-T07 / M1-T08 页面实现摘要

负责人：UI 工程师（Projects / Activity / Settings）。本文件仅记录本任务范围的事实与验证结果。

## 验证命令与结果

- 命令：`pnpm --filter @hearth/web typecheck`
- 结果：exit 0（2026-10-28）
- 备注：期间曾出现 2 个报错，均位于他人负责的 `src/components/ActionCard.tsx` 与
  `src/features/cards.ts`（把 run 态 `cancelled` 当作 CardStatus 使用），与本任务文件无关；
  对方修复后整包 typecheck 通过。本任务新增/修改的文件始终零报错。
- 按任务要求未执行 `vite build`（由主 agent 统一构建）。

## 文件清单（全部在允许边界内）

| 文件 | 说明 |
| --- | --- |
| `src/features/projects.ts` | projects 数据层：`fetchProjects` / `fetchProjectSnapshot` + CardStatus 中文标签与色调 |
| `src/features/runs.ts` | runs 数据层：`fetchRuns` / `fetchRunDetail` / `cancelRun` / `decideApproval` + Run 状态/verdict/失败类别标签、`formatDateTime`、终态判断复用 `isTerminalRunState` |
| `src/pages/ProjectsPage.tsx` + `.css` | U03 列表：项目磁贴（名称/描述来自 API），loading/error/empty 全覆盖 |
| `src/pages/ProjectDetailPage.tsx` + `.css` | U03 详情：项目目的 / 最近事件（occurredAt+summary+source.uri）/ 卡片（状态 badge）/ runs 历史（链接 `/activity/:runId`）；404 → ErrorState + 返回列表 |
| `src/pages/ActivityPage.tsx` + `.css` | U04：`/activity` runs 列表；`/activity/:runId` 详情（run 元信息、复制按钮、900ms 轮询至终态、取消+ConfirmDialog、ApprovalSheet、TaskTimeline、Evidence sha256 展示） |
| `src/components/TaskTimeline.tsx` | 按 sequence 渲染 RunStep；失败红、running 转圈（reduced-motion 降级） |
| `src/components/ApprovalSheet.tsx` | 审批面板：动作类型/目标/风险/脱敏参数 JSON/有效期说明；默认焦点「拒绝」；409 → 提示并刷新 |

（TaskTimeline / ApprovalSheet 的样式集中放在 `ActivityPage.css`，因组件文件边界仅限 `*.tsx`。）

## 关键实现决策

- 数据隔离：项目详情全部来自 `GET /projects/:id`（服务端隔离），前端不做跨项目过滤伪装。
- 轮询：非终态每 900ms 静默刷新（`isTerminalRunState` 判断，覆盖 `pending_verification`）；
  终态后不再发请求；轮询瞬时失败保留旧数据下一轮重试。
- 审批：`POST /approvals/:runId`；409 时提示「状态已变化」并立即重取详情；非 409 错误如实展示 message。
- 取消：`POST /runs/:id/cancel`，ConfirmDialog 二次确认；终态时按钮禁用并在旁边/`title`/`aria-describedby` 说明原因。
- Settings：`GET /health`（含 contractVersion）+ `GET /settings` 并行加载；PUT 前做 HH:mm / 1..10 / 时区非空的客户端校验；400 时直接显示服务端 `error.message`；Demo 重置按钮仅 demoMode 可用（禁用+原因），ConfirmDialog danger 明确「只清空 demo DB，不碰真实文件」。
- 数据源区：fixture 标「已启用 · 仅合成数据」；github/calendar/mail/vault 全部 OFF 且标注「未接入」。
- 无障碍：每个输入都有 `htmlFor` 关联 label；复制按钮有动态 `aria-label`；徽标/状态用文本而非纯颜色；1280 宽无水平滚动（grid `minmax(0,…)` + `overflow-wrap:anywhere`）。

## 已知边界 / 未尽事项

- `features/api/types.ts` 的 `RunDetail` 缺 `card` 字段、`SettingsDto` 缺 `timezone`（该文件不在本任务边界内，不可改），故在 `features/runs.ts` 与 `SettingsPage.tsx` 内定义完整响应类型。
- 复制按钮对非安全上下文保留 `execCommand('copy')` 兜底。
- 未做 SSE（`/runs/:id/stream`）接入，按任务要求使用 900ms 轮询；SSE 可作后续增强。
- `docs/02-U03` 中的「当前 milestone / Artifacts」字段后端快照暂未提供，未伪造展示。
