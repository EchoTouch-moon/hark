# Hark R1 阻塞与验证条件

## 当前执行阻塞：后台子 agent 启动依赖缺失
- Workflow `106be9d1-a67f-4109-9341-c0c23c4a0a4e` 已 failed；首阶段 `r1.core` 未启动，后续 Host/integration 未执行；无 child session 可恢复。
- 宿主 Pi 1.5.0 无法解析 `@earendil-works/chord` 与 `@earendil-works/chord/context`，已用宿主目录的 Node createRequire 复现 `MODULE_NOT_FOUND`。doctor 显示后台能力/临时目录可用，不能据此判定依赖完整。
- 新 worktree 在失败后核验为 clean，HEAD `d6d502e`，没有实现源码或 partial diff。分支 `dev/r1-desktop`；未切换 CLI/前台执行。
- 用户随后批准诊断与最小兼容修复。根因更新：Pi 1.5.0 原本不声明 chord，本地 pi-subagents 的版本推断错误要求它，并非需向产品或宿主盲装 chord。已保留扩展既有 dirty diff，定向修改 runner-aliases 与回归测试，未提交其他人的修改、未安装依赖/升级 Pi。
- 修复证据：`handoff/EVIDENCE/r1/runtime-repair.md`；局部测试 7/7、typecheck 和真实宿主 alias 检查通过。
- 当前恢复条件：用户执行 `/reload` 重载扩展，再通过原 subagent 协议重新启动首阶段。尚无修复后真实后台 child 启动证据，不声称底座已经实现。原 workflow 无 child session 可 resume；重启首阶段须引用本次计划与 mission，而非恢复不存在的 child。

- 真实私人项目读取、付费 StepFun/搜索调用：本轮未授权，不读取旧密钥/全局凭据；先无网络 SDK 与受控磁盘测试。恢复条件为用户指定合法目录、系统凭据机制与发送范围。
- Windows 实机/干净安装环境：尚无验证证据，R1 阶段完成前必须补齐。
- Bun/Node 分发选择：保留 PRD O-01 未决状态，当前可基于已有运行时开发，不据此声称自包含打包完成。
- 旧架构画布目标配置未迁入新 worktree，本轮先维护仓库内架构状态，不扫描个人笔记。
