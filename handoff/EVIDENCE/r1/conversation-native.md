# 普通聊天 Native 纵向接线

隔离 worktree `/Users/v/new-idea/hark-r1-conversation-native`，分支 `dev/r1-conversation-native`。起点 `3c6289a`。自建合成临时目录、临时 SQLite、显式 scripted transport。没有私人目录、真实 Key、真实模型、sudo、Docker 或 push。

这不是 StepFun，不是安装包，也没有跑 Native 点击。scripted transport 不能写成真实模型。

## 接线

WebView 只增加 `start_agent_turn`、`get_agent_turn`、`cancel_agent_turn`。入参是 `requestId/workspaceId/conversationId/userPrompt`，查询和取消是 `workspaceId+runId`。前端适配器缓存 run 归属，满足 HarkBridge 只有 `runId` 的方法。Core `register` / `commit` / `success` / `provider` / `sessionRef` 不进 Tauri command。

`run.start` 使用 `purpose=conversation`，`userMessageId` 和 prompt 来自 Core 已存原文。近期历史包含普通 `agent_message`，当前 user 不重复注入。`sessionRef` 复用同 workspace 已有 Pi 官方会话；新 ref 存在当前普通 run，不写回 opening 绑定。Core 只加了 `latest_ordinary_session` 查询，没有新 migration 或表。

进度是纯 Rust `TurnProgress` callback。Tauri 用该次 invoke 的 `Channel` 承载已有 `RunStreamEvent`。Channel 在 invoke 前创建。只有 Core `commit_conversation_message` 成功才发 `run_completed` 且 `persistenceVerified=true`。提交错误先查 Core；查不到则 `persistence_unknown`，不把 candidate 当 done。取消和失败保留用户原文，不插助手。同一 `requestId` 不重复调用模型。

默认壳 `remote_model_transport` 仍是 `closed_no_approved_key`。`stepFunConfigured` 因此保持 false，Composer 发送键保持关闭。Sidecar 未连接时命令诚实失败，不伪造回复。没有模型配置 UI，没有新 Key 存储。

## 命令

`CARGO_TARGET_DIR=/Users/v/new-idea/hark-r1-desktop/apps/desktop/target` 给 Native/Tauri。Core 复用 `/Users/v/new-idea/hark-r1-desktop/crates/hark-core/target`。均 `--offline`。本 worktree 先 `npm ci --ignore-scripts`。Node `v22.23.2` 可用；Cargo `1.95.0`。

| 命令 | 结果 |
|---|---|
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 通过。单元 5、`conversation_run` 6、`f1_disk` 32、`ipc_contract` 3、`opening_receipt` 10。合计 56，含新的 session helper。 |
| `cargo test --manifest-path apps/desktop/Cargo.toml -p hark-native-shell --offline -- --test-threads=1` | 通过。单元 2、`bridge_probe` 6、`flow` 9。原先 16 项仍在，新加 1 项 scripted 普通回合。 |
| `cargo check --manifest-path apps/desktop/Cargo.toml -p hark-desktop --offline` | 通过。Tauri 三个薄命令可编译。 |
| `cargo fmt --all -- --check`（Core 与 desktop manifest） | 通过。 |
| `npm run typecheck`、`npm run typecheck:ui`、`npm run test:ui`、`npm run test:host` | 通过。UI 23，Host 14。 |

## 实际集成

`ordinary_turns_use_scripted_transport_not_a_real_model` 使用真实 Core、真实 Node 进程和锁版 Pi SDK stdio。模型传输是显式 scripted JSON，不是 StepFun。

stdout：

```text
CONVERSATION_EVIDENCE {"transport":"scripted","stepFun":"unverified","openingRun":"run_57c9777e82ee488f949d4dcc8dad83e8","sessionRef":"pi:01a1afb9-0c9e-743a-a505-897729274ab3","userMessages":3,"agentMessages":2,"realModel":false}
```

覆盖：先走既有 opening；两轮普通聊天按序出现 `run_started`、`text_delta`、`run_completed/persistenceVerified=true`；Core 保存 user 与 `agent_message`，source ids 为空；第二轮复用同一 `pi:` session，opening 绑定的 run 没被普通 run 覆盖；同一 request 重放不增加 scripted 调用、不重复消息；取消一轮保留用户原文且不插助手；停掉 sidecar 后重开 SQLite，消息 id 和条数不变。既有 opening 回归在同一套 Native 测试里通过。

## 未做

- 没有 Native 窗口点击。不能把 adapter 测试写成桌面体验通过。
- 默认 UI 不能启用真实模型。没有 Key，也没有把 scripted 配置写进产品启动路径。
- 没有改 Pi Provider、SDK 协议、付费 HTTP 或验收脚本。
- 同一 request 在模型尚未发出时崩溃，不会自动重发；需要新的 request。`recentMessages.createdAtUnixMs` 现为 0，只影响新 session handoff 的时间戳。
- 没有改 `AGENTS.md`、共享 `handoff/STATUS.md` 或根 `MORNING-REPORT.md`。

## UI 时序

`13c6e55` 之后只改 `apps/desktop/ui/src/app/app-shell.tsx`。`useMemo` 按 `bridgeMode` 保留同一 Bridge，避免每次 render 新建后丢掉 `cache.runs`。ack 前的 `run_completed` 仍进缓冲；只有 `completed_verified` 且有 `persistedMessageId` 才刷新 Core 权威消息。未核验或不带持久化 id 不当已保存。ack 时若已离开该 Workspace，不把旧用户消息插入当前面板。刷新失败只在仍停留该 Workspace 时记错误。

没有真实请求、Key、模型开关、schema/IPC/Core 或 AGENTS 改动。没有装 React 测试；现有 23 项不覆盖 AppShell 时序。

| 命令 | 结果 |
|---|---|
| `set -euo pipefail` 后 `npm run typecheck:ui` | 通过。`tsc -p tsconfig.json --noEmit` 无输出。 |
| `npm run test:ui` | 通过。23 pass，0 fail，duration_ms 96.642167。 |
| `npm run build:ui` | 通过。vite 8.3.6，1682 modules，433ms。 |
