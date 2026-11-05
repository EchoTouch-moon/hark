# Hark R1 架构与交付状态

当前已实现并在本机测试：Rust Core 库。它拥有 SQLite v1 业务写入、目录授权的暂停/撤销、确认前的有界初扫、安全本地 Reader、来源引用、对话原文、onboarding 检查点，以及两种首消息的幂等。目录重叠按打开后的物理祖先判断；Workspace 读取绑定已验证目录 fd。新的 open 或 read 在短 `BEGIN IMMEDIATE` 准入内复查授权，不锁住整次扫描；撤权或暂停成功返回后不再开始下一次 open/read 或成功来源提交。IPC v1 frame/schema 已冻结为库内 codec，没有 HTTP，也没有 Sidecar 进程。

当前未实现：Tauri UI、TypeScript Pi Host、真实模型/搜索、记忆修订、FTS、Observer、网页 Reader、安装包。父子目录排除未实现，重叠会被拒绝。取消后的开场模型收据校验尚未修，不得标通过。Windows 安全读仍 fail-closed，且未在 Windows 编译。已进入内核的单次 read 不能被本切片打断。

目标（非已实现）：Tauri UI → Rust Core（授权/受控 Reader/SQLite 单写入/生命周期）↔ TS Agent Host（锁版 Pi SDK、Workspace Session、显式工具）→ 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。

串行建设：Core → Host → Tauri 集成，见 `docs/r1/IMPLEMENTATION-PLAN.md`。实际状态以 `handoff/STATUS.md` 与 `handoff/EVIDENCE/r1/` 为准。Host 不得在 #3 未修、且 #1/#5 未经父会话复跑前开始。历史 M0/M1 不继承为通过。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
