# Hark IPC v1

状态：`frozen for F1 host consumption`。这是 Rust Core 与未来 TypeScript Agent Host 之间的消息合同，不是已运行的 Sidecar，也不是 HTTP API。

Frame codec、有界队列和关联门禁仍是本文件的冻结合同。首次开场的 Unix stdio 已由 Native shell 消费这些 frame；这不是 HTTP，不是常规对话 run，也不是 Windows Job Object。Tauri 业务写入仍调用 in-process `hark_core::Core`。

## 1. 传输规则（Host 实现时必须遵守）

- 版本 `v = 1`。不兼容的字段进入 v2，不在 v1 frame 上加未声明字段。
- 首选 NDJSON over stdio。一行一个 JSON object，UTF-8，以 `\n` 结束。
- stdout 只写协议 frame。日志、诊断、panic 文本进入 stderr。
- 不监听 TCP、不监听公网、不因为回环就免认证。本阶段不实现回环服务。
- 最大 frame：`1048576` 字节，不含换行。超限的 frame 失败并丢弃到下一个换行，不截断后当成功。
- 控制队列与流式队列分开，各 64。`try_push` 失败返回 `queue_overflow`，不得阻塞另一方向。
- 流式方法：`stream.delta`、`stream.done`。其余进入控制队列，包括反向 Tool 请求和取消。
- 默认请求超时 30000 ms，最大 120000 ms。超时是拒绝，不是静默成功。
- 机器可读上限见 `contracts/ipc-v1.limits.json`。DTO 见 `contracts/ipc-v1.schema.json`。

## 2. Envelope

| 字段 | 含义 |
|---|---|
| `v` | 必须为 1 |
| `kind` | `request` / `response` / `event` / `error` |
| `id` | request 与 response 使用同一个 `req_` id；event 为 `evt_`；error 为 `err_` |
| `replyTo` | response 必须等于 `id`；event/error 指向原 request；新 request 为 null |
| `workspaceId` | 业务帧必须绑定 Core 发放的 workspace。host.ready 可为 null |
| `runId` | 一次 Agent 运行的 Core/Host 发放 id。取消和流式事件必须带回 |
| `method` | 见下表 |
| `deadlineUnixMs` | 可选绝对截止时间。超过后关联门禁返回 `timeout` |
| `payload` | object。不是模型可扩大权限的自由参数 |
| `error` | 仅 `kind=error` 时非 null |

ID 形状：`<prefix>_<32 lowercase hex>`。允许前缀：`req evt err ws run root src msg scan cand op tool grant agt conv onb`。

workspace、run、source、message、root 由 Core 发放。Host 可以生成 `req` / `evt` / `err` / `tool` 关联 id，但不能用模型文本替换 `workspaceId` 或 `runId`。

## 3. 方法

| method | 方向 | kind | 说明 |
|---|---|---|---|
| `host.ready` | Host → Core | request | Sidecar 就绪。无 workspace |
| `run.start` | Core → Host | request | 未来模型回合。本阶段不执行 |
| `run.cancel` | 双向 | request | `payload.targetRequestId`。后续关联帧返回 `cancelled` |
| `run.status` | Host → Core | event | 运行状态，必须带回 workspace/run |
| `stream.delta` | Host → Core | event | 流式增量。进入 stream 队列 |
| `stream.done` | Host → Core | event | 流结束 |
| `tool.request` | Host → Core | request | 反向 Tool。`payload.tool` 只能是白名单 |
| `tool.result` | Core → Host | response | 反向 Tool 结果。`replyTo` 为 tool request id |
| `workspace.read_file` | Tool payload | — | `{ "relativePath": "README.md" }`。相对 workspace，不是绝对路径 |
| `workspace.overview` | Tool payload | — | 无模型推断。Core 返回已持久化的扫描/来源 id |
| `error` | 双向 | error | 结构化失败 |

反向 Tool 白名单仅：`workspace.read_file`、`workspace.overview`。没有 bash、write、edit、通用 read。Tool 的 `workspaceId`、`runId`、`operationId` 由 Host 受信上下文绑定，不接受模型参数扩大范围。

## 4. 关联与死锁

禁止在唯一读取反向 Tool 的线程上同步写请求并阻塞等待响应。流式事件和反向 Tool 必须可以交错完成。

关联门禁拒绝：

- `replyTo` 对不上未完成 request
- workspace 或 run 与原 request 不一致
- 已取消 request 的后续成功帧
- 重复 request id

跨 workspace 回复的错误码是 `workspace_mismatch`。跨 run 是 `run_mismatch`。这不是产品验收里的跨项目记忆隔离测试，只是协议门禁。

