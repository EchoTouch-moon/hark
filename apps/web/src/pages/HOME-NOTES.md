# M1-T05 Home 卡片与 Evidence Drawer — 实现摘要

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @hearth/web typecheck` | exit 0（2026-10-28，tsc -p tsconfig.json --noEmit） |

> 未运行 `vite build`（按任务约定由主 agent 统一 build）；未 `git commit`、未安装依赖。

## 文件清单（均在本任务允许范围内）

- `apps/web/src/features/cards.ts` — 类型化 API hooks：`useCards` / `useCardDetail` /
  `useRunDetail` / `useProjects` / `useCardActions`（dismiss / snooze / execute /
  discover / seedDemo，全部返回 `ActionResult<T>`，不抛出）+ 状态与展示辅助
  （`isProactiveCard`、`formatRelativeTime`、`formatTtl`、`toSecondPrecisionIso`、
  `friendlyCardError`、`RUN_STATE_LABEL` 等）。
- `apps/web/src/components/ActionCard.tsx` / `ActionCard.css` — 建议卡片：标题、项目
  badge、whyNow、来源 uri（等宽小字）、相对时间、风险 badge（L0 灰 / L1 绿 / L2 橙 +
  「需批准」/ L3 红）、TTL；操作：查看证据（aria-expanded）、开始处理（L2 显示
  「请求批准」）、忽略（二次确认）、稍后（2 小时）；执行态视图 = 按钮禁用 + 原因
  title + run 状态条（终态给 `/activity/:runId` 链接、失败/阻塞给中文原因）。
- `apps/web/src/components/EvidenceDrawer.tsx` / `EvidenceDrawer.css` — 页面内证据面板
  （嵌于卡片展开区，1280 视口可用；未用 AppShell Drawer 是因为该插槽 ≥1440 才显示）：
  evidence SourceRef 列表、关联 events 摘要、run 状态 / 步骤 / sha256；run 非终态时
  900ms 轮询。
- `apps/web/src/pages/HomePage.tsx` / `HomePage.css` — Home 编排：主动建议区最多 3 张
  （proposed / snoozed 到期 / awaiting_approval / executing / verifying；本会话执行过的
  卡终态后仍钉住展示），其余折叠为「查看全部」；进行中卡片每 900ms 轮询
  `GET /cards/:id`，run 终态即停；终态卡首次加载回填 run.id（刷新后「查看 Run」
  链接仍可用）；状态矩阵：空态（重新扫描 + 首次空态初始化 Demo 数据→自动 discover）、
  API 失败（ErrorState 重试）、429 限频提示稍后；双击防抖（点击即禁用整卡按钮）。
  一切状态来自 API，不用 localStorage 存业务状态。

## 与后端合同的对齐点

- snooze `until` 为秒精度 ISO（服务端 zod 正则不接受毫秒），`toSecondPrecisionIso` 处理。
- `POST /cards/:id/execute` 202/200 两种成功都按 `{ run, card, alreadyRunning }` 处理。
- 410 `CARD_EXPIRED` → 卡上显示「卡片已过期，无法执行；请重新扫描」。
- `GET /cards` 无过滤参数取全量后在前端分组（dismissed 不展示）。

## 已知取舍 / 未尽事项

- 执行中卡片不支持在 Home 直接「取消」（`POST /runs/:id/cancel` 已有，但取消入口按
  UX 文档属于 Activity/Run 详情页任务，避免越界）。
- 审批面板（awaiting_approval 的批准/拒绝 UI）同属 Activity 任务；Home 仅展示
  「等待批准」状态并给出 Run 链接。
- 首次空态判定用 `GET /projects` 为空（合成库刚建好、未 seed）；projects 请求失败时
  不显示「初始化 Demo 数据」按钮，避免误导。
- 轮询期间的网络抖动作静默重试，不打断 UI；真实断连仍由卡片操作错误如实呈现。
