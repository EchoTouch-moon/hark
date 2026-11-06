# 普通连续对话 Core 存储

隔离 worktree `/Users/v/new-idea/hark-r1-conversation-core`，分支 `dev/r1-conversation-core`，起点 `49fcfee`。自建合成临时目录和临时 SQLite。没有私人目录、密钥、模型或外发请求。

## 迁移

v1 `conversation_events.kind` CHECK 不能原位扩大。执行 `0003_conversation_run.sql` 前核对实际列、出站 FK（`workspaces` / `conversations`）、索引（`conversation_first_message_idem`、`idx_events_workspace`）、无入站 FK、无 trigger、无引用 view。不一致则拒绝且事务回滚，不 drop。复制行数和首消息索引在提交版本行之前复查。

只新增 `conversation_runs`。`request_id` 是 HarkBridge `requestId` 幂等键。`session_ref` 只存 `pi:<uuid>`，不存 Pi JSONL。开场幂等索引谓词未改。普通 `agent_message` 的 `generation` 为空，不能冒充 `agent_opening_message`。

## 命令

`CARGO_TARGET_DIR=/Users/v/new-idea/hark-r1-desktop/crates/hark-core/target`。主线 `/Users/v/new-idea/hark` 没有 `crates/hark-core/target`；同提交的 desktop worktree 有这份缓存，本轮无人并行编译 Core。Cargo `1.95.0`，rustc `1.95.0`。均 `--offline`。

第一次只跑新测试时，fmt check 未过，但 `cargo test --test conversation_run -- --test-threads=1` 退出码 **0**，5/5。随后全量 `cargo test` 在修格式后因单元测试编译失败退出 **101**：`with_conn` 未把 rusqlite 错误转成 `CoreError`，且 `unwrap_err` 要求 `Core: Debug`。已改成 `map_err` 和 `match`，没有改业务规则。

修复后：

| 命令 | 退出码 |
|---|---|
| `cargo fmt --manifest-path crates/hark-core/Cargo.toml` | 0 |
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |

全量结果：单元 5、`conversation_run` 5、`f1_disk` 32、`ipc_contract` 3、`opening_receipt` 10、doc-tests 0。合计 **55** 通过，0 失败。

新路径覆盖：两轮用户/助手重启按序恢复；同一 request/提交不重复；未注册不能当完成；取消/失败保留原文且无 `agent_message`；模型未启用/暂停/撤销、错模型、旧快照、目录暂停/恢复/撤销、跨 workspace、伪造 source；非空 v2 升级 v3 后原文、开场、卡片和首消息索引还在。普通寒暄 `source_ids` 为空。新 run 不改 onboarding，不折叠旧卡，不写第二条开场。

## 未做

- Native shell / Tauri / WebView 没有接线。对接点在 `docs/r1/CONVERSATION-HANDOFF.md`。
- 没有改 Pi Provider、SDK、Key、付费 HTTP 或验收脚本。
- 没有真实模型。Core 不开网络，提交结构没有 `success`。
- 没有改 `AGENTS.md` 或共享 `handoff/STATUS.md`。
