# 开发入口

当前仓库为产品重建阶段，旧实现与其运行命令已移除。请先读 [README](README.md)、[重建计划](tasks/REBUILD-PLAN.md) 和 [任务清单](tasks/manifest.json)。安全合同及阶段门禁仍然适用；历史证据不代表重建版本已通过验收。

底层开发环境使用 Node.js 22.13+ 与 pnpm 11.9.0。安装依赖后可运行 `pnpm lint`、`pnpm test`、`pnpm typecheck` 和 `pnpm build`。当前 `lint` 基于 TypeScript 编译器，仅增加未使用变量、未使用参数和 switch 分支贯穿检查，不代表完整的静态安全分析。Node 22 的内置 SQLite 会显示实验性警告；Windows 上尚未验证。这些命令只检查当前基础模块，不启动产品或真实 connector。
