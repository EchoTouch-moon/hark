# F1 串行集成证据

范围：把隔离开场提交 `c69ade2` cherry-pick 进当前 Core `c60279b`，保留已验读侧，不扩新功能。未推送。未启动 Host。未读真实私人目录，未调用模型或搜索。合成 provider/model 与合成收据不是真实 StepFun。

父会话审查原文未覆盖，仍在 `f1-parent-review.md`。

## 冲突处理

`git cherry-pick -n c69ade2`。代码文件自动合并，没有整文件 ours/theirs。

- `messages.rs`：读侧保留 `IoGate`、`admit_active_io`、`with_immediate_tx`、发布前再查授权；开场侧保留 run 绑定、取消/失败状态守卫和 `commit_opening_tx`。
- `workspace.rs`：保留物理 scope 比较；合入显式 provider/model 才可 enable，初读开关只写意向。
- `f1_disk.rs`：保留全部最新 scope/FIFO/预算/撤权测试；schema 断言改为 v2，开场 DTO 补 `runId`。没有为了变绿删旧负例。
- `db.rs`：只合入 v1→v2。`0001_init.sql` 无 diff。未把 I/O 准入搬进 `db.rs`，未改 WAL，未加通用权限表。
- `reader.rs` / `grant.rs` / `scan.rs` 无 diff。隔离分支 base 上的过期 Reader 没有进来。
- 状态文档有冲突，按集成后的事实重写，不采用任一侧过期结论。

## 联合场景

同一自建合成 Workspace：有效证据 → 明确 model 授权和 Core run → model 撤权后旧 receipt 拒绝且不折叠/不创建开场；取消、retry、重启后旧 run 仍拒绝；目录撤权后开场返回 `root_revoked`，`read_workspace_file` 与 `selective_key_read` 同样拒绝，历史摘录 `content_available=false`。测试名 `joint_workspace_aligns_source_revoke_with_opening_and_rejects_old_runs`。

## 命令

均 `set -o pipefail`。路径已脱敏。worktree 内 target。

| 命令 | 退出码 |
|---|---|
| `cargo fmt --manifest-path crates/hark-core/Cargo.toml -- --check` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |

结果：3 单元 + 32 磁盘 + 3 IPC + 8 开场（含 1 个联合场景），46 项 ok。磁盘 32 项仍包含别名重叠、FIFO、枚举预算、检查后撤权/暂停竞争。

## 前端与 Host 可消费 API

in-process `hark_core::Core`，serde camelCase。合同见 `contracts/ipc-v1.md` §5。`mark_analyzing` 发放 `activeRunId`。`commit_agent_opening` 必填该 `runId`。`success` 不是完成。业务 schema v2 只增加 opening-run 列。

Host 实际发送前必须再次检查目录与模型授权。本 Core 不发送。

## 未验证 / 未实现

- AT-05 父子排除、Windows 编译、真实模型、UI、整 R1：未通过。
- F2 工具白名单落地、ContextPack、session-ref、credential 槽：未实现。
- 开场写路径仍是延迟事务。与撤权重叠可能返回 SQLite busy，不是 `root_revoked`；busy 时不提交新开场。
- 已进入内核且不返回的单次 syscall 不能打断。
- 父会话尚未复跑本集成。这不是产品 PASS。
