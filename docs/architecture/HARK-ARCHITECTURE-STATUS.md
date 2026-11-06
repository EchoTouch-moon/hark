# Hark R1 架构与交付状态

当前已实现并在本机测试：Rust Core 库，嵌入 Pi SDK 1.5.0 的 TypeScript Host，进程内 Native shell，以及 Unix 上由 Rust 管理的一条首次开场 stdio。SQLite 业务表仍来自未改的 v1；v2 只给 `onboarding_runs` 增加当前 opening run 与授权快照列。sessionRef 写在现有 `evidence_json`，没有新 migration。目录授权可暂停/撤销。确认前初扫有界。Workspace 读取绑定已验证目录 fd。开场必须匹配 Core 发放的 run；调用方 `success` 不是完成。IPC v1 frame 没有 HTTP。

Host 不调用 Pi CLI。stdout 只写 NDJSON。模型可见工具只有 `workspace.read_file` 与 `workspace.overview`。一个 Host 进程同时只跑一个 run。每次 provider 请求前反向 overview。Rust 用当前 Core 授权构造 `authorization.current`，Core `enabled` 映射 Host `active`。`stream.delta` 只是候选。合法 `stream.done` 后 Rust 用本轮真实读取收据调用 `commit_agent_opening`，成功才折叠本地卡。opening 的 `userMessageId` 缺省，不向 Hark 插入虚假用户消息。没有 Memory Engine，Context Pack 标 empty。显式 stepfun 槽可以按 OpenAI-completions 形状构造，真实协议未验证。

Native shell 目录选择仍走短时 picker token。未配置 Sidecar 时 `connected=false`，不读 Key，不发请求。已配置的开发 Node 路径只来自 Rust，不接受前端任意命令。macOS 用进程组关闭 stdin、SIGTERM、SIGKILL、`waitpid(WNOHANG)` 和有界 stop。worker 与 `sidecar_status` 读同一份状态。stdout frame ingress 上限 64，过载关闭受影响 run。Windows 没有 Job Object，Sidecar 默认关闭。

当前未实现或未通过：正式产品 UI、窗口点击/托盘人工验收、常规连续对话 run、真实 StepFun、搜索、记忆修订、FTS、Observer、网页 Reader、安装包、Windows 实机、整 R1。父子目录排除（AT-05）未实现。已进入内核的单次 read 不能被本切片打断。合成 scripted transport 不是 StepFun。

目标（非已实现）：Tauri UI → Rust Core ↔ TS Agent Host → 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。

串行建设见 `docs/r1/IMPLEMENTATION-PLAN.md`。实际状态以 `handoff/STATUS.md` 与 `handoff/EVIDENCE/r1/` 为准。历史 M0/M1 不继承为通过。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
