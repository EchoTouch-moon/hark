# Hark R1 阻塞与验证条件

## F1 已在本会话本地实现，仍未产品放行

- Core 库与 IPC v1 合同已有本机 `cargo test` / `cargo check` 证据，见 `handoff/EVIDENCE/r1/f1-core-limits.md`。
- 主会话第一轮审查不放行：已有 22 项回归复跑通过，但额外复现别名重叠绕过、FIFO 阻塞、取消后不同模型开场仍可提交；还发现枚举预算与运行中撤权/Workspace fd 复验缺口。见 `handoff/EVIDENCE/r1/f1-parent-review.md`。Host 与 Desktop 未开始。
- Workflow `2742fe5d-687b-487c-a216-906d501096b6` 的 child `9a5b3d9c-5c22-463a-a925-a8780488b83b` 在 2400000ms 总时限后失败。失败后核验当时 HEAD 仍为 `9c79f81`，没有返工 diff。未消费的 follow-up 不能作为落实证据。
- Reader 小切片已本地修复审查项 #2（FIFO/特殊对象阻塞）和 #4（枚举预算/取消）。证据：`handoff/EVIDENCE/r1/f1-reader-fifo-budget.md`。
- 目录 scope 小切片已本地修复审查项 #1（中间 symlink 物理嵌套）和 #5（Workspace fd 绑定与运行中撤权）。证据：`handoff/EVIDENCE/r1/f1-scope-repair.md`。这不是父会话放行，也不是 F1 产品通过。
- #3 `cancel_onboarding` 后不同 model 的开场收据仍可被接受。Host 继续阻塞在 #3，以及 #1/#5 尚未经父会话复跑。
- 早期 workflow 未能启动 child 的记录保留在 Git 历史；与本次已运行 child 的超时区分。

## 仍阻塞或未验证

- 父子排除未实现。#1 的别名绕过已在本地改为物理祖先拒绝，但拒绝不是排除流程。AT-05 / WS-OVERLAP-01 不得标通过。恢复条件仍是单独设计并测试排除、回滚和链接/别名。
- Windows 安全读未实现，源码 fail-closed。本机未安装/未编译 Windows target。恢复条件是 Windows 上的真实编译和目录负例。
- 真实私人项目读取、付费 StepFun/搜索调用：本轮未授权。恢复条件为用户指定合法目录、系统凭据机制与发送范围。
- Pi Host、真实 JSONL、Context Pack、网页 Reader、FTS、记忆修订：未进入本切片。
- macOS security-scoped bookmark、安装包签名、托盘/退出回收：留给后续集成，本切片不声称完成。
- Bun/Node 分发选择：保留 PRD O-01 未决状态。
- 旧架构画布目标配置未迁入新 worktree。本轮只维护仓库内架构状态。
