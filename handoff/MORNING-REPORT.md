# Hark R1 执行交接

F1 Core 仍未产品放行。父会话审查原文仍在 `f1-parent-review.md`。

## 本段

- 分支 `dev/r1-desktop`，未推送。先合入 Host `2b9ac8c`/`40dae61` 与 Native `ca0efb3`/`8ca7617`，再提交首次开场 stdio。
- 文档冲突按段落保留 F1 与两边修复，没有整文件覆盖 parent-review 或 AGENTS。
- Unix 上真实 Node + Pi SDK 1.5.0 + Core stdio 已跑通首次开场：合成目录 README 字节、Core 收据、sessionBinding 重启、取消/撤权/超时/跨 run、进程组清理。transport 是 scripted，不是 StepFun。
- 未配置时不启动 Sidecar。Windows Job Object 未实现，Sidecar 默认关闭。常规对话 run、Memory、搜索、安装包、窗口点击未做。

## Bridge 生命周期收口

- 取消后重试不再被旧 sessionBinding 挡住。同 run 仍不能任意换 session。compaction 有显式 Core 路径，不扩 chat。
- EOF/kill/关 stdin 后 `sidecar_status` 与 snapshot 为 `connected=false`，不依赖手动 stop 刷新。
- Rust frame ingress cap=64，真实 Node flood 证明，不是只新建队列类。停滞 worker 的 stop 有界，超时不报 `exited=true`。
- 不是整 R1，不是窗口交互，不是 StepFun。证据 `handoff/EVIDENCE/r1/f4-bridge-lifecycle-fix.md`。

## 主会话最终本机复核与下一步
- `9f9bb01`：Core48、Native16项已由主会话复跑通过，独立Session重试probe由失败变成功，接受首次开场本机底座。
- StepFun脚本来源 `882a723` + `9e5fd43` 已串行合入；主会话复跑bash语法、strict TS、离线安全18、Host14、SDKsmoke1通过。没有真实Key/StepFun请求。
- 后续真实调用已结束：通用API2次402，正确套餐 `/step_plan/v1/messages` 最后1次HTTP200/OK（输入21/输出130tokens），见stepfun-plan-direct-check.json。原3次预算用完，Key已由用户撤销。
- 这仅是正确套餐协议的直接HTTP文本成功，不是PiSDK流式/Tool/Rust闭环通过。用户叫停了续测脚本扩建；当前主线clean，继续复用PiSDK接套餐messages协议，再补连续对话。
- 普通对话Core已合入8197ec0，主会话复跑55测试。用户React前端已合入3c6289a，主会话复跑21UI测试、UI构建/类型、Host类型与Tauri check通过。前端原目录保持不动，Native真实适配默认启用。
- Native普通聊天发送/流式/状态/取消已合入3b9dee7，UI时序收口d74ba9f。主会话复跑Core56、Native17、UI23、UIbuild/类型和桌面build通过。transport仍scripted，不是应用真实模型通过。
- 已按用户要求启动Vite（HTTP200）与开发Tauri进程，并激活桌面到前台；启动证据见desktop-startup.md。未做窗口控件点击/截图。随后模型配置已合入a8deffb，主会话复跑Host14+2/UI24/Native18/SDKsmoke与构建后再次重启并激活窗口。应用设置可存本次运行Key、工作空间可独立启用；配置不自动发请求，未提供真实Key所以尚无应用真实模型验收。
- Memory/搜索/Observer、双平台安装与完整用户价值验收仍未交付。开发启动须先Vite再另终端cargo，详见README。
