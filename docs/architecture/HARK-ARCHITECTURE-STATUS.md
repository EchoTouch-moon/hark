# Hark R1 架构与交付状态

当前已实现并在本机测试：Rust Core 库，一个尚未接通 Rust 的 TypeScript Agent Host sidecar，以及进程内调用 Core 的 Native shell。SQLite 业务表仍来自未改的 v1；v2 只给 `onboarding_runs` 增加当前 opening run、provider/model、grant/root 版本与初读意向。目录授权可暂停/撤销。确认前初扫有界。本地 Reader 拒绝特殊文件，枚举预算在 readdir/分类边界生效。目录重叠按已打开目录的物理祖先判断；Workspace 读取绑定已验证目录 fd。新的 open 或最多 16 KiB read 在短 `BEGIN IMMEDIATE` 准入内复查授权，不锁住整次扫描。撤权或暂停成功返回后不再开始下一次 open/read 或成功来源提交。开场必须匹配 Core 发放并持久化的 run 与授权快照；调用方 `success` 不是完成。目录撤权后读侧与开场侧都拒绝，历史摘录不再外发。IPC v1 frame/schema 已冻结为库内 codec，没有 HTTP。

Host sidecar 嵌入 Pi SDK 1.5.0，不调用 Pi CLI。stdout 只写 NDJSON。模型可见工具只有 `workspace.read_file` 与 `workspace.overview`，且不能填写 workspace/run/operation。一个 Host 进程同时只跑一个 run，第二个 run 明确 busy，不共用对方的授权复查。每次 provider 请求前反向调用 overview，并要求结果里的 authorization 对象与启动快照的 run/provider/model/root/grant 版本一致且 `current` 为 true。版本变了但没有新正文时不发送，也不把旧 identity 当成当前 pack。Host 不写 SQLite，不调用 `mark_analyzing` 或 `commit_agent_opening`。请求级 Context Pack 带当前 revision/sourceVersion；无法证明旧 compaction 不含过期事实时，使用官方新 Session 加当前快照和有界近期消息。新 Session 按目标 Session 去重 handoff，恢复原 Session 不重复灌。stdin EOF 或 stdout 失败会中止活动 run 并清队列/计时器。凭据只接受显式注入。显式 stepfun 槽可以按 OpenAI-completions 形状构造，但真实 endpoint/stream/tool/billing 未验证，faux 不是产品 fallback。

Native shell：Tauri 2 进程内调用 Core，目录选择经短时 token，确认使用 Root/Scan/Candidate id，SQLite 在 app data dir。`ca0efb3` 已落入工作区；同 key 取消覆盖修复 `8ca7617` 尚未落入本索引。无 WebView 服务测试与 debug 二进制启动记录保留。正式前端、窗口点击、托盘交互、安装包和 Windows 未验。

当前未实现或未通过：正式 Tauri 产品 UI、Rust↔Host 正式 stdio、真实模型/搜索、记忆修订、FTS、Observer、网页 Reader、安装包、整 R1。本壳还没有 Sidecar，Windows Job Object 未验证。父子目录排除（AT-05）未实现，重叠会被拒绝。Windows 安全读仍 fail-closed，且未在 Windows 编译。已进入内核的单次 read 不能被本切片打断。合成 overview 收据不是 Core 授权，也不是真实 StepFun。

目标（非已实现）：Tauri UI → Rust Core（授权/受控 Reader/SQLite 单写入/生命周期）↔ TS Agent Host（锁版 Pi SDK、Workspace Session、显式工具）→ 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。Host 在实际发送前必须再次检查当前授权。正式桥接仍要由本工作区 integration 消费两边证据，当前未接通。

串行建设见 `docs/r1/IMPLEMENTATION-PLAN.md`。实际状态以 `handoff/STATUS.md` 与 `handoff/EVIDENCE/r1/` 为准。主会话已在 `0771ebe` 复跑 fmt/check/46 项测试通过，接受五项本机定向修复并放行 F1 底座继续开发；不等于 R1 产品验收。Host `40dae61` 与 Native `8ca7617` 已由主会话放行进入串行集成，不是产品通过。历史 M0/M1 不继承为通过。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