## 5. Core in-process API（Tauri 直接调用）

不开放 HTTP。稳定入口是 `hark_core::Core`：

- `open` / `open_in_memory` / `schema_version` / `schema_tables`
- `authorize_directory` / `pause_directory` / `resume_directory` / `revoke_directory` / `list_roots`
- `run_initial_scan` / `get_scan`
- `confirm_import`
- `read_workspace_file` / `selective_key_read` / `list_source_refs` / `get_source_ref`
- `set_service_grant` / `get_service_grant`
- `commit_local_scan_card` / `commit_agent_opening` / `record_model_unavailable`
- `mark_analyzing` / `cancel_onboarding` / `retry_onboarding`
- `append_user_message` / `list_conversation` / `onboarding` / `workspace_overview`

`mark_analyzing` 在显式 Provider/Model 授权且目录仍有效时发放并持久化当前 opening run。`commit_agent_opening` 只接受与该 run 及授权快照绑定的外部成功收据；调用方传入的 `success` 不是完成状态。未配置 Provider/Model、取消、撤权、暂停、切换配置、伪 run、跨 workspace 或空证据一律拒绝。Core 不调用模型，失败不折叠 `local_scan_card`，也不把 `model_analyzed` 设为真。合法成功与折叠在同一 SQLite 事务。已提交开场重放返回原消息，不覆盖历史。初读开关只保存意向，不构成 wildcard 授权。目录撤权后，读侧不再返回新字节，已存摘录 `contentAvailable=false`；开场侧对同一撤权返回 `root_revoked`，不折叠、不创建开场。

前端与 Host 消费的是上述 in-process 方法，serde 为 camelCase。业务 schema 为 v2：`0001_init.sql` 不改，v2 只增加当前 run 与授权快照列。`OnboardingCheckpoint` 增加 `activeRunId`、`authProvider`、`authModel`、`authGrantUpdatedAt`、`authRootUpdatedAt`、`initialReadRequested`。`AgentOpeningReceipt` 必填 `runId`，必须等于 Core 发放的 `activeRunId`。`success`、调用方自造的 run、以及合成正文都不是完成或真实模型证据。

Host 在实际向模型或搜索发送前必须再次读取 `get_service_grant`、目录状态和 `onboarding`。已持有的 run 或收据不能当作发送许可。本 Core 不发送请求。IPC frame 的 `runId` 仍是协议关联字段，不是开场完成权。

## 6. 错误码

`path_escape` `symlink_rejected` `hardlink_rejected` `alias_rejected` `alias_check_failed` `cross_device_rejected` `sensitive_path` `artifact_path` `reader_unsupported_platform` `root_paused` `root_revoked` `grant_identity_mismatch` `overlap_refused` `budget_rejected` `cancelled` `scan_not_confirmable` `cross_workspace_ref` `model_not_authorized` `model_receipt_rejected` `provider_mismatch` `model_mismatch` `frame_too_large` `invalid_frame` `queue_overflow` `timeout` `workspace_mismatch` `run_mismatch` `correlation_rejected`

`overlap_refused` 的 detail 包含 `parent_child_exclusion_not_implemented`。这表示父子排除未实现，不是 AT-05 通过。重叠按已打开目录的 dev/ino 祖先链判断，不按调用方路径字符串前缀。macOS 的 `/var`、`/tmp` 这类中间系统别名不会被单独禁止。已有非撤销授权或 Workspace 无法按存储 inode 重新打开时，不能当成不相交；新的授权或确认返回 `overlap_refused`，直到该授权被撤销。

## 7. 明确未实现

- Windows Job Object。无 Job Object 时 Sidecar 默认关闭，EOF 不是 Windows 进程树安全
- 常规连续对话 run、真实 StepFun、搜索。首次开场 stdio 使用 scripted transport 时不是 StepFun 验收
- HTTP / 回环服务
- 真实模型、搜索、网页 Reader、FTS、记忆表、Observer、UI、整 R1。合成 provider/model 字符串不是 StepFun 调用
- macOS security-scoped bookmark。授权路径被替换或改名后 fail closed，不跟随新 inode
- Windows 安全读。该平台 `reader_capability = fail_closed`，且未在 Windows 编译
- 父子 Workspace 排除流程（AT-05）。当前只拒绝无法证明不相交的范围
- F2 Host 执行面：工具白名单落地、ContextPack、Pi session-ref、credential 槽。codec 里的 tool 名称不是已运行白名单
- 开场写路径仍是延迟事务。与撤权写者重叠时可能返回 SQLite busy，而不是 `root_revoked`；busy 时不提交新开场。撤权已经返回之后，读侧与开场侧都拒绝
