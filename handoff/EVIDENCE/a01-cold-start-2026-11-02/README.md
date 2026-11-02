# A-01 冷启动复审跟进证据

复审提交 `f6fcbcf197e85edc597375cea5754d9f77e69b9f`。本次只处理首次无会话读取，未修改 PATCH 防护或增加权限。全部运行使用合成数据和 Mock provider，路径及进程号已脱敏。

## 红→绿

- `cold-red-initial.txt` / `cold-red-context.md`：首次以旧实现运行新浏览器测试（exit 1），隔离服务 session 初始为 null，浏览器无 cookie 和站点存储；页面快照显示 `火候未知 / missing or invalid session UNAUTHORIZED`，找不到“去授权”。首次尝试阻断了其他 API。`cold-red.txt` 记录改良后的旧版红灯：让其他 API 正常工作，仅将 session 创建暂缓到首次 Hearth 响应，以稳定复现启动竞态；仍因找不到“去授权”而失败（exit 1）。
- `cold-green.txt`：修复后 3 项相关浏览器测试通过（exit 0）。其中冷启动用例记录真实顺序 401 → 会话 200 → 权限 ViewModel 403 → 一次带 CSRF 的权限 PUT 200 → Hearth GET 200；刷新后依然已授权，执行权限保持 false。
- `targeted-unit.txt`：26 项通过，覆盖精确 401 UNAUTHORIZED 一次恢复、其他 401、403/503 ViewModel、会话失败、取消及已有写请求重试安全。
- `code-review.md`：本轮内部代码核查，不代替最终独立安全复审。

## 全量本机结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm test` | exit 0；65 文件、555 项通过 | `unit.txt` |
| `pnpm typecheck` | exit 0 | `typecheck.txt` |
| `pnpm lint` | exit 0；0 错误、10 条既有警告 | `lint.txt` |
| `pnpm build` | exit 0 | `build.txt` |
| `E2E_PORT=4337 HEARTH_ANALYSIS_PROVIDER=mock HEARTH_PI_BIN=/nonexistent/live-provider-disabled pnpm test:e2e` | macOS，exit 0；28 项通过 | `e2e-macos.txt` |

首次全量浏览器尝试 `e2e-first-attempt.txt` 退出 1：内部复核的定向浏览器测试与全量测试同时启动，争用同一测试服务端口和数据库，后续出现连接拒绝；两组进程均结束后以独立端口串行重跑通过。该失败保留备查。Linux Mock E2E、Windows 和 ci-gate 以 PR 新 head 的 GitHub Actions 检查为准。

服务端 PATCH 的 CSRF/Origin 防护是单独后续项，应在添加 PATCH 写路由前完成；本批结果不构成完整 G1-A PASS，仍等待最终独立安全复审。
