# Task Status — Hearth 夜间自动开发

> 由 Coding Agent 维护；每项附真实证据路径。所有命令输出见 `handoff/EVIDENCE/`。

## 最终状态（2026-10-28 夜间运行）

- **M0 GREEN**（contracts/policy/storage/fixtures 全绿）
- **M1 GREEN**（完整可运行可演示闭环 + UI + E2E）
- **M2 GREEN**（评分/抑制/预算/Hermes 探测；precision@3 在 50 条集上 NOT_MEASURED，诚实标注）
- M3/M4 NOT_STARTED（按计划不在夜间范围）

## 命令 exit codes（最终验证）

| 命令 | 结果 |
|---|---|
| `pnpm test` | exit 0 — 12 files / **131 tests** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0（vite web + esbuild server bundle） |
| `pnpm test:e2e` | exit 0 — **11 passed / 0 failed**（Playwright chromium-1248） |

## 任务表

| Task | 状态 | evidence | 说明 |
|---|---|---|---|
| M0-T01..T05 | DONE | m0-t0*.txt | workspace/contracts/policy/storage/fixtures |
| M0-GATE | DONE | m0-gate.txt | 78 tests green |
| M1-T01..T04 | DONE | m1-t0*.txt | server+auth / discovery / orchestration / UI shell |
| M1-T05..T08 | DONE | m1-t05-t08-ui.txt | Home/Chat/Projects/Activity/Settings（2 子agent + 主agent） |
| M1-T09 | DONE | m1-t09-e2e.txt | 131 tests + 11 e2e + 5 截图 + demo-run.json |
| M1-GATE | DONE | m1-gate.txt | GREEN，安全负例无回归 |
| M2-T01..T03 | DONE | m2-gate.txt / hermes-probe.txt | scoring/suppression/hermes probe |
| M2-GATE | DONE | m2-gate.txt | GREEN；precision@3 NOT_MEASURED（50 条标注集未建，不虚构） |
| M3/M4 | NOT_STARTED | — | 按计划 |

## 阶段快照

- M0 完成：commit 0821d21（78 tests）
- M1 API+core：commit 3cc6d99
- M2 core 并行推进：29b8307 / 4db20d7 / 0149b1b
- M1 UI 集成+E2E 全绿：commit 145213c

## 最后一项实际完成任务
M2-GATE（全部 20 个 overnight 任务完成）。

## 下一项待办（明早人审后）
见 MORNING-REPORT.md「下一步建议」。

## 关键证据
- `handoff/EVIDENCE/m1-gate.txt`、`m2-gate.txt`、`m1-t09-e2e.txt`
- 截图：`ui-home.png` `ui-chat.png` `ui-projects.png` `ui-activity.png` `ui-settings.png`
- 真实闭环 trace：`demo-run.json`；审计快照：`morning-audit-snapshot.json`

## 2026-10-29 · P2-A Live Verification

工程闭环 PASS；建议有用性待人审。真实 Pi `stepfun-plan/step-5-preview` 经页面点击生成建议卡；Git HEAD/index/status 与 611 个文件指纹不变（不覆盖 ignored 文件）。306 tests、typecheck、改动文件 eslint、web build 通过。证据：`docs/verification/hearth-p2a-live-verification.md`、`handoff/EVIDENCE/p2a-live-*`。此前总表为历史快照，不代表当前最新范围。

## 2026-10-29 · GitHub 同步准备

已创建私有仓库 EchoTouch-moon/hark 并配置 origin；源码/测试/验收文档快照纳入同步提交，未跟踪截图保留本地。全仓 306 tests/typecheck 复用本次 P2-A 验证（同一源码工作区），本次新增验证完整 web+server build exit 0，证据 handoff/EVIDENCE/github-sync-build.txt。提交内容密钥特征扫描无命中；历史唯一特征命中是 assemble.test.ts 的合成测试字符串。远端是否最新以 git rev-parse HEAD 与 git ls-remote origin refs/heads/master 对比为准。多端使用说明见 README-dev.md。

## 2026-10-29 · R0 PASS

审计H02/03/04/05/06/07/09/10修复与故障注入通过；40文件338测试、全仓typecheck、改动文件lint通过。证据 docs/verification/remediation-r0.md 与 handoff/EVIDENCE/r0-*。开始R1前已完成该门禁；尚未验收R1/R2。

## 2026-10-29 · R1 PASS

Observer→Signal→Insight后台协调器已上线并可恢复，41文件341测试、类型检查、改动文件lint通过。真实浏览器合成JUnit报告自动生成唯一测试Insight，未手动消费、未调用模型；证据 docs/verification/remediation-r1.md、handoff/EVIDENCE/r1-browser.txt。进入R2。

## 2026-10-29 · R2工程实现，本地通过

42文件343测试、类型检查、lint零错误（6既有warning）、完整build、16项浏览器通过。外发预览确认/稳定指纹/项目排除/来源语义/反馈/真实默认模式/README/CI已实现。远端CI待执行；价值门禁NOT_MEASURED：1真实项目6历史建议，用户定性反馈已保存，0逐项人评。详见docs/verification/remediation-r2.md；R2未通过，不进入P2-B/C/P3。

## R2远端工程验收结果

GitHub CI Run40836527163对源码00121a2实际success，含Node22/Linux完整检查与Mock浏览器验收。结构化证据handoff/EVIDENCE/r2-ci-run.json。R0/R1 PASS，R2工程PASS、价值NOT_MEASURED，不进入P2-B/C/P3。

