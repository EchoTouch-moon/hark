# F3 Native shell handoff

状态：`verified-local` 只覆盖无 WebView 的 Rust 服务测试、`cargo check` 和本机 debug 二进制启动。不是正式前端、不是 Sidecar、不是真实模型、不是安装包、不是 Windows。

后续前端应只消费本文。不要读旧 `handoff/FRONTEND.md` 或旧 fixture 服务。那些不是 R1。

## 1. 进程与数据

- 桌面包：`apps/desktop`。Tauri `2.12.5`，`tauri-build 2.7.4`，`tauri-plugin-dialog 2.8.4`。锁在 `apps/desktop/Cargo.lock`。
- 可测服务：`hark-native-shell`。集成测试直接调用它，不打开 WebView。
- Tauri 命令只是这层服务的薄包装。业务完成由 `hark_core::Core` 决定。
- SQLite：`app.path().app_data_dir()` + `hark-r1/business.sqlite`。identifier 是 `dev.hark.r1.native-shell`。项目原文件只读；应用状态只写这个库。
- 本壳没有 Sidecar，没有 HTTP，没有 session-ref 库。`sidecar_status` 永远 `connected: false`。Windows Job Object 未验证。

## 2. 权限流程

1. 用户点「选择目录」。Rust 调 `tauri_plugin_dialog` 2.8.4 的 `DialogExt::dialog().file().set_title(...).set_can_create_directories(false).blocking_pick_folder()`。不传入起始目录，因此不会由我们打开 Home。
2. 选择结果只留在进程内，返回短时 `pickToken`。默认 120 秒，单次使用。票据没有路径。
3. `authorize_picked` 只接受 token。过期、伪造、重放都拒绝，且不会调用 `authorize_directory`。
4. `scan_root` 用 Core 默认预算做无模型初扫。取消的扫描不能确认。同一 `rootId` 已有进行中的初扫时，第二次调用是 `scan_already_running`，不覆盖原取消标志，也不把 busy 当成成功或没任务。`cancel_scan` 仍只取消正在跑的那一次。
5. `confirm_import` 只接受 `rootId` + `scanId` + `single | selected candidateIds`。`enable_model_initial_read` 在壳内固定为 false。
6. 之后才能 `selective_key_read` 和 `commit_local_scan_card`。本地卡不是模型分析。同一 `workspaceId` 已有进行中的读取时，第二次调用是 `read_already_running`，不覆盖原取消标志。`cancel_read` 仍只取消正在跑的那一次。
7. 未配置模型时 onboarding 为 `waiting_for_model_auth`，`modelAnalyzed=false`。没有命令能写 `agent_opening_message`。

目录读取和远程模型是两种许可。服务授权 UI 关闭：没有 `set_service_grant`，不读全局 Pi key，不调用模型或搜索。

前端不能传任意 path 即授权，不能传 `success` / `approved` / `risk` / `completed`。这些字段会被 `deny_unknown_fields` 拒绝。相对路径读取也没有命令；只有 Core 自己选择的关键文件读取。

`tauri-plugin-dialog` 会注册 `plugin:dialog|open`，但 capability 不授予 `dialog:*`。前端即使拿到插件路径，也不能拿它授权。`tauri-plugin-fs` 只是 dialog 的类型依赖，没有 `init`，没有 fs/shell 权限，没有 allow-all。

## 3. 命令

参数名按 `tauri-macros 2.7.4` 的默认 `camelCase`。嵌套结构体参数名仍是 `request`。返回值是 Core/壳的 camelCase serde。

