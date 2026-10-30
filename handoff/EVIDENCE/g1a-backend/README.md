# G1-A 后端验收证据

测试均使用合成项目和隔离临时 SQLite，不访问真实私人仓库、不调用真实模型或公开检索。日志中的本地仓库绝对路径已替换为 `<repo>`。

- `tests.txt`：在加入 health 能力标识与真实 HTTP 测试前，`pnpm test` 的全仓结果，56 文件、458 测试通过；不能把它误称为包含随后的新增测试。
- `focused-tests.txt`：加入上述变更后，实际执行 `pnpm exec vitest run apps/server/src/http/g1a-live.test.ts apps/server/src/http/g1a-security.test.ts apps/server/src/http/app.test.ts packages/core/src/orchestration/orchestrator.test.ts`，4 文件、49 项通过。`g1a-live` 启动真实本机 loopback HTTP 服务，以合成数据库验证非演示模式；`g1a-security` 以服务端请求注入验证三种模式、跨项目隔离、拒绝旧执行、保留旧历史、取消和恢复。
- `typecheck.txt`、`lint.txt`、`build.txt` 分别为全仓类型检查、ESLint 和构建输出；ESLint 为 0 errors、6 warnings。最后生产代码改动后构建通过；随后仅新增 HTTP 测试，类型检查和 lint 已重新执行。
- 未运行完整浏览器 E2E；现有配置会删除固定的本地测试数据库，且前端任务及历史 CI 失败尚未修复。历史 PR #5/#6 CI 失败不能算作本次通过。

约束：正常服务默认不启用旧执行器，即便设为 Demo 模式也拒绝旧 seed/reset/卡片/执行接口；旧功能仅由测试代码对独立合成库及临时产物根显式启用。`legacyDemoAvailable` 返回真实能力状态；隔离的运行时 Demo 尚未建设。只隐藏可识别的旧模拟建议/结果，原始记录未删除；无法识别的历史污染和旧前端本地 fallback 仍需后续审查。已有执行中的任务取消是尽力而为，不能证明已发生的副作用被撤销；验证中的任务保持待核验，不伪称完成。
