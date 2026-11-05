# Hark R1 架构与交付状态

当前已实现：隔离 R1 分支与唯一开发基线。当前生产代码尚未交付。

目标（非已实现）：Tauri UI → Rust Core（授权/受控 Reader/SQLite 单写入/生命周期）↔ TS Agent Host（锁版 Pi SDK、Workspace Session、显式工具）→ 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。

串行建设：Core → Host → Tauri 集成，见 `docs/r1/IMPLEMENTATION-PLAN.md`。正式 UI、真实模型/项目闭环、Observer/研究/记忆修订与双平台安装验收仍待完成。实际状态以 `handoff/STATUS.md` 与证据为准，历史 M0/M1 不继承为通过。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
