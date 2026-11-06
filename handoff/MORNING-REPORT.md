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
- 用户下一步在本地TTY运行 `bash scripts/stepfun-live-check.sh`，隐藏输入国内StepFun专用Key。仅step-3.7-flash、最多3请求、每次输出≤512tokens、纯合成材料。不要贴Key或自动循环重试。
- 脱敏摘要默认 `handoff/EVIDENCE/r1/stepfun-live-check-summary.json`（需不存在），检查后才记录真实验收结论。这个独立Provider/SDK测试不是Rust+真实私人项目闭环，也不是完整R1通过。
- 正式React前端、常规连续对话、Memory/搜索/Observer、双平台安装与用户价值验收仍未交付；参见STATUS与PRD覆盖矩阵。
