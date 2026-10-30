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

## 2026-10-30 · 炉火生命历程与项目活力具象化 (Living Flame Lifecycle & Project Vitality)

### 状态：COMPLETED · PASS
- **核心目标**：将火焰与项目生命周期深度绑定，赋予火焰生命活力。
  1. **初火星 (spark)**：项目/话题刚创立，微火核 (0.12 heat)，轻柔静谧；
  2. **初生火苗 (sprout)**：随着交流逐步展开（1-2条有效消息），火苗起伏抽芽 (0.42-0.53 heat)；
  3. **繁盛之火 (blaze)**：持续深入对话与代码推进（3+有效消息），一团旺盛翻腾之火 (0.64-0.75+ heat)；
  4. **常明金火 (golden)**：项目卡片/任务圆满达成，转为澄澈温润的金黄色调 (`u_golden=1.0`)，平稳安宁守护成果；
  5. **静卧余烬 (dormant)**：项目被搁置/暂停观察或长期未活动，收敛于炉底深红炭火低态呼吸 (`u_dormant=1.0`)；
  6. **添柴激荡与火星散发 (stoke & sparks)**：每次扫描项目或手动添柴，触发 `stoke` 事件，火舌激荡上涌 (`u_surge`)，32 颗点精灵上升气流火星粒子喷薄飞升！
- **全链路页面覆盖**：
  - `AppShell`：中央状态计算与传参、顶栏菜单「炉火生命态卡片」与「🔥 添一把柴」快捷操作、`ProjectsPane` 中央炉火横幅与项目生命态徽标；
  - `EmberAtmosphere` & `flameRenderer`：GSAP 状态平滑过渡、WebGL Point-Sprite 上升气流火星粒子系统、双层磨砂玻璃色温与漫射折射；
  - `ChatPage`：空态 `ember-seed` 展示当前生命态卡片（阶段、诗意引言、行动建议、添柴按钮）；
  - `ProjectsPage` & `ObserverDetailPage`：项目卡片展示生命态徽标，添加「🔥 添柴扫描」交互。
- **验证证据**：
  - 自动化浏览器测试：`scripts/qa/living-flame-lifecycle.mjs` (全部 PASS)
  - 核心回归测试：`glass-fire.mjs` (PASS)、`day-night-hearth.mjs` (PASS)、`conversation-hearth.mjs` (PASS)、`conversation-hearth-motion.mjs` (PASS)
  - 单元测试：`npm test` 50 文件 / 381 用例全绿（含 `tests/unit/project-ember.test.ts`、`tests/unit/ember-cues.test.ts`）
  - 类型检查与代码规范：`npm run typecheck` (0 errors), `npm run lint` (0 errors)
  - 视觉与录屏证据：`handoff/EVIDENCE/living-flame/`（包含 6 张截图、全过程 webm 录屏与 test-summary.txt）

## 2026-10-30 · Teamwork 多代理系统级 GSAP 动效重构 (GSAP Full Overhaul & Specification)

### 状态：COMPLETED · VICTORY CONFIRMED
- **核心成果**：
  1. **权威规范文档落地 (`docs/MOTION-SPECIFICATION.md`)**：756 行详尽规范，完整定义动作隐喻、多代理矩阵、五重生命形态映射、GSAP 时间线分层体系与 WCAG 2.2 AA 降级；
  2. **动效核心引擎库 (`apps/web/src/motion/`)**：交付 `easing.ts`（物理缓动）、`emberMotion.ts`（门闩防护、插值与防孤儿补间）、`useHearthTimeline.ts`（React 18 / `contextSafe` 作用域生命周期 Hook）；
  3. **四大核心业务组件纯 GSAP 重构**：
     - `EmberAtmosphere.tsx`：统一 GSAP 控制器驱动 WebGL Shader uniforms 与点精灵粒子；
     - `flameRenderer.ts`：160 粒子 FIFO 淘汰、空气上升气流与微晃动模拟，上下文丢失/卸载拦截保护；
     - `ChatPage.tsx`：清除所有 CSS `@keyframes`，重写为 GSAP 物理弹性入场时间线、Seed 呼吸、FLIP 转换与添柴脉冲；
     - `AppShell.tsx`：炉火状态深度绑定至顶栏菜单，数值平滑插值、徽标 Flare 微光与无障碍瞬时吸附；
  4. **全量极限破坏性测试**：新增 `adversarial-lifecycle.test.ts`、`adversarial-deep-stress.test.ts`、`challenger-r2-2-stress.test.ts`，覆盖高频挂载/卸载、500 次并发销毁、10,000 粒子压力；
  5. **法医级独立胜利审计**：独立审计员通过 3 阶段审查，确认零作弊零伪造，裁决 **VICTORY CONFIRMED**！
