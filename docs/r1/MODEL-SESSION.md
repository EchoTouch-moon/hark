# 本次运行的 StepFun 会话

这是开发路径，不是安装包。打包未做。Rust 自己找本机 Node 22 和 `packages/agent-host/src/sidecar.ts`，前端不能传 Node 命令、文件路径、模型或 endpoint。

## 固定套餐

- provider `stepfun`
- model `step-3.7-flash`
- base `https://api.stepfun.com/step_plan`
- wire `anthropic-messages`
- Pi 1.5.0 的 anthropic `streamSimple` 会在 base 后追加 `/v1/messages?beta=true`
- 原 `openai-completions` 槽不变，仍走配置的 `chat/completions`

工具名在 Anthropic 线上用 `workspace_read_file` / `workspace_overview`。执行仍映射 Core 的 `workspace.read_file` / `workspace.overview`。没有另写 LLM loop。

## Key

- 只留在本次 Native 进程内存。
- 磁盘上的 provider 文件只有无密钥元数据。
- 传给 Node 的唯一通道是子进程环境变量 `HARK_SESSION_PROVIDER_KEY`，不进 argv。sidecar 入口取出后立刻删除该环境变量，再清掉其他凭据环境变量。不读全局凭据。
- 保存成功不等于 Key 已认证，保存本身不发模型请求。
- 重启后要重填。已有 workspace 模型授权会留下，但没有 Key 时发送按钮不可用。

## 命令

前端只能调用：

- `configure_stepfun_session`：`{ apiKey }`
- `clear_stepfun_session`
- `stepfun_session_status`：不含 Key。`authenticated` 恒为 false。
- `set_model_grant`：`{ workspaceId, enabled }`。provider/model 由 Rust 填固定值。
- 用户明确勾选初读时，确认后调用已有 `start_configured_opening`。不新建欢迎状态机。

搜索、观察、排除路径仍不可用。暂停和撤销继续走已有目录命令与 Host 发送前复查。用户主动发送后才调用模型。