| command | invoke 参数 | 返回 |
|---|---|---|
| `pick_directory` | `{}` | `PickTicket`。取消为 `pick_cancelled` |
| `authorize_picked` | `{ request: { pickToken } }` | `AuthorizedRoot` |
| `list_roots` | `{}` | `AuthorizedRoot[]` |
| `pause_directory` | `{ rootId }` | `AuthorizedRoot` |
| `resume_directory` | `{ rootId }` | `AuthorizedRoot` |
| `revoke_directory` | `{ rootId }` | `AuthorizedRoot` |
| `scan_root` | `{ rootId }` | `InitialScan`。同一 root 已在扫描时是 `scan_already_running`，不开始第二次 |
| `cancel_scan` | `{ rootId }` | 空。取消当前这一次。没有进行中的扫描是 `scan_not_running`。`scan_already_running` 不是取消成功 |
| `get_scan` | `{ scanId }` | `InitialScan`，含 `ignored` 与 `limitsHit` |
| `confirm_import` | `{ request }` | `ConfirmResult` |
| `list_workspaces` | `{}` | `Workspace[]` |
| `get_workspace` | `{ workspaceId }` | `Workspace` |
| `selective_key_read` | `{ workspaceId }` | `SelectiveReadReport`。同一 workspace 已在读取时是 `read_already_running`，不开始第二次 |
| `cancel_read` | `{ workspaceId }` | 空。取消当前这一次。空闲时 `read_not_running`。`read_already_running` 不是取消成功，也不是空闲 |
| `list_source_refs` | `{ workspaceId }` | `SourceRef[]` |
| `get_source_ref` | `{ request: { workspaceId, sourceId } }` | `SourceRef` |
| `workspace_overview` | `{ workspaceId }` | `WorkspaceOverview`。`modelInference` 由 Core 保持 false |
| `commit_local_scan_card` | `{ workspaceId }` | `FirstMessage`。重放原卡，不另造开场 |
| `list_conversation` | `{ workspaceId }` | `ConversationEvent[]` |
| `append_user_message` | `{ request: { workspaceId, text } }` | 本地备注，不是模型消息 |
| `onboarding` | `{ workspaceId }` | `OnboardingCheckpoint` |
| `cancel_onboarding` | `{ workspaceId }` | checkpoint，`state=cancelled` |
| `retry_onboarding` | `{ workspaceId }` | 清除 run 绑定；不删除已有本地卡 |
| `service_grants` | `{ workspaceId }` | 四个 grant，只读 |
| `sidecar_status` | `{}` | 永远未连接 |
| `shell_snapshot` | `{}` | roots、workspaces、reader 能力、关闭的模型传输 |
| `hide_window` | `{}` | 隐藏主窗口 |
| `quit_app` | `{}` | 标记退出并 `app.exit(0)` |

确认体：

```json
{ "rootId": "root_…", "scanId": "scan_…", "selection": { "kind": "single" } }
```

```json
{ "rootId": "root_…", "scanId": "scan_…", "selection": { "kind": "selected", "candidateIds": ["cand_…"] } }
```

`PickTicket` 字段：`pickToken`、`displayName`、`expiresAtUnixMs`、`directoryRead`、`remoteModel`。没有 path。

错误 DTO：`{ "code": "root_paused", "detail": "…" }`。WebView 里 `invoke` 拒绝值的 JS 形状未做交互验证。Core 错误码原样透出，另加壳错误：`pick_not_found`、`pick_expired`、`pick_cancelled`、`pick_not_a_directory`、`invalid_id`、`scan_not_running`、`read_not_running`、`scan_already_running`、`read_already_running`、`path_read_closed`。Tauri `#[command(async)]` 的扫描和读取走 threadpool，同一 key 可以重叠；壳在同一把 map 锁里拒绝第二次，结束时只删除自己的 flag。开发入口把这两个 code 显示为「这次没有开始，也没有取消原来的任务」。这不是窗口点击验收。

## 4. 事件

没有业务事件通道。完成、取消、恢复都看命令返回和 SQLite。不要监听前端自造事件来标记模型完成。

窗口关闭是 Rust `WindowEvent::CloseRequested`：未请求退出时 `prevent_close` + `hide`；`quit_app` 或托盘「完全退出」先置 quit，再允许退出。托盘菜单是「显示窗口 / 完全退出」。这套策略有单元测试；点击、托盘和截图未跑。

## 5. 开发入口

`apps/desktop/ui` 是中文测试表单，不是产品 UI。用 `textContent` 显示不可信文件正文。正式 React/视觉另做。

```sh
cd apps/desktop
cargo test -p hark-native-shell
cargo check -p hark-desktop
cargo build -p hark-desktop
```

人工窗口：`cargo run -p hark-desktop`。不要用 picker 选真实私人项目。自动化不打开 picker；测试调用 `NativeShell::stage_native_pick`，只喂自建临时目录。

## 6. 明确未实现

- 正式前端、签名安装包、Windows 编译/实机、窗口点击验收。
- Sidecar、stdio、Pi、真实模型、搜索、凭据 Store、`mark_analyzing`、`commit_agent_opening`。
- 父子 Workspace 排除。重叠仍是 `overlap_refused`，不是 AT-05。
- macOS security-scoped bookmark。路径被替换后由 Core fail closed。
- 通用 shell/fs 命令、任意相对路径读取、观察器、通知、FTS、记忆。
