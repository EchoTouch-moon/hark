# Host 候选定向复核 · 2026-11-06

目标：`dev/r1-host-runtime` / `40dae61`，相对 `2b9ac8c` 的五项已知问题修复。父会话检查 runtime/provider/ipc 的实际 diff，并在该隔离 worktree 执行：

- `npm run typecheck`：exit 0。
- `npm run test:pi-sdk-smoke`：1/1 pass，网络/子进程/全局 Pi/项目资源探测 0，ADC deny 0。
- `npm run test:host`：13/13 pass。
- `npm run probe:host-stdio`：exit 0，输出 activeClose=stdin-end-and-paused-stdout、StepFun=unverified、CoreBridge=not-connected。

## 裁决
- 接受全局单活跃 run 的瘦替代：不同逻辑 Workspace 可各持 Session，但同一 Host 不并行发模型请求，第二 run 明确 busy，避免共享 gate 污染。
- 版本变更缺新正文则拒绝发送；有新正文时不沿用旧 identity，旧内容不贴新版本。
- EOF/error 统一 shutdown、abort、清 pending/timer/stream 队列，不反复 kick 空转；已完成真正 spawned EOF 探针。paused stdout 探针没有填满内核管道，不能扩大声称为完整 OS 背压压测。
- 新 Session 一次有界 handoff，恢复原 Session 不重复灌入，目标 Session 去重。
- StepFun 不再按名字硬拒绝，显式配置接口可用；默认关闭、无 Key/授权不发送、禁止隐式跳转至非配置目标。真实 StepFun 协议仍未验证。

**放行此 Host 候选进入串行集成**，不是 Rust Core/Native/Host 已接通，也不是 PRD 产品通过。原失败 reviewer 没有最终 verdict；本次是主会话基于源码与实际命令的定向复核，不冒称独立审查通过。

## 集成前提与限制
Rust 必须构造当前授权对象，控制 Provider 选择、run 身份、来源作用域与终态业务写入。Host 不直接写 SQLite。会话引用需由 Rust 持久绑定，不可只靠 Host index 替代业务权威。真实发送前仍需检查服务/目录授权；凭据必须来自用户批准的机制。不得将合成 transport/Key 或 test Core 当真实模型或真实 Rust 连接证据。

Native 只读审查发现同 root/workspace 重叠扫描/读取会覆盖 CancelFlag，父会话采纳为需修 P1（尽管 reviewer 尾部写 OK with notes）。已派独占 writer 修复，完成复核后再合入。UI 点击、托盘、退出、安装包和 Windows 均未验。
