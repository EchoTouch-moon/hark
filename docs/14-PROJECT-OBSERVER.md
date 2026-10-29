# 14｜Project Observer P0

本地只读项目事实采集器。不评价开发质量，不规划下一步，不发通知，不执行修改。

## 启动

```bash
pnpm install
pnpm dev:server    # 127.0.0.1:4317，启动时对账已注册仓库
pnpm dev:web       # Vite 5173，打开 /projects
```

CLI（独立于 HTTP）：

```bash
pnpm exec tsx packages/project-observer/src/cli.ts --db data/observer.sqlite register /absolute/path/to/repo --name pindou --report reports/junit.xml
pnpm exec tsx packages/project-observer/src/cli.ts --db data/observer.sqlite list
pnpm exec tsx packages/project-observer/src/cli.ts --db data/observer.sqlite scan prj_...
```

试点仓库注册（路径从环境变量读取，存在才写入）：

```bash
export HEARTH_PILOT_PINDOU=/absolute/path/to/pindou
export HEARTH_PILOT_SKILL_LAB=/absolute/path/to/prototype-skill-lab
pnpm exec tsx scripts/register-observer-pilots.ts
```

## 配置

| 变量 | 默认 | 含义 |
|---|---|---|
| `HEARTH_OBSERVER_DB` | `data/observer.sqlite` | 观察器独立 SQLite（WAL） |
| `HEARTH_OBSERVER_WATCH` | `1` | `0` 时只做周期对账，不启用 chokidar |

每个项目可配置扫描间隔（默认 5 分钟）与防抖（默认 1500ms）。显式声明的 JUnit 路径即使位于 `.vitest/` 等默认忽略目录也会单独检查。

## 限制清单

- 只调用允许列表内的只读 Git 命令；`core.hooksPath` 指向空目录，不跑仓库 hook。
- 不 `fetch/pull/push`，不运行 `npm test` / 仓库脚本，不需要模型 API Key。
- 不读取源码全文、不存 diff、不存测试 stdout/stderr。
- 没有报告时测试状态是 `UNKNOWN`，不会显示通过。
- 报告无法绑定当前 HEAD 时，只展示「最近一次报告」，并在 HEAD 新于报告时标 `STALE`。
- 进程停机后恢复会写 `OBSERVATION_GAP`，不补造中间编辑。
- 符号链接不跟随出根；子模块不递归，需单独注册。
- 数据库在本机文件；P0 无网络同步。

## P0.5 hardening

Gate list: `docs/15-PROJECT-OBSERVER-P05-HARDENING.md`. Evidence: `docs/verification/`.
Performance: `OBSERVER_BENCH_ITERS=30 OBSERVER_BENCH_IDLE_MS=1800000 pnpm exec tsx scripts/observer-bench.ts`.

## 与既有 Hearth 架构的差异

规格草案中的 `project-registry` / `project-observer` / `project-state` / `project-contracts` 四个包，落地为单一 `@hearth/project-observer`，便于独立测试。观察事件写入 `data/observer.sqlite`，不复用 Hearth 的 `events` 表。既有 Demo 任务项目仍在 `/projects/:id`；观察详情在 `/observe/:id`。
