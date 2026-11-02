# restricted 事件响应脱敏 · 验证记录

基线：G0 合并 PR #29 后的 `de31607cea23bc23b382a261122b289b8931d17c`。本次仅用合成事件、隔离 SQLite，macOS / Node 22.23.2 / pnpm 11.9.0，未访问真实私人目录或调用真实模型。

- `red-before.txt`：在旧代码上运行新 HTTP 测试，`/events` 通过，`/projects/:id` 和 `/cards/:id` 因返回 restricted `payloadRef` 各失败一次；测试字符串均为合成数据。
- `focused.txt`：三个真实路由及既有安全/HTTP 回归共 44 项通过，退出码 0；包含 public/personal 和无引用、其他项目、缺失事件、存储原值验证。
- `unit.txt`：全量 63 个文件、525 项通过，退出码 0。
- `typecheck.txt`、`lint.txt`、`build.txt`：均退出码 0；lint 0 errors / 11 warnings，构建有 chunk 大小提示。

仅去除了日志的终端颜色和行尾空白。没有在本机重复运行浏览器测试；独立 PR 的 Linux Mock E2E、Windows 和 ci-gate 以对应 PR 的实时检查为准。G0 合并 PR #29 后的 [run 41379450079](https://github.com/EchoTouch-moon/hark/actions/runs/41379450079) 已通过，不代表本独立修复的 CI 已通过。

本次只对三条 API 返回的 Event 的 restricted `payloadRef` 进行响应投影；其余字段保留，存储原始值不变。此证据不构成完整 G1-A 或真实数据安全认证。Demo reset 的 API/前端语义和可信归属问题仍为单独后续项。
