# 前端交接索引

- 当前桌面预览：<http://127.0.0.1:4402/>；当前前端构建在 `apps/web/dist/`，由 Git 忽略，可用 `pnpm --filter @hearth/web build` 重建。
- 主要界面源码：`apps/web/src/`；火影形态在 `apps/web/src/features/flameShape.ts`，渲染及动效分别在 `flameRenderer.ts` 与 `components/EmberAtmosphere.tsx`。
- 叙事与状态说明：`docs/EMBER-STORY-SYSTEM.md`；最新五态截图、录屏和检查结果：`handoff/EVIDENCE/flame-shapes-refined/`。
- 旧方案的静态设计原型保存在 `prototypes/`；这是已跟踪的历史源文件，不是当前前端构建。其他历史验证记录保存在 `handoff/EVIDENCE/`。
- 旧验收服务 4399、4401、4403、4404 已停止；如需复现最新动效截图，按 `handoff/EVIDENCE/day-night-hearth/README.md` 启动隔离的 4404 服务，再运行 `scripts/qa/capture-flame-states.mjs` 或 `scripts/qa/flame-shape-transitions.mjs`。
