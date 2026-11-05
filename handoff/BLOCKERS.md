# Hark R1 阻塞与验证条件

## F1 已在本会话本地实现，仍未产品放行

- Core 库与 IPC v1 合同已有本机 `cargo test` / `cargo check` 证据，见 `handoff/EVIDENCE/r1/f1-core-limits.md`。
- 这不关闭 F1 产品验收。主会话尚未审查 diff。Host 与 Desktop 未开始。
- 早期 workflow 未能启动 child 的记录保留在 Git 历史。本次是新的 F1 writer，不是恢复一个不存在的 child session。

## 仍阻塞或未验证

- 父子排除未实现。重叠被拒绝，AT-05 / WS-OVERLAP-01 不得标通过。恢复条件是单独设计并测试排除、回滚和链接/别名，而不是把拒绝当成隔离。
- Windows 安全读未实现，源码 fail-closed。本机未安装/未编译 Windows target。恢复条件是 Windows 上的真实编译和目录负例。
- 真实私人项目读取、付费 StepFun/搜索调用：本轮未授权。恢复条件为用户指定合法目录、系统凭据机制与发送范围。
- Pi Host、真实 JSONL、Context Pack、网页 Reader、FTS、记忆修订：未进入本切片。
- macOS security-scoped bookmark、安装包签名、托盘/退出回收：留给后续集成，本切片不声称完成。
- Bun/Node 分发选择：保留 PRD O-01 未决状态。
- 旧架构画布目标配置未迁入新 worktree。本轮只维护仓库内架构状态。
