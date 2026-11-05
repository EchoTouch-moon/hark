# Hark R1 执行交接

F1 Core 仍未产品放行，Host 未启动。本段只把已提交的开场 run seam 串行合入当前读侧 Core。

- 分支 `dev/r1-desktop`，未推送。集成起点 `c60279b`。开场候选 `c69ade2`（隔离分支 `dev/r1-opening-receipt`，base `55ce323`）已 cherry-pick，不合并该 base 上的过期 Reader。
- 冲突只在状态文档。`messages.rs`、`workspace.rs`、`f1_disk.rs`、`db.rs` 按函数保留两边：读侧 `IoGate`/`admit_active_io`/`with_immediate_tx`，开场侧 run/schema v2。没有整文件 ours/theirs。
- 审查 #1–#5 在本机联合回归后标 resolved-local。AT-05、Windows、真实模型、UI、整 R1 未通过。
- 证据：`handoff/EVIDENCE/r1/f1-core-integrated.md`。父会话审查原文仍在 `f1-parent-review.md`。
- F2 仍 blocked：缺工具白名单落地、ContextPack、session-ref、credential 槽。前端/Host 可消费 API 见 `contracts/ipc-v1.md` §5。实际发送前必须二次检查授权。
