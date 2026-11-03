# README-dev — Hearth 开发说明（面向本仓库贡献者/Agent）

## 快速开始
```bash
pnpm install            # 安装依赖（需要网络访问 npm registry）
pnpm typecheck          # 全仓 TypeScript 严格检查（noEmit）
pnpm test               # Vitest 单元/集成测试（contracts/core/storage/api）
pnpm build              # 构建 web (vite build) + server (esbuild bundle)
pnpm test:e2e           # Playwright E2E（需要浏览器；不可用时输出 BLOCKED 说明）
```

## 本地运行（默认真实项目模式）
```bash
pnpm dev:server         # Fastify API，仅监听 127.0.0.1:4317
pnpm dev:web            # Vite UI，代理 /api 到 127.0.0.1:4317
```

默认模式从 Projects 登记授权仓库，Insights 后台只运行确定性规则。Chat 仍为 Mock。

需要独立 Demo 闭环时以 `HEARTH_DEMO=1` 启动服务；仅在该模式下调用 `POST /api/v1/demo/seed`（或 UI Settings 里的「初始化 Demo 数据」），然后 `POST /api/v1/discover`。

## 仓库布局（pnpm workspace）
- `packages/contracts` — Zod DTO / 枚举 / 状态转换表，唯一事实来源
- `packages/core` — discovery / policy / orchestration / verify（可脱离 HTTP 测试）
- `packages/storage` — SQLite (node:sqlite) migration + repositories + audit
- `packages/connectors` — FixtureConnector 等，声明 scopes
- `packages/agent-adapters` — MockAgentAdapter（P0）、Hermes probe（M2）
- `packages/panels` — 只读 Panel 渲染白名单
- `packages/eval` — replay/scoring/trace evidence
- `packages/project-observer` — 本地 Git / JUnit 只读观察器（独立 SQLite `data/observer.sqlite`）
- `apps/server` — Fastify localhost API + SSE
- `apps/web` — React UI（Home/Chat/Projects/Activity/Settings）
- `fixtures/` — 纯合成数据；`tests/e2e/` — Playwright
- `data/`（gitignored）— `dev.sqlite` 与 `observer.sqlite`；`.hearth-demo-artifacts/`（gitignored）— 执行产物根

Project Observer 说明见 `docs/14-PROJECT-OBSERVER.md`。

## 关键工程决策
见 `docs/11-ADR.md` 与 `handoff/DECISIONS.md`。要点：
- SQLite 通过 Node 22 内置 `node:sqlite`（DatabaseSync），零原生依赖；WAL + busy_timeout + FK ON。
- 所有包以 TypeScript 源码被 workspace 直接消费（tsx/vite/vitest），不预编译 dist；server 用 esbuild 打包、web 用 vite 构建。
- Demo 数据与真实数据完全隔离；真实 connector 默认 OFF。

## P2-A Pi 真实调用

默认仍为 Mock。真实调用必须显式配置 Provider/模型，Run 的 `model` 保存 `provider/model`：

```bash
export HEARTH_ANALYSIS_PROVIDER=pi
export HEARTH_PI_PROVIDER=stepfun-plan
export HEARTH_PI_MODEL=step-5-preview
# 本机已安装且审阅过的 Provider 注册扩展；不要填不可信扩展。
export HEARTH_PI_PROVIDER_EXTENSION=/absolute/path/to/pi-provider-stepfun/src/index.ts
pnpm dev:server
```

Pi 继续使用 `--no-tools --no-extensions --no-mcp --no-context-files --no-session --offline`；仅用 `-e` 加载上面显式指定的 Provider 注册扩展。`--offline` 关闭启动联网，不关闭本次模型请求。凭证由 Pi 自身认证机制解析，Hearth 不复制密钥；不要把凭证放到命令参数或报告。第三方扩展本身是本地代码，因此仍需独立文件指纹核验，不能仅凭 `--no-tools` 宣称无副作用。

验证前先构建 web，再显式设置 `HEARTH_PILOT_PINDOU` 后运行 `pnpm exec tsx scripts/p2a-live-verify.ts`。该脚本在 `data/p2a-live-*/` 使用独立数据库，通过浏览器点击触发真实调用，输出脱敏 Run 证据及建议卡截图；比较 HEAD、index 内容、工作区状态以及 tracked/nonignored untracked 文件内容与 mode。ignored 文件不在指纹覆盖范围。真实请求失败不回退 Mock。

## 多端代码同步

GitHub **公开**仓库：`EchoTouch-moon/hark`，默认分支 `master`；近期 G1 安全集成线为受保护的 `bot/hearth-g0-contract`。两条分支已分叉，不能盲目从 `master` 开始新 G1 代码，也不能擅自将 G0 合入 `master`；先核实 [当前工程入口](docs/engineering/REPOSITORY-GOVERNANCE-2026-11-03.md) 和任务授权。

首次在另一台设备运行：

```bash
gh repo clone EchoTouch-moon/hark
cd hark
pnpm install
pnpm build
pnpm dev:server
```

需要 Node >=22.13 和 pnpm。已有工作副本时，先提交本机修改，再 `git pull --ff-only`；完成一段工作后 `git add <本次文件>`、`git commit`、`git push`。分支出现分歧时先处理合并，不使用强制推送覆盖另一台设备的工作。

Git 同步源码、合同、测试与文档。本地 SQLite、注册项目的绝对路径、会话、密钥、依赖、构建产物不参与同步；每台设备单独安装依赖、登记授权项目，并配置 Pi 认证及 Provider 扩展路径。历史验收证据含当时本机的路径与状态，不应当作另一台设备的当前运行结果。

真实分析现在先预览上下文并确认发送；项目排除路径会持久化。本次确认绑定稳定内容指纹及接收方，内容变动需重新确认。Run 中的引用已匹配不代表结论已核实。建议评分见 docs/evaluation/README.md。

UI-REFRESH-01 过渡路由：`/` 目前展示真实洞察列表（今日聚合概览待实现）；旧 Action Card 演示改到 `/demo`，仅 `HEARTH_DEMO=1` 可进入。服务端模式未确认或失败时不显示业务操作。项目页在真实模式不显示合成任务区。Chat Mock、Demo 和 Demo 执行记录位于“更多入口”。切换服务端启动模式后请刷新页面。
