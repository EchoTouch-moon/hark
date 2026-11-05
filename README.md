# Hark R1

正在从保留完整历史的同一仓库建立 **Tauri 2 + Rust Core + TypeScript Pi SDK Host + SQLite** 新产品工程。当前不是可安装 R1 成品。

- 产品基线：[PRD v0.5.1](Hark-R1-Desktop-Personal-Agent-PRD-v0.5.1.md)（保留原 DRAFT 标记；已获批准用于本轮开发）
- 开发指令：[AGENTS.md](AGENTS.md)
- 实施计划/边界：[docs/r1/IMPLEMENTATION-PLAN.md](docs/r1/IMPLEMENTATION-PLAN.md)
- 实际交付状态：[handoff/STATUS.md](handoff/STATUS.md)

首轮优先 Rust/SQLite/受控目录读取、嵌入式 Pi Host 与 Tauri 接线。正式前端另行实现。模型外发、私人目录、安装包与 Windows 真实验收没有因编写代码而自动获准或通过。

## 历史参考
旧 `docs/01-PRD.md`、`docs/04-CONTRACTS.md`、`docs/05-SECURITY.md`、`docs/mvp/`、`tasks/REBUILD-PLAN.md`、`tasks/manifest.json` 与旧 handoff/证据保留研究价值，不是新 R1 的施工基线或验收通过记录。不要求旧 Schema、接口与 fixture 服务兼容。

当前分支 `dev/r1-desktop` 从本机已有 `origin/master` 建立。未推送、未合并/关闭 PR；原开发工作区及未提交改动保持不动。
