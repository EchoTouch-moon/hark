# A-01 CSRF — 合成数据证据（2026-11-02）

基线 `bot/hearth-g0-contract@5bcbcfb447b26fb24e9cda0a923d6bd9093da239`，隔离工作区，未使用真实项目或真实模型。日志中的工作区路径和进程号已脱敏；临时测试令牌只是合成值。

## 红→绿与数据库状态

- `red-test.txt`：旧服务端运行 `pnpm exec vitest run apps/server/src/http/hearth.http.test.ts -t 'CSRF rejection'`，退出码 1；缺失及错误 CSRF 两项要求 403，实际均为 200。
- `backend-old-state.txt`：旧实现两个表征用例通过，缺失和错误 token 均返回 200，持久化权限从 `{observe:false,research:true,model:true}` 变为 `{observe:true,research:true,model:true}`；审计快照不变。
- `backend-fixed-state.txt`：修复后的同一表征，两种请求均返回 403，权限前后均为 `{observe:false,research:true,model:true}`，审计快照不变。正式回归测试进一步断言 `CSRF_DENIED`。
- 临时表征补丁以 Base64 保存于 `state-characterization.patch.b64`，可用 `python3 -m base64 -d state-characterization.patch.b64 > /tmp/a01-state.patch` 还原。旧版使用基线 HEAD 的 `app.ts`，命令 `pnpm exec vitest run apps/server/src/http/hearth.http.test.ts -t 'TEMP persisted evidence'`；修复版使用同一测试并设置 `A01_CHARACTERIZE_FIXED=1`。临时表征已从正式测试移除，正式拒绝回归保留。`old-write-test.txt` 是另一组旧版状态断言的输出。
- `backend-green.txt`：正式服务端测试 18/18 通过，涵盖合法授权和撤销、缺失/错误 token、非法/缺失 Origin、无效 session、严格请求体及 research/model 不变与 execute=false。
- `frontend-red.txt`：临时旧客户端测试 8 失败、5 通过；正式客户端回归见 `tests/unit/api-csrf.test.ts`。模拟凭据仅为测试值。

## 本机验证

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| `pnpm test` | exit 0；64 文件 / 545 项通过 | `unit.txt` |
| `pnpm typecheck` | exit 0 | `typecheck.txt` |
| `pnpm lint` | exit 0；0 错误，10 条既有警告，均不在本批改动文件 | `lint.txt` |
| `pnpm build` | exit 0；构建报告现有包体提示 | `build.txt` |
| `HEARTH_ANALYSIS_PROVIDER=mock HEARTH_PI_BIN=/nonexistent/live-provider-disabled pnpm test:e2e` | macOS，exit 0；27 项通过 | `e2e-macos.txt` |
| 定向真实服务 Mock 浏览器 | 2 项通过：首次取会话、授权后 GET、拒绝提示及仅一次写入 | `frontend-targeted-e2e.txt` |

`code-review.md` 为本批实现的内部代码核查，不替代要求的最终独立安全复审。Linux Mock E2E、Windows 和 `ci-gate` 须以本 PR 当前 head 对应的 GitHub Actions 结果为准；本地 macOS 测试不等同于 Linux 验证。A-01 不构成完整 G1-A PASS。
