# Hark R1 执行交接

F1 Core 仍未产品放行。Reader 小切片只修了 FIFO 阻塞和枚举预算/取消。

- 分支 `dev/r1-desktop`，未推送。
- 证据：`handoff/EVIDENCE/r1/f1-reader-fifo-budget.md`。`cargo test --offline` 与 `cargo check --offline --tests` 退出码 0。
- 仍未修、并继续阻塞 Host：#1 中间 symlink 重叠绕过，#3 取消后不同模型开场收据，#5 撤权复查与 Workspace fd 绑定。
- 未验证：真实模型、真实私人目录、Windows 编译、Sidecar、UI、AT-05。