## UI-REFRESH-01 · 第一块

分支codex/ui-refresh-01；主题/令牌基础与空详情不占位已实现。web build/typecheck、局部lint和新增浏览器场景通过，基础主题对比度>=4.5。完整任务与下一步见tasks/UI-REFRESH-01.md“最新交接”，证据handoff/EVIDENCE/ui-01-theme-*。UI-01整体未完成，未推送远端。

## UI-REFRESH-01 · 第二块

UI-01.2模式/导航基础完成：服务端模式共用上下文+Zod、未知/失败关闭操作、真实根洞察页、/demo与旧Demo深链接门禁、次级Mock/Demo入口、真实Projects不取合成项目。全仓typecheck、web build、局部lint、全19项浏览器通过。完整记录tasks/UI-REFRESH-01.md最新交接；下一块UI-01.3。

## UI-REFRESH-01 · 第三块（UI-01 阶段门禁 PASS）

UI-01.3完成：响应式导航（1024px紧凑72px图标导航并保留可访问名称、>=1280px 200px）、主内容最大1200px宽屏居中；按需详情面板（空时不渲染、>=1600px 360px内联列、1024/1440px覆盖式抽屉附遮罩、600px底部模态面板）；顶栏说明随时呼出；Esc/关闭按钮/点击遮罩退出并自动归还焦点。全仓typecheck、web build、lint零错误、Playwright全量22/22通过。证据：handoff/EVIDENCE/ui-01-layout-*。下一块：UI-02.1（只读overview聚合接口）。

## UI-REFRESH-01 · 第四块（UI-02 阶段门禁 PASS）

UI-02 全部完成并通关门禁：
1. UI-02.1 新增只读 `GET /api/v1/overview?projectId=…` 聚合接口，返回今日概览事实（优先最多 3 条未处理 Insight、项目摘要、状态计数与最近 10 条真实观察事件）；
2. UI-02.2 真实项目工作台首页：实现四大固定区域（今日概览叙事与关键指标、值得关注列表、项目概况网格、最近客观观察记录），项目筛选同步至 URL `?projectId=...` 并在刷新后保持；旧 Demo 首页移至受门禁保护的 `/demo`；
3. UI-02.3 真实观察事件时间线 `/observations` 及主导航正式入口；活跃页面 3 秒非重叠只读静默轮询，后台标签页自动暂停轮询，切回前台立即单次刷新；发现与建议提供“发现列表”与“分析历史”双视图；
4. 修复了 SPA 静态文件服务在处理带 Query 参数的根路径（如 `/?projectId=...`）时误将根目录当文件读取导致 500 的问题，以及 JUnit 报告含失败用例时 `MIXED` 状态正确映射为测试失败（`FAILED`）；
5. UI-02 门禁验收通过：合成 JUnit 失败测试报告自动生成真实 Insight，首页 3 秒轮询自动感知并呈现，重复扫描不重复，全过程零模型调用。
6. 验证：全仓 43 文件 / 348 个单测 PASS；全仓 `typecheck` PASS；改动文件与全仓 `eslint` 0 错误；Playwright 全量 **25/25 PASS**。证据：`handoff/EVIDENCE/ui-02-workbench-home.png`、`ui-02-workbench-filter.png`、`ui-02-observations-timeline.png`、`ui-02-gate-insight.png`。下一块：UI-03.1（统一决策详情页面）。

## UI-03 · Phase 1 视觉探索与原型验证 PASS

1. **审计报告与三套全新视觉概念交付**：
   - 完成现有 UI 布局、卡片过剩、同质化模板与排版层级的系统性审计；
   - 建立三套具有本质结构、排版与隐喻差异的高保真原型：
     - **01 Quiet Observatory**（安静精密的个人观测台）：天幕水平视野、发丝瞄准十字透镜、细线台账，极其克制舒适；
     - **02 Editorial Workspace**（具有编辑式排版气质的研究工作空间）：古典报头、非对称 63:37 社论双栏、首字下沉、学术引用警句与考据证据板；
     - **03 Instrument Studio**（现代精密仪器风格的 Agent 工作台）：19寸机架固定螺丝、沉降式示波器液晶视窗、十段式 LED VU 电平表、走带式事件步进器。
2. **源码与运行产物**：
   - 原型源码完整落地在 `prototypes/` 目录（15 个独立文件：3 套 CSS + 12 套独立 HTML 原型页面）；
   - 真实数据驱动：绑定真实 `hark`（Vitest 348 PASS）、`pindou`（JUnit 1 FAIL / 2 TOTAL）、真实 Git 散列（`c18faa1`）与真实规则（`R-TEST-FAILURE`）；
   - 严禁假数据与虚假模型思考态，完整支持浅色与深色主题切换。
3. **真实浏览器自动化截图验收**：
   - 编写 `scripts/capture-prototypes.ts`，由 Playwright 在 1440px 真实视口下完成全矩阵捕获；
   - 24 张高清全页面截图全部入库 `docs/design/screenshots/`；
   - 交付系统性设计报告 `docs/design/UI-03-CONCEPTS.md`，包含无色骨架对比图、独特性/使用舒适度/可维护性/实现成本四维对比矩阵与 Phase 2 实施路线图。
4. **门禁与状态**：
   - Phase 1 验收完成，所有原型及截图已生成；严禁在人工确认视觉方向前替换 `apps/web` 生产代码；
   - 下一步：等待用户选择视觉方向后，正式开启 Phase 2 生产组件重塑。
