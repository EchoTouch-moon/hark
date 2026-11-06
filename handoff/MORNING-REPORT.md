# Hark R1 执行交接

F1 Core 仍未产品放行。父会话审查原文仍在 `f1-parent-review.md`。

## 本段

- 分支 `dev/r1-desktop`，未推送。先合入 Host `2b9ac8c`/`40dae61` 与 Native `ca0efb3`/`8ca7617`，再提交首次开场 stdio。
- 文档冲突按段落保留 F1 与两边修复，没有整文件覆盖 parent-review 或 AGENTS。
- Unix 上真实 Node + Pi SDK 1.5.0 + Core stdio 已跑通首次开场：合成目录 README 字节、Core 收据、sessionBinding 重启、取消/撤权/超时/跨 run、进程组清理。transport 是 scripted，不是 StepFun。
- 未配置时不启动 Sidecar。Windows Job Object 未实现，Sidecar 默认关闭。常规对话 run、Memory、搜索、安装包、窗口点击未做。
