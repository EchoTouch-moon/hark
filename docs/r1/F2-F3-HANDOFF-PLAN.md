# F2/F3 底座接续与独占边界

## 当前依据
- F1 集成 `0771ebe`：主会话复跑 fmt/check/46 项局部测试通过，当前五项定向修复接受；不是用户产品验收。
- SDK smoke `1985fc1`：主会话复跑 strict TS 与实际 SDK smoke 通过。工具注册表/active/callable 只有无能力自有 Tool；项目资源不加载；faux JSONL 恢复无重复灌入；测试拦截下网络/子进程尝试为 0。
- smoke 依赖精确锁 Pi 1.5.0，未证明 StepFun、Provider HTTP payload、compaction 或正式进程链路。ADC fileExists 探测被测试 guard 拒绝；现构造器不能原样当作“绝不探测环境凭据”的生产保证。

## 小步并行，正式集成串行
用户允许最多两个 Grok 4.7 high 并行。当前契约 multi-seam：TS SDK runtime 与 Native Tauri/Core 壳独立可测；分别在独立 worktree 提交，主会话复核后才由集成 writer 串行接通。核心合同和 migration 不并行合入。

| lane | 独占写范围 | 最小结果 | 本段不能宣称 |
|---|---|---|---|
| F2 Host | `packages/agent-host/**`、根 JS scripts/lock；必要 Host 证据 | 双向 NDJSON runtime、受信 run/Workspace 绑定、流式/反向 Tool/取消、Context Pack 与官方 Session 恢复证据 | 真实目录/StepFun/MCP、Core 当前业务持久化已正式接通 |
| F3 Native shell | `apps/desktop/**`、原生/Core 只读测试与必要命令文档；不改 Host/根 JS workspace | Tauri 2 原生宿主、Native 目录选择与确认、调用已有 Core、重启恢复、最薄开发入口 | 正式前端、Sidecar 监督、模型开场、签名安装包、Windows 实机 |
| integration 后续 | 以上两段 handoff 完成后才取得主工作区独占写权限 | 真正 Rust↔Host stdio、执行前授权复查、会话引用、退出回收、联合证据 | 未运行的网络/平台验收 |

## 接口裁决（最小复用）
1. **Rust 才发放业务 run**。`Core::mark_analyzing` 后由 Native/桥接构造现有 `run.start` envelope，Host 不能调用 Rust 库，更不能让模型填写 Workspace/run/provider/model/授权版本。Host 的反向 `tool.request` 只能请求 `workspace.read_file` / `workspace.overview`，由 Rust 检查当前 run、目录与服务授权后实际调用 Core。`commit_agent_opening` 由 Rust 接受 Host 终态后调用，不另开放模型 completion Tool。
2. **先一个普通 stdio sidecar，不开放 HTTP**。沿用 contracts/ipc-v1 的 frame/ID/大小/queue 上限；Host stdout 仅协议，stderr 日志脱敏。`run.start` / `stream.*` / 反向 Tool 可交错，取消/超时后迟到结果不能完成旧 run；不发明第二套 MCP client 或通用执行器。
3. **上下文从可信快照来**。F2 只实现传入当前紧凑 snapshot/source version 的请求级转换，不能声称尚未实现的 Memory Engine 已存在。未有记忆时诚实为空；证据走受控 Tool。禁止每轮 L0/L1 拼成 user message。原 Session 恢复不重复灌对话；来源版本变化无法可靠清除旧 compaction 时采用官方新 Session + 一次有界近期对话衔接，不自行重写 SessionManager。任何 hook 异常不得悄悄回退发旧快照。
4. **凭据默认不存在**。本轮不读取任何真实 Key、全局 auth/models/settings 或用户私人项目。Host 可实现严格显式 Provider/凭据注入接口并用纯合成值测试，未有 Rust 服务授权和用户批准的系统凭据来源时远程 Provider 仍关闭。不为测试把 credential 放入 SQLite/JSONL/证据。当前不得自动启用 MCP/搜索。
5. **Session 引用按权威边界接通**。Host 用受控 app-data/Workspace 专属 sessionDir 与官方 SessionManager，产生 run/session 引用结果。正式绑定 Hark SQLite 的 session ref 与 handoff 去重需要最终 Rust 集成；若确需最小 migration，先说明旧字段为什么不能表达，再串行实现，不能先铺全 R1 schema。
6. **Native 授权入口不能接受任意前端路径即批准**。目录选择来自 Native dialog；读取授权与模型授权分开，扫描候选确认后才建 Workspace。开发测试只能指定自建合成目录，不自动扫描用户 Home 或项目。UI 仅最薄中文开发入口，正式 React/视觉由其他 agent 后续接入。

## 验证与交接
每段保留可复跑脚本、实际错误状态和未完成项。无网络 SDK/faux、合成磁盘、Native 开发构建、真实模型、安装包与 Windows 各自分列。不得以假 Tool 结果称真正 Rust 双向链路已经接通。完整 frontend command/event/DTO/error handoff 在 Native/集成可用后交付。
