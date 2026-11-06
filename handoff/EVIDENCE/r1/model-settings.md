# 模型配置接线

状态：implemented，dev-only。不是真实模型验收，不是安装包。真实请求预算仍为 0，没有发 StepFun HTTP。

## 用户页面

1. 打开应用设置。密码框填写 StepFun Key，点「仅本次运行保存」。输入会清空。状态变成已配置，但不表示 Key 已认证。
2. 打开该工作空间的设置，单独启用模型。填 Key 不会给其他工作空间授权。搜索和观察仍不可用。
3. 回到炉心，主动发送一条消息。已有普通聊天管道才会调用模型。
4. 导入时如果已经配置 Key，可以勾选初读。确认后走已有开场入口，不另建欢迎流程。不勾选则只做本地扫描卡。
5. 重启应用后 Key 消失，需要重填。工作空间授权还在，但没有 Key 时不能发送，也不会去找全局凭据。
6. 「清除」只清本次运行的 Key 并停掉 sidecar。

父会话合入后需要重新构建并重启桌面。这次没有停正在运行的主线 Vite 或桌面。

## 验证

- Host 类型检查通过。`npm run test:host`：原 14 项通过，另加 `test:stepfun-session` 2 项通过。拦截 fetch 的 Anthropic SDK 文本回复为 OK，工具名从 `workspace_read_file` 映射回 `workspace.read_file`。请求 URL 为 `https://api.stepfun.com/step_plan/v1/messages?beta=true`。构造 provider 时 fetch 次数为 0。
- UI 类型检查、24 项测试、Vite 8.3.6 构建通过。
- `cargo test -p hark-native-shell`：库内 2、bridge_probe 6、flow 9、model_session 1，全部通过。合成 Key 配置后 `authenticated` 为 false，stderr 没有套餐 URL 或 401，快照和 app data 没有 Key，argv 没有 Key。enable/disable 走真实 `service_grants`。
- `cargo check -p hark-native-shell -p hark-desktop` 通过。

## 残留

- 打包未做。找不到 Node 22 或 sidecar.ts 时配置失败，并回滚内存 Key。
- 没有真实认证或付费调用。SDK 可能附带 cache 头；套餐对流式和工具的真实接受情况仍未用请求验证。
- macOS `ps eww` 可能仍显示进程启动时的环境块。Node 已删除 `process.env` 中的专用变量，子进程不会继承它，argv 不含 Key。同用户调试器仍可能读到进程内存。
- 搜索、观察、排除路径未做。
