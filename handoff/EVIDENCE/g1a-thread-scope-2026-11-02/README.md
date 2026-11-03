# G1-A 线程与聊天作用域：本机证据

基线 `bot/hearth-g0-contract@6ef6fe00c90545749f8beef25ac5753e13ccc8e9`。用户明确选择可信绑定完成前暂关项目内聊天、保留全局对话；合同见 `docs/verification/g1a-thread-scope-contract-2026-11-02.md`。隔离 SQLite、合成数据及 Mock，未访问私人项目或真实模型；路径和进程号已脱敏。

## 红→绿与安全断言

- `red.txt`：旧代码上 19 项定向测试中 16 失败、3 通过，exit 1，覆盖不匹配/未知项目、旧项目线程、孤儿消息和别名冲突。`project-query-red.txt`：修复过程中补充的三个显式项目查询负例，在补查询保护前失败，exit 1。
- `targeted.txt`：最终服务端与前端定向 66 项通过。拒绝路径使用全部 SQLite 用户表的前后摘要对比，断言无 Mock chat 调用；全局正向、过滤先于分页、并发请求、重新打开数据库、旧数据原样保留和前端缓存保存失败等由测试源码断言。
- 项目聊天入口、旧非空项目线程和孤儿消息 fail-closed；全局无绑定线程继续可用。旧项目和孤儿数据不删除、不自动绑定；`sessionId/threadId` 冲突拒绝。
- `encoded-red.txt` / `encoded-green.txt`：内部复核发现合法全局深链重复编码，真实浏览器红→绿覆盖中文、空格和百分号；`frontend-review.md` 记录核查范围。
- 浏览器验证空列表与旧缓存 ID 冲突、服务端确认列表外的合法全局深链、项目拒绝无历史读取、切换时旧响应不能覆盖焦点。`e2e-targeted-attempt1.txt` 为测试初稿曾被欢迎页遮挡导致的失败；处理欢迎页后相关 4 项通过（`e2e-targeted.txt`）。

## 最终本机验证

| 命令 | 结果 | 证据 |
|---|---|---|
| `pnpm test` | exit 0，67 文件 / 621 项通过 | `unit.txt` |
| `pnpm typecheck` | exit 0 | `typecheck.txt` |
| `pnpm lint` | exit 0；0 错误，10 条既有警告 | `lint.txt` |
| `pnpm build` | exit 0 | `build.txt` |
| `E2E_PORT=4353 HEARTH_ANALYSIS_PROVIDER=mock HEARTH_PI_BIN=/nonexistent/live-provider-disabled pnpm test:e2e` | macOS，exit 0，33 项通过 | `e2e-macos.txt` |

Linux Mock E2E、Windows 和 ci-gate 以该批 PR 最新 head 的实际 GitHub 检查为准。当前不包含真实多项目可信绑定、cards/runs/SSE、Demo reset、完整恢复或完整 G1-A 认证；不开放执行/研究/模型权限，仍需独立安全复审。
