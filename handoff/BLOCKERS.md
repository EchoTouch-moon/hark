# Hark R1 阻塞与验证条件

## F1 本机五项已串行合入，仍未产品放行

- Core 库与 IPC v1 合同已有本机 `cargo test` / `cargo check` 证据。早期 22 项记录见 `handoff/EVIDENCE/r1/f1-core-limits.md`。联合回归见 `handoff/EVIDENCE/r1/f1-core-integrated.md`。
- 主会话第一轮审查不放行的原文保留，不覆盖：`handoff/EVIDENCE/r1/f1-parent-review.md`。该文件记录的是审查当时的缺口，不是当前代码仍全部未修。
- Workflow `2742fe5d-687b-487c-a216-906d501096b6` 的 child `9a5b3d9c-5c22-463a-a925-a8780488b83b` 在 2400000ms 总时限后失败。失败后核验当时 HEAD 仍为 `9c79f81`，没有返工 diff。未消费的 follow-up 不能作为落实证据。
- #2 FIFO/特殊对象、#4 枚举预算：resolved-local。证据 `handoff/EVIDENCE/r1/f1-reader-fifo-budget.md`。当前 Core 保留这些测试。
- #1 物理别名重叠、#5 Workspace fd 绑定：resolved-local。证据 `handoff/EVIDENCE/r1/f1-scope-repair.md`。
- #5 检查成功后到 open/read 的准入窗口：resolved-local。证据 `handoff/EVIDENCE/r1/f1-revocation-admission.md`。读侧仍用 `IoGate` + `admit_active_io` / `with_immediate_tx`。
- #3 取消后开场收据：resolved-local。隔离提交 `c69ade2` 已 cherry-pick 进当前 Core，不带回该分支过期 Reader。证据 `handoff/EVIDENCE/r1/f1-opening-receipt.md` 与联合场景 `f1-core-integrated.md`。
- 上述五项是本机联合证据下的 resolved-local，不是父会话放行，也不是 F1 产品通过。
- 早期 workflow 未能启动 child 的记录保留在 Git 历史；与本次已运行 child 的超时区分。

## 仍阻塞或未验证

- AT-05 / 父子排除未实现。物理重叠拒绝不是排除流程。WS-OVERLAP-01 不得标通过。恢复条件仍是单独设计并测试排除、回滚和链接/别名。
- Windows 安全读未实现，源码 fail-closed。本机未安装/未编译 Windows target。恢复条件是 Windows 上的真实编译和目录负例。
- 真实私人项目读取、付费 StepFun/搜索调用：未授权，unverified。合成 provider/model 与合成收据不是真实 StepFun。恢复条件为用户指定合法目录、系统凭据机制与发送范围。
- UI 与整 R1 未通过。
- F2 Pi Host 未开始。SDK scout 已指出缺工具白名单落地、ContextPack、session-ref、credential 槽；本切片不实现它们。实际发送前 Host 必须再次检查当前目录与模型授权，不能从 Reader 或开场局部测试推导外发通过。
- 开场提交仍是延迟事务。与撤权写者重叠时可能返回 SQLite busy，而不是 `root_revoked`；busy 时不提交新开场。撤权已经返回之后，读侧与开场侧都拒绝。
- 已经进入内核且不返回的单次 `read`/`openat` 不能被打断。另一连接最多等到现有 `busy_timeout`（5 s）；超时是 SQLite busy，不是撤权成功。
- Pi JSONL、网页 Reader、FTS、记忆修订：未进入本切片。
- macOS security-scoped bookmark、安装包签名、托盘/退出回收：留给后续集成，本切片不声称完成。
- Bun/Node 分发选择：保留 PRD O-01 未决状态。
- 旧架构画布目标配置未迁入新 worktree。本轮只维护仓库内架构状态。
