# Hark R1 执行交接

F1 Core 已在本 worktree 本地实现并测试，等待主会话审查。不是产品验收完成。

- 提交将落在 `dev/r1-desktop`，起点 `afd11ec`。未推送。
- 代码：`crates/hark-core`，合同：`contracts/ipc-v1.md` 与 schema/examples。
- 命令：`cargo test --manifest-path crates/hark-core/Cargo.toml --offline` 通过（22 项）；`cargo check --offline --tests` 通过。
- 未验证：真实模型、真实私人目录、Windows 编译、Sidecar 进程、UI、AT-05 父子排除。
- 下一步：主会话审查后才能开始 Host seam。不要把 Mock 或本机测试写成 R1 PASS。
