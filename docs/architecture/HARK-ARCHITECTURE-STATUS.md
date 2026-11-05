# Hark R1 架构与交付状态

当前已实现并在本机测试：Rust Core 库。SQLite 业务表仍来自未改的 v1；v2 只给 `onboarding_runs` 增加当前 opening run、provider/model、grant/root 版本与初读意向。目录授权可暂停/撤销。确认前初扫有界。本地 Reader 拒绝特殊文件，枚举预算在 readdir/分类边界生效。目录重叠按已打开目录的物理祖先判断；Workspace 读取绑定已验证目录 fd。新的 open 或最多 16 KiB read 在短 `BEGIN IMMEDIATE` 准入内复查授权，不锁住整次扫描。撤权或暂停成功返回后不再开始下一次 open/read 或成功来源提交。开场必须匹配 Core 发放并持久化的 run 与授权快照；调用方 `success` 不是完成。目录撤权后读侧与开场侧都拒绝，历史摘录不再外发。IPC v1 frame/schema 已冻结为库内 codec，没有 HTTP，也没有 Sidecar 进程。

当前未实现或未通过：Tauri UI、TypeScript Pi Host、真实模型/搜索、记忆修订、FTS、Observer、网页 Reader、安装包、整 R1。父子目录排除（AT-05）未实现，重叠会被拒绝。Windows 安全读仍 fail-closed，且未在 Windows 编译。已进入内核的单次 read 不能被本切片打断。F2 仍缺工具白名单落地、ContextPack、Pi session-ref、credential 槽。合成收据不是真实 StepFun。

目标（非已实现）：Tauri UI → Rust Core（授权/受控 Reader/SQLite 单写入/生命周期）↔ TS Agent Host（锁版 Pi SDK、Workspace Session、显式工具）→ 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。Host 在实际发送前必须再次检查当前授权。

串行建设：Core → Host → Tauri 集成，见 `docs/r1/IMPLEMENTATION-PLAN.md`。实际状态以 `handoff/STATUS.md` 与 `handoff/EVIDENCE/r1/` 为准。主会话已在 `0771ebe` 复跑 fmt/check/46 项测试通过，接受五项本机定向修复并放行 F1 底座继续开发；不等于 R1 产品验收。允许隔离的 SDK 无网络 smoke 与 Tauri/Core 壳独立推进，正式 Sidecar 接入仍串行消费两者证据。历史 M0/M1 不继承为通过。

候选分支进展（尚未合入主线）：`dev/r1-host-runtime` / `2b9ac8c` 已有 Node 嵌入式 Pi stdio Host；`dev/r1-native-shell` / `ca0efb3` 已有 Tauri 2 壳与 Core 命令服务。主会话已分别复跑其局部测试，但两个 Grok 4.7 high 审查均因 xAI 403 额度/订阅故障中断，没有最终 verdict。Host 仍有跨 Workspace 并发、旧快照、EOF/衔接与 StepFun 硬拒绝疑点需定向复核；Native 与 Host 尚未通过真实 Rust 桥接接通。当前不合并/不称产品通过，恢复条件见 handoff/BLOCKERS.md。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
