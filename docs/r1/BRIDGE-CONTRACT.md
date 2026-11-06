# 首条开场 Rust ↔ Pi Host 接线切片

这是 F1/F2/Native 壳之后的纵向集成，不是完整 R1 关闭。Unix 首次开场 stdio 已在本机用 scripted transport 跑通，见 `handoff/EVIDENCE/r1/f4-core-host-bridge.md`。正常连续对话、记忆/研究/Observer、真实 StepFun 与正式前端仍按 PRD 后续切片交付。

## 最小边界
- 消费 Host `40dae61`（或其定向修复提交）与 Native 取消修复后的提交。先串行合并其代码/必要证据，保留主线 F1 修复与父会话裁决，不整文件覆盖陈旧 handoff。
- Rust 为业务唯一写入者。Native 目录选择/确认与 Core 只读边界保持，前端不提交任意路径、Provider 成功标志或业务完成状态。
- Rust 调 `mark_analyzing` 发放首次 run；从持久根/服务授权与该 run 的快照构造 Host `run.start` 和 `workspace.overview.authorization`。`current` 不来自模型或前端。未明确配置 Provider/Model、目录或服务暂停/撤销、run/版本不符、已取消均拒绝。
- Host 的 `tool.request` 仅 `workspace.overview` / `workspace.read_file`，逐项核对 envelope、request/run/workspace、operation、deadline 与当前授权后调用 Core，拒绝跨域/越界/重复/迟到消息。不要额外建 HTTP 或 MCP client。
- `stream.delta` 是候选呈现，不是业务完成；合法 `stream.done` 后由 Rust 调 `commit_agent_opening`，带 Core run、指定 Provider/Model 与实际读取获得的 source refs。Core 提交成功才记录完成与折叠本地卡，失败或取消不提交。
- 首轮 Context Pack 来自已授权的当前 Core 概况与来源版本，暂无 Memory Engine 就为空/有限事实，不能伪称已有长期认知。只有真正新 Pi Session 才从 Hark 对话衔接有限近期消息，本地扫描卡不冒充用户发言。

## 持久化与最小实现
- Pi 继续持有官方 JSONL，Rust 只保存归属明确的 `sessionRef` 与必要 run 关联。先评估是否能在 Rust 权威的现有 onboarding evidence metadata 中保存 typed session binding；若不能表达验收，再说明理由并串行加最小 migration，不先铺完整 agent/session 平台。
- 本切片专属首次理解 run，不复用/重置 onboarding 欢迎状态冒充常规对话 run。常规连续对话需要独立的最小业务运行合同，留下一切片，不宣称 FR-06 已完成。
- Node 是开发启动保底，启动真正受管理 Sidecar，不以 Pi CLI 替代嵌入 SDK。生产分发 Bun/Node 与无预装运行时安装包尚未验证。
- macOS 管理进程组，正常取消/关闭 stdin/退出/异常回收有有界策略与真实子进程证据；Windows 未实现 Job Object 时 Sidecar 默认关闭，不能借 EOF 单独宣称进程树已安全回收。

## 权限与测试
- 真实模型与真实凭据仍关闭。本地 probe 可使用自建合成目录、明确的 scripted transport 与合成 Key，禁止读取真实 Key/全局 auth 或向外发请求；测试标明 transport 合成，但 Core、Pi SDK、stdio 与磁盘文件必须实际运行。
- 最少联合证据：Native 确认目录 → Core 选择性读 → Core 授权/run → 真正 Node+Pi SDK 管道反向读 → 候选开场 → Core 成功收据 → 重启恢复与首消息幂等。另测当前 run 取消、模型/目录撤权、跨 Workspace、超时、子进程异常/EOF与完全 stop 后无本切片受管理进程。
- UI 暂保留最薄中文测试入口。接线可先通过同一 Native service 的本地 integration harness 验证，界面点击/托盘/真实开场/安装与 Windows 分别保留未验状态；不伪造截图或产品完成。
