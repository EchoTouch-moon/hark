# Actual implementation decisions

> Agent 修改技术决策时，记录时间、任务、原计划、变更原因、对 Gate 的影响、引用测试/日志。规划合同不能静默更改。

| timestamp | task | decision | reason | consequence | evidence |
|---|---|---|---|---|---|
| 2026-10-28T03:15Z | M0-T01 | zod 固定 3.24.1（不用 ^3.25） | npm 镜像上的 zod@3.25.0 tarball 缺 dist/（损坏包），vite/node 均无法解析入口 | 无合同影响；API 为 v3 稳定面 | pnpm install 日志（handoff 会话记录）；contracts 32 tests |
| 2026-10-28T03:15Z | M0-T01 | SQLite 用 Node 22 内置 node:sqlite（DatabaseSync），不用 better-sqlite3 | 零原生依赖、零编译风险；WAL/busy_timeout/FK 均支持；experimental 警告可接受 | ADR-001；storage 13 tests 全过 | packages/storage/src/migrations.ts |
| 2026-10-28T03:20Z | M0-T02 | sha256/canonical 用纯 TS 实现于 contracts 包 | contracts 会被浏览器 bundle 引用，禁 node:crypto | 需对照 node:crypto 向量测试（已做，全过） | contracts.test.ts「sha256 matches node:crypto vectors」 |
| 2026-10-28T03:30Z | M0-T04 | ActionCard 合同无 cancelled 状态：run 取消后 card 回到 proposed | docs/04 CardStatus 枚举确实没有 cancelled；写 cancelled 会让 getCard 的 Zod 解析抛错（500） | orchestrator.cancel/updateCard 改为 proposed；重新执行受幂等键约束返回原 run | orchestrator 源码 + server cancel 测试 |
| 2026-10-28T03:45Z | M1-T03 | executeCard 默认异步推进（fire-and-forget pipeline），支持 awaitCompletion 供测试/E2E | UI 需要立即返回 run id 做进度展示；测试需要确定性终态 | API ?sync=1 参数；pipeline 异常全部写 audit | runs.ts 路由 + orchestrator |
| 2026-10-28T04:05Z | M1-T01 | 会话：单 principal；GET /auth/session 下发 HttpOnly SameSite=Strict cookie + csrfToken；写请求要求 Origin+x-csrf-token 双校验；无 Origin 的裸写一律 403 | docs/04 要求即使 localhost 也不能免 CSRF；浏览器 fetch 对 POST 恒带 Origin，curl 需显式 -H Origin | E2E/API 测试全部带 Origin；安全负例 4 条 | app.test.ts auth&boundary 8 tests |
| 2026-10-28T04:30Z | M1-T01 | auth preHandler 只守卫 /api/v1/*（静态页与 SPA fallback 公开） | 原 hook 对 '/' 也 401，页面无法加载 | 无安全弱化：数据面全在 /api/v1 | app.ts + E2E-11 |
| 2026-10-28T04:40Z | M1-T05 | client 任意 401（含 GET）都会重建会话并重试一次 | 首次加载时 GET /cards 先于会话建立，旧逻辑只救写请求 | 一次额外重试，无循环 | client.ts + E2E |
| 2026-10-28T05:05Z | M2-T02 | 用户显式触发的 POST /discover 绕过静默时段延迟（预算仍生效）；仅后台扫描受静默限制 | 集成 E2E 时发现凌晨运行被 quiet hours 拦住建卡——静默规则应约束“主动打扰”，不应挡用户明确指令 | discovery.discover({userInitiated}) 参数；API 层传 true | ADR-006；discovery 集成测试 + E2E-01 |
| 2026-10-28T05:10Z | M1-T09 | E2E 拓扑：Fastify 直接伺服 apps/web/dist（同源），不另起 vite preview | 消除跨源 cookie/CSRF 变量；与生产形态一致 | E2E 配置绝对路径 DB/静态目录（曾因相对路径落到 apps/server/data 造成跨 run 残留——已修并清理） | playwright.config.ts |
| 2026-10-28T05:15Z | M1-T09 | E2E-05/09/10 在 API/单元层断言，浏览器层不构造非法状态 | 过期卡/伪造 verifier/L2 篡改无法从 UI 诚实地制造；在服务端注入状态更真实 | 用例映射表写明覆盖层级 | m1-t09-e2e.txt |
| 2026-10-28T05:20Z | M1-T08 | SSE 端点已实现（/runs/:id/stream），但 UI 用 900ms 轮询消费 | 轮询实现更简单稳健（重连即最新快照），SSE 留给后续增强 | 无验收影响（docs 允许 polling fallback） | runs.ts + ActivityPage |
