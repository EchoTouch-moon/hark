# 前端接入续接（中断恢复）

状态：local-build-verified。不是窗口点击验收，不是安装包，不是普通对话，不是模型调用，不是整 R1 通过。

续接原 run `d7b03b50-532f-454a-b730-8477dbba5cee`（Connection error，children.list 无可恢复记录）。工作区 `/Users/v/new-idea/hark-r1-frontend-integration`，分支 `dev/r1-frontend-integration`，接手时 HEAD `49fcfee`，35 个文件已暂存。未改主线 `/Users/v/new-idea/hark-r1-desktop`（`2b61291`），未 cherry-pick，未改用户源目录、`AGENTS.md`、共享 `STATUS`、旧 StepFun 验收脚本。未发模型请求；新模型预算 0，Key 已撤销。

## 本轮只补的缺口

适配层与炉心 UI 已在暂存区，没有重做。收尾：

- `asUiError` 改为导入现有 `toUiError`，不新造错误类型。
- `FolderOnboarding` 传入 `bridgeMode` 与 `onPickNative`。Native 默认 `strict_tauri_ipc`，选文件夹走 `pickAndScan`（`pick_directory` token），不手输路径、不用预设目录。
- 菜单隐藏/退出、托盘退出、设置里的隐藏按钮走已有 `hideWindow` / `quitApp` invoke。严格模式不再只改 React 托盘标志。
- 严格模式重试不再自动切到 Dev Preview。预览只在设置里显式选择。设置 `nativeLocked` 关掉“拨成已配置”的开关。
- 测试：`InvokeFn` 显式泛型；不完整 bridge 用测试级 `unknown` 转换；可选方法先断言存在再调用。来源详情测试补上适配层已调用的 `list_source_refs` stub。

## 已接的现有 Native 命令

UI 适配层会调用，且 `apps/desktop/src-tauri` handler 里已有：

- 快照/工作空间：`shell_snapshot`、`list_workspaces`、`get_workspace`、`list_roots`、`workspace_overview`、`service_grants`、`onboarding`
- 选择与导入：`pick_directory`、`authorize_picked`、`scan_root`、`confirm_import`
- 本地只读卡：`selective_key_read`、`commit_local_scan_card`
- 对话与来源：`list_conversation`、`list_source_refs`、`get_source_ref`
- 窗口：`hide_window`、`quit_app`
- 目录状态：`pause_directory`、`resume_directory`、`revoke_directory`

路径预览 `previewRoot` 在 Native 模式拒绝，不 invoke。

## 明确未接

适配层直接拒绝，不返回 Dev Preview 数据，也不发完成态：

- 普通聊天：`startAgentTurn` 不 invoke，不发 `runCompleted`，不标 `persistenceVerified`。Shell 里已有但本轮未接的 `append_user_message`、`start_configured_opening` 同样不从 UI 调用。
- run：`getRunStatus`、`cancelAgentTurn`
- 记忆/检索：`searchWorkspaceMemory`
- 观点：`getOpinion`、`submitOpinionFeedback`、`revertMemoryOperation`。`listWorkspaceOpinions` 返回空数组，不是预览观点，也不是错误横幅。
- 子工作空间、观察器开关、权限改写、运行时偏好拨动：拒绝。
- Shell 有、UI 未调用：`cancel_scan`、`get_scan`、`cancel_read`、`cancel_onboarding`、`retry_onboarding`、`sidecar_status`。`subscribeAppEvents` 是空退订，不是事件平台。

## 本机命令

均在 `set -euo pipefail` 下实跑。Node `v22.23.2`，npm `12.0.2`，rustc `1.95.0`，cargo `1.95.0`。

| 命令 | 退出 |
| --- | --- |
| `npm run typecheck --workspace @hark/desktop-ui` | 0 |
| `npm run test --workspace @hark/desktop-ui` | 0（21/21；首轮缺 `list_source_refs` stub 时 20/21，补 stub 后通过） |
| `npm run build --workspace @hark/desktop-ui` | 0（vite 8.3.6，`apps/desktop/ui/dist`，gitignore，未提交） |
| `npm run typecheck`（根，`@hark/agent-host`） | 0 |
| `CARGO_TARGET_DIR=/Users/v/new-idea/hark-r1-desktop/apps/desktop/target cargo check --manifest-path apps/desktop/Cargo.toml --offline -p hark-desktop` | 0（4.74s，复用主线 target 缓存；只验证资源配置编译，不是窗口运行） |

未跑浏览器点击、未跑原生窗口点击、未装自动化框架、未 `cargo run`、未访问真实目录或网络。

## 开发运行

桌面开发启动（本轮未执行）：仓库根目录开两个终端，先 `npm run dev -w @hark/desktop-ui` 保持Vite运行，再 `cargo run --manifest-path apps/desktop/Cargo.toml -p hark-desktop`。`devUrl` 为 `http://127.0.0.1:1420`。纠正原交接：直接cargo不会执行Tauri CLI的beforeDevCommand，不能假定Vite自动启动。单独Vite也不是Native宿主，严格模式不会静默进预览。

## 主会话串行集成复核
已在含Core v3的主线合入3c6289a并实际执行 `set -euo pipefail`：`npm ci --ignore-scripts --no-audit --no-fund`、UI类型/21测试/build、Host类型、NativeDesktop cargo check均exit0。说明组合编译与适配单测可用，仍不代替Native点击或真实模型验收。

## 残留

- 没有窗口/托盘/选择器的点击证据。构建通过不等于桌面体验通过。
- 普通聊天、记忆检索、观点写入仍不可用。空观点列表容易被看成“没有观点”，不是“接口未接”。
- 部分旧 catch 仍是 `err as HarkUIError`；新路径用 `toUiError`。
- `cancel_*`、`retry_onboarding`、`sidecar_status`、`append_user_message`、`start_configured_opening` 未从 UI 接上。
