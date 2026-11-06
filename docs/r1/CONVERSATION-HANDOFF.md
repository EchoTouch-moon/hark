# 普通连续对话 Core 对接

状态：`implemented-local` 只覆盖 Rust Core 的普通回合存储。不是 Native 接线，不是 WebView 命令，不是 Pi SDK 流，不是真实 StepFun，不是安装包。

后续 Native 只消费本文和 `hark_core::Core`。不要把下面的受信方法加进 `FRONTEND_COMMANDS`、Tauri command 或 capability。WebView 仍只能 `append_user_message`（本地备注）和 `list_conversation`（只读恢复）。

## 为什么要 v3

`conversation_events.kind` 的 CHECK 只有 `user_message` / `local_scan_card` / `agent_opening_message`。SQLite 不能原位改 CHECK。`onboarding_runs` 只表示首次欢迎，不能重置它来冒充普通聊天。

v3 在执行前检查实际列、出站/入站 FK、非 sqlite 索引、trigger 和 view。列或索引与 v1 不一致、或已有表引用 `conversation_events` 时，拒绝并回滚，不 drop。通过后复制全部行，再 drop/rename，并按原谓词重建 `conversation_first_message_idem`。同时给事件加 `seq`，`list_conversation` 按 `seq, created_at, id` 恢复顺序。

只新增一张直接业务表 `conversation_runs`。不建权限、Agent、会话或队列平台。不改 `0001_init.sql` / `0002_opening_run.sql`。开场 run 仍在 `onboarding_runs.active_run_id`。`session_ref` 只存 Pi 官方 `pi:<uuid>` 归属，不存 JSONL。

## Native 调用顺序

Core 不开网络，也不接受 `success`。`ConversationCommit` 带 `deny_unknown_fields`，多一个 `success` 无法反序列化。完成只来自受信 Native 在真实 `stream.done` 之后调用 `commit_conversation_message`。

1. `start_conversation_run`：绑定已存 `user_message`，或在同一事务里按 `user_text` 存一次用户原文。状态 `pending`。快照当前 provider、model、服务 `updated_at`、目录 `updated_at`。
2. `register_conversation_run`：目录和服务仍匹配快照时改为 `running`，可写入 `sessionRef`。这不是完成。
3. `commit_conversation_message`：只接受 `running`。写入一条 `kind=agent_message`、`generation=NULL` 的助手消息，状态 `committed`。寒暄的 `source_ids` 可以为空；给出的 id 必须是本 workspace 已有 source。不折叠本地卡，不改 onboarding，不写第二条 `agent_opening_message`。
4. `cancel_conversation_run` / `fail_conversation_run`：`pending|running` 终态。保留用户原文，不插入助手消息。取消后不能提交。
5. 重启后 `list_conversation` 按原顺序返回。`get_conversation_run` / `conversation_run_by_request` 恢复 run。

同一 `request_id` 重放同一个 run 和已接受的用户消息，不另插一行。`request_id` 就是幂等键，对应 HarkBridge `requestId`（任意非空、最长 128、非控制字符、不像密钥的字符串）。同一条已存用户消息不能再绑第二个 request。授权快照变了也不能用旧 run 提交；新尝试需要新的 request 和新的用户消息。

复用现有 `explicit_model_grant`、`grant::require_active` 和同 workspace source 归属检查。未启用、暂停、撤销、错 provider/model、目录暂停/撤销、错 workspace、伪造 source 都拒绝。不新造 Gate。

## HarkBridge 映射

前端 `StartAgentTurnInput` 是 `{ requestId, workspaceId, conversationId, userPrompt }`，返回 `{ runId, acceptedUserMessage }`。Native 可一次调用：

```text
start_conversation_run({
  requestId,
  workspaceId,
  conversationId,
  userText: userPrompt
})
→ { runId: run.id, acceptedUserMessage }
```

若用户消息已经由 Core 存好，改传 `userMessageId`。两者都传时正文必须一致。丢失响应后用 `conversation_run_by_request(workspaceId, requestId)` 取回同一个 run 和原文。

`RunStatus.state` 对照：

| Core `conversation_runs.state` | HarkBridge |
|---|---|
| `pending` | 已绑定，流还没注册。不是 completed |
| `running` | `running` |
| `committed` | `completed`，`persistedAssistantMessageId = assistantMessageId` |
| `cancelled` | `cancelled` |
| `failed` | `failed`，`error_code` 由 Native 填 `latestError` |
| 不存储 | `persistence_unknown` 只属于 Native：提交 RPC 结果未知时使用。Core 错误表示确定没提交；已有 `assistant_message_id` 就是 completed |

## 不要暴露给 WebView

这些方法只给进程内受信 Native：

- `Core::start_conversation_run`
- `Core::register_conversation_run`
- `Core::commit_conversation_message`
- `Core::cancel_conversation_run`
- `Core::fail_conversation_run`
- `Core::get_conversation_run`
- `Core::conversation_run_by_request`

不要加 Tauri command。前端不能传 `success`、`approved` 或路径来完成回合。
