# D-01 追加修复 · 本地验证

在隔离工作树、`daf03e144dba06be5a5454c7b65e6593a64136f0` 基础上的本次源码修改运行；macOS / Node 22.23.2 / pnpm 11.9.0，使用合成项目、隔离 SQLite 与 Mock Provider。未访问真实私人项目或调用真实模型。

| 检查 | 结果 | 输出（仅去除行尾空白） |
| --- | --- | --- |
| 启动 / 安全 / 存储定向测试 | 49 passed，退出码 0 | `focused.txt` |
| 全量 unit / integration | 62 个文件、522 passed，退出码 0 | `unit.txt` |
| `pnpm typecheck` | 退出码 0 | `typecheck.txt` |
| `pnpm lint` | 退出码 0，0 errors / 11 warnings | `lint.txt` |
| `pnpm build` | 退出码 0；前端 chunk 大小警告 | `build.txt` |
| `pnpm test:e2e` | macOS / Mock Chromium，25 passed，退出码 0 | `e2e-macos.txt` |

旧 PR head `daf03e14` 的 Linux、Windows 和 ci-gate 已在 [run 41324943166](https://github.com/EchoTouch-moon/hark/actions/runs/41324943166) 通过；它不是本次追加提交的验收。新 head 的 Linux E2E、Windows 和 ci-gate 结果以 [PR checks](https://github.com/EchoTouch-moon/hark/pull/29/checks) 的对应提交为准。

Demo reset 对没有可信归属的数据全部拒绝；含种子数据的纯 Demo 库也暂不能 reset，只有待清理表为空时成功且不删除数据。审计记录不会被清除。此修复不宣称完整 G1-A 或真实产品数据已通过安全验收。