- **验证指标**：
  - 单元/集成测试：**55 文件 / 438 测试用例 100% 全部通过 (0 失败，0 跳过)**；
  - 静态分析：`pnpm typecheck` 0 错误，`pnpm lint` 0 错误；
  - Web 应用构建：`pnpm --filter @hearth/web build` 顺利通过；
  - 真实浏览器自动化 E2E：`living-flame-lifecycle.mjs` 验证全链路通过。


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

## UI-03 · Phase 1 视觉探索与原型验证 PASS（扩展至 6 套全矩阵方案）

1. **审计报告与六套全新前卫视觉概念交付**：
   - 保留原先三套经典设计方案（01 Quiet Observatory、02 Editorial Workspace、03 Instrument Studio）；
   - 根据用户“更加有设计感、风格不拘一格、更为跳脱”的指令，新增三套前卫破界概念并完整重塑首页与项目详情页：
     - **04 Monolith Architect**（解构巨石与前卫建筑构造）：包豪斯/安藤忠雄野兽派建筑切角、纯正 0px 锋利构造、海报级超大紧缩字阶、工业警示带、荷载剖面图；
     - **05 Kinetic Cartography**（深场星图与航天测绘工坊）：极坐标动态雷达盘、同心圆轨道偏心率、晒蓝工程底纹、航天飞控蓝图与时空航迹时序；
     - **06 Luminescent Gallery**（前卫暗房与数字发光艺廊）：通透发光展柜、35mm 齿孔胶片带式提交历史、光学光圈与曝光指标、纯白立方留白艺术。
2. **源码与运行产物**：
   - 原型源码完整落地在 `prototypes/` 目录（30 个独立文件：6 套专属 CSS + 24 套独立 HTML 原型页面）；
   - 真实数据驱动：绑定真实 `hark`（Vitest 348 PASS）、`pindou`（JUnit 1 FAIL / 2 TOTAL）、真实 Git 散列（`c18faa1`）与真实规则（`R-TEST-FAILURE`）；
   - 完整支持浅色与深色主题切换，每套方案均具备内容态与空态。
3. **真实浏览器自动化截图验收**：
   - 更新 `scripts/capture-prototypes.ts`，由 Playwright 在 1440px 真实视口下完成全矩阵捕获；
   - 48 张高清全页面截图全部入库 `docs/design/screenshots/`；
   - 交付系统性设计报告 `docs/design/UI-03-CONCEPTS.md`，包含无色骨架对比图、独特性/使用舒适度/可维护性/实现成本四维对比矩阵与 Phase 2 实施路线图。
4. **门禁与状态**：
   - Phase 1 验收完成，所有原型及 48 张截图已生成；严禁在人工确认视觉方向前替换 `apps/web` 生产代码；
   - 下一步：等待用户从 6 套方案中选择最终视觉方向后，正式开启 Phase 2 生产组件重构。

## 2026-10-29 对话优先首页
- 已完成：按用户提供的两张参考图修改现有首页。暖白、炉火橙、雾山天文台；默认呈现当前状态与一条重点发现，其余内容按需查看。
- 首页对话复用本地 Mock API、持久会话、主动发送与停止等待；不声称接入真实 AI。
- 验证：Web build、全仓 typecheck、修改 TSX 的 ESLint；浏览器测试见 `handoff/EVIDENCE/focus-ui-browser.log`，截图 `focus-ui-desktop.png`、`focus-ui-mobile.png`、`focus-ui-attention.png`。
- 复放：启动独立 Demo 服务于 4399（静态目录为 apps/web/dist 的绝对路径；禁用观察器），运行 `node scripts/qa/focus-ui.mjs`。脚本重点事项通过拦截 overview 响应提供明确合成数据；本地 Mock 发送使用实际 API。

## 2026-10-30 Ember 叙事动效维护
- 分支 `codex/ember-narrative-motion`，合入新前端、G3 空会话修复及叙事规范。
- 已实现：从已确认消息计算炉温、失败不升温、首次点燃/复燃、持续挂载的输入井、默认收起历史、减少动态效果/暂停/后台停动效、手机消息区独立滚动。
- 证据：`handoff/EVIDENCE/ember-motion/`；实现说明 `docs/EMBER-MOTION-IMPLEMENTATION.md`。
- N0 人工视觉验收待定；N2/N3 未进入。当前仍是明确标注的 Mock 对话。

## 2026-10-30 Ember 桌面精修与欢迎生命周期
- 用户追加要求：先补叙事，再由子代理精修；明确不涉及手机，并指定实际使用 GSAP skill。
- 已补充根叙事、第13节首次进入/本地初始化/入席/回访；没有伪造账号注册后端。
- 两个替换子代理完成独立炉心 SVG、GSAP 时间线、欢迎与对话组件精修。主代理集成全局纸面/chrome并完成真实桌面验收。
- 证据：`handoff/EVIDENCE/ember-craft/`，包含8幕流程截图、三态放大实渲染截图、motion-preview.webm、browser.log/keyframes.log/regression.log。
- 50项适用测试通过，Web build/全仓typecheck/修改组件lint通过；真实浏览器验证GSAP路径在运行、暂停后保持、欢迎跳过/重看/存储失败和对话失败恢复。
- N0视觉仍由用户审阅；真实账号注册、真实模型、N2/N3不在本次精修范围。

