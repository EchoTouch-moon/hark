# 12｜开发执行手册

## 工具链
目标是 `node >=22`, `pnpm >=9`, TypeScript strict, React, Fastify, Zod, SQLite, Vitest, Playwright（E2E）。首次运行时 Agent **先检查**本机 `node -v && pnpm -v && git --version`，不要依赖此包使用者的环境与前一次机器相同。

## 建议 package scripts（Agent 要实际落实）
```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter @hearth/web --filter @hearth/server dev",
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "pnpm -r --if-present lint",
    "test": "pnpm -r --if-present test",
    "test:e2e": "pnpm --filter @hearth/web test:e2e",
    "demo:seed": "pnpm --filter @hearth/server demo:seed"
  }
}
```
上面 scripts 是**建议接口**；执行时必须对应真实 workspace packages。`--if-present` 只用于非强制子包，核心检查不得因无 script 误报通过。

## 开发准则
- 测试数据统一从 `/fixtures` 来，使用固定 ISO 时间 + 相对冻结时钟，避免 Demo 一夜后全部过期；运行时将合成事件时间映射为固定 clock 或基于 seed 的 determinism。
- 使用 Zod schemas 与 `z.infer`，不要复写不一致 TS interface。
- 避免多个 Agent 同改共享合同；并行只分配 UI/fixture/文档等互不冲突的子树。
- 每个 API 返回稳定 `requestId`, `data`, `error` 或按 OpenAPI 风格的明确响应；返回未知字段应在客户端降级。
- 每个请求如有副作用都写 append-only audit，无 secret 原文。
- 每个页面至少有 loading/empty/error 状态，`aria` 可用。
- 所有 git commit 小而审计友好；tag 可在绿灯后本地创建。

## 运行与构建说明必须出现在实际开发 README-dev.md
包含：本机环境、安装、启动、端口、Demo seed/reset、tests/build、运行 Screenshot/E2E、已知依赖。Agent 必须**真正启动并验证端口**，仅生成脚本不算通过。

## 失败与日志
- 命令失败保留 stdout/stderr 最后有效上下文、完整退出码、触发文件/任务；不要贴整个 secrets env。
- 接入 Hermes 失败时标记 `not_configured`, 切回 Demo 模式，不以 mock 冒充 provider。
- 测试日志保存在 ignored `.hearth-local-logs`，验收摘要导出脱敏副本 `handoff/EVIDENCE/`。
