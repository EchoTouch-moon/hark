# README-dev — Hearth 开发说明（面向本仓库贡献者/Agent）

## 快速开始
```bash
pnpm install            # 安装依赖（需要网络访问 npm registry）
pnpm typecheck          # 全仓 TypeScript 严格检查（noEmit）
pnpm test               # Vitest 单元/集成测试（contracts/core/storage/api）
pnpm build              # 构建 web (vite build) + server (esbuild bundle)
pnpm test:e2e           # Playwright E2E（需要浏览器；不可用时输出 BLOCKED 说明）
```

## 本地运行（Demo 闭环）
```bash
pnpm dev:server         # Fastify API，仅监听 127.0.0.1:4317
pnpm dev:web            # Vite UI，代理 /api 到 127.0.0.1:4317
```

首屏 Home 为空时：调用 `POST /api/v1/demo/seed`（或 UI Settings 里的「初始化 Demo 数据」），然后 `POST /api/v1/discover`。

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