## 2026-10-30 叙事系统与活的炉边
- 重写根叙事并新增docs/EMBER-STORY-SYSTEM.md：角色、三状态轴、九节拍、操作映射及产品发展优先级。
- 两个子代理完成三态持续火形/靠近交互与全局GSAP环境；主代理完成实际业务cue桥接、项目入口语义及真实结果反馈。
- 检查：54项适用测试、build/typecheck/修改TSX lint通过；三态运动、输入不加热、失败无确认回光、成功一次回光、全局暂停、话题切换/合成注册、reduce和合成后台暂停浏览器验收通过。旧欢迎全流程亦回归通过。
- 证据：handoff/EVIDENCE/ember-story；桌面1440/1280，未新增手机设计。

## 2026-10-30 对话即炉心
- 按用户反馈先整体调整根叙事及操作映射：页面光场即炉心，默认对话优先，用户可按需进入历史、项目和设置。
- 移除独立火焰/石头组件；欢迎与对话均使用中央流光。GSAP 驱动呼吸与互动响应，最近7天当前线程有效已确认用户消息按1–4次渐进暖化并封顶。
- 基于服务端 Zod 投影隔离旧本地消息叠层；回读不确定保留草稿、不提前升温。真实项目进展尚未与话题可靠关联，不伪称已推进。
- 检查：57项单元/服务测试、Web构建、全仓类型检查、局部lint通过；桌面浏览器验证渐进/封顶、话题隔离、失败与不确定回读、旧缓存、菜单/历史、欢迎、暂停/reduce与模拟后台恢复。证据 `handoff/EVIDENCE/conversation-hearth/`。

## 2026-10-30 昼夜炉心与对话状态
- 完成：先更新根叙事及状态映射；设备本地时间 07:00–18:59 为白天，其余为夜晚，跨界保留当前话题、草稿和焦点。昼夜只影响视觉，不表示项目进度或真实工作。
- 完成：GSAP 中央流光、错相光幕、昼夜呼吸、真实请求的等待/确认/失败响应；欢迎、菜单、项目和设置补充夜间可读性，手动暂停/减少动态效果/隐藏页可静止。
- 完成：话题切换时的草稿隔离和中断发送恢复提示；草稿仅存页面内存，不承诺跨刷新恢复。
- 检查：`pnpm test`、`pnpm typecheck`、修改文件 lint、Web build 和两个浏览器回归脚本。日志、截图、录屏与具体限制见 `handoff/EVIDENCE/day-night-hearth/`；桌面 1440×900 / 1280×800。静态构建仍有既有的 500 kB chunk 提示。

## 2026-10-30 磨砂玻璃活火与动效精进
- 完成：基于 WebGL 连续湍流火形着色器与真实火焰纹理双流合成，经由全局磨砂玻璃层（backdrop-filter）形成柔和翻动的橙色火影；白天暖白玻璃，夜晚深黑背景，火影为唯一暖色光源。
- 完成：菜单内火焰大小控制（0.65–1.40 键盘无障碍支持，localStorage 持久化），独立于交流温度；WebGL 丢失/降级时平滑切换至无脚本优雅静态兜底。
- 精进：修复着色器边界剪裁（添加纹理边缘平滑平坠 fade）、打字高频输入 GSAP timeline 重启跳变闪烁（改为动态平滑过渡）、昼夜切换磨砂背景突变（补充平滑过度与暂停同步）、全局暂停在 documentElement 上的穿透联动，清理欢迎组件废弃 CSS。
- 检查：`npm test`（49 测试套件 / 375 测试全通过）、`npm run typecheck`（退出码 0）、`npm run lint`（退出码 0，零错误）、`npm run build`（退出码 0）；Playwright `glass-fire.mjs` 7 项全绿，以及 `day-night-hearth.mjs`、`conversation-hearth.mjs` 历史全量回归无破坏。证据沉淀于 `handoff/EVIDENCE/living-fire/`。

## 2026-10-30 启动预览与火焰上下文修复
- 用户更新后的本地版本已重新构建并通过现有 4402 服务提供预览。浏览器以 4404 隔离合成数据检查，截图和日志见 `handoff/EVIDENCE/preview-2026-10-30/`。
- 修复渲染器清理时主动丢失 WebGL 上下文，导致 React 初始化后持续退回简化效果的问题；实测纹理加载、火焰逐帧更新、暂停和恢复均通过。构建与修改文件 lint 通过；完整套件本次未运行。
