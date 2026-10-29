# 前端交接 · Style Bible v6 Ember Seed + v6.1 Craft（2026-10-29）

执行角色：前端。总工已开闸。**未 commit / 未 push。**（后续提交走新分支如 `grok-bot/…`，本拍仍不推。）

## 本拍结论

已把 `apps/web` 空态从 QuietEmpty 翻成 **炉心 Seed**；并按 v6 验收 fail 修了 **Seed vs grown 判定** 与 **断网空态**。顶栏聊天|项目、≤1 卡/≤2 chip、炉温三档、玻璃 Composer、CSS 分层焰未回退。G1–G4 真 API 优先逻辑保持。

火焰用 **CSS 分层 widget**（外焰+内芯+煤底+aura）。`v6b-flame-*.png` 是整页关键帧对照，**不是**贴图，勿换成 `<img>`。

## 改了什么

| 区域 | 文件 |
|---|---|
| 炉温启发式 | `apps/web/src/features/emberHeat.ts`（新） |
| Token / 气场 | `apps/web/src/styles/tokens.css`, `styles/global.css` |
| 壳 · 顶栏分段 | `apps/web/src/app/AppShell.tsx`, `AppShell.css` |
| 画布 · Seed/炉温 | `apps/web/src/pages/ChatPage.tsx`, `ChatPage.css` |

未改：`features/chat.ts` / `threads.ts` 契约（后端空历史 proactive→null 由后端挡；前端仍按用户消息判定）；不落库 `emberHeat`。

## Seed vs grown（合同 · 验收 blocker 修复）

**判定以「有无用户消息」为准，不以 `messages.length` 为准。**

| 布局 | 条件 | Composer | DOM |
|---|---|---|---|
| **Seed** | 无 `role === 'user'`；允许 ≤1 张助手主动卡（无 progress/result） | **居中**（`.ember-seed__composer-slot`） | `.canvas-page--seed` + `.ember-seed`（问候+焰+chip） |
| **grown** | 已有用户消息；或助手侧已出现 progress/result；或 >1 条助手消息 | **底栏**（`.composer-dock`，360ms） | `.canvas-page--grown` + `.chat-list` |

补充：

- G3 proactive **不得**单独把壳切成 grown。主动卡叠在 Seed 下方（`.ember-seed__tap`），Composer 仍居中。
- 后端约定：空历史（无用户消息）proactive 返 `null`——前后端双挡。前端即使仍收到建议，也只旁挂、不切 grown。
- **网络/API 失败**：不再整页 `ErrorState` 替换炉心；仍渲染 Seed + 行内轻提示（可重试）。
- 首条用户发送（乐观更新立刻带 `role: user`）→ 立刻 grown，Composer 落底动画。

## 炉温判定（一句话 + 公式）

**本会话已发送 → 旺；否则看 `max(thread.updatedAt, localStorage lastInteraction)`：≤24h 旺 · 1–7d 温 · >7d/无记录 黯。**

| 档 | heat | 触发 | 空态文案 |
|---|---|---|---|
| 旺 | `0.9` / `0.85` | `sessionStorage hearth.ember.sessionSent.v6.{threadId}` 或 24h 内互动 | 「火正旺。」 |
| 温 | `0.52` | 1–7 天内有互动、本会话未聊 | 「炉还温着。」 |
| 黯 | `0.12` / `0.15` | >7 天 / 新装未聊 | 「余烬还在。」+「吹一口气，火会回来。」 |

字段：

- 会话发送：`sessionStorage` `hearth.ember.sessionSent.v6.{id}`（关页即失）
- 本地互动：`localStorage` `hearth.ember.lastInteraction.v6` → `{ [threadId]: iso }`
- 远端近似：`ThreadSummary.updatedAt`
- CSS：`documentElement --ember-heat` + `--ember-cool-factor`；过渡 **500ms**

## 如何复验两处 fail（给测试）

前置：`pnpm --filter @hearth/web dev` → `http://127.0.0.1:5173/`。

### Fail 1 · 空态 Seed

1. **新线程 / 无用户消息**：应见 `.ember-seed`、衬线问候（如「余烬还在。」/「火正旺。」）、居中玻璃 Composer、焰、≤2 chip。`canvas-page--grown` **不应**出现。
2. 若 API 仍下发 G3 主动建议：Seed **仍在**；卡在 Seed 下方轻敲（`.ember-seed__tap`），Composer **不**钉底。
3. **停 API** 硬刷新：仍应出 Seed（可带行内错误+重试），**不是**整页网络错误屏。

### Fail 2 · 中心→底

1. 空态确认 Composer 在 `.ember-seed__composer-slot`（居中），**无** `.composer-dock`。
2. 发首条用户消息 → 出现 `.chat-list` + `.composer-dock`（约 360ms），`canvas-page--grown`。
3. 消息列上长、输入落底；旁有小火焰标。

### 回归（勿回退）

顶栏聊天|项目；≤1 卡/≤2 chip；炉温三档（mock `updatedAt`）；玻璃井 + CSS 分层焰。

## 本地校验

- `pnpm --filter @hearth/web typecheck` ✅
- `pnpm --filter @hearth/web build` ✅

## 已知缺口

- `v6b-flame-*.png` = 整页对照；CSS 分层焰是正确落地，**勿**换 `<img>`。
- 用户气泡仍靠乐观更新（刷新靠 history）——沿用 v2。
- `/projects` 等调试页仍在；日常顶栏「项目」= 线程列表 pane。
- G4 仍是同线程演示闭环；真洞察未做。
- 未 commit / 未 push；日后走 `grok-bot/…` 新分支。

## 建议

叫 **@测试** 按上表复验 Fail 1/2；其余 must 回归抽查。后端空历史 proactive→null 落地后可再对一次真 API 新线程。
