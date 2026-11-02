# Morning Report — 2026-10-28 夜间运行（主交付 HEAD: f076cb4，前序 145213c）

## 2026-11-02 · D-01 复审问题跟进

修复 Demo 首次播种条件，添加真实 startServer 测试；reset 在存在来源不明数据时拒绝并保留审计。两份安全审查文档已更新并将旧结论标为历史。本机合成测试、typecheck、lint、build 和 macOS Mock E2E 已通过，具体数字和日志见 `handoff/EVIDENCE/d01-followup-2026-11-02/`。Linux/Windows CI 与最终复审以 PR #29 的新 head 为准；未合并或修改 G2。

**状态**：M0 ✅ GREEN · M1 ✅ GREEN · M2 ✅ GREEN（P1 范围；precision@3 诚实标注 NOT_MEASURED）

## 1. 真实环境
- OS：macOS darwin 27.0.0 arm64；Node v22.23.2；pnpm 11.9.0；git 2.49.0；python3 3.9.6
- 仓库：`/Users/v/new-idea/hark`（本仓库内 git init，未推任何远端）
- 主交付 HEAD：`f076cb4`（收尾含首启 seed 修复；14 个本地 commit，未推送任何远端）
- 运行命令与端口：
  - API/一体化运行：`pnpm dev:server` → **http://127.0.0.1:4317**（首启自动 seed+discover；同端口伺服已构建 UI）
  - 纯前端开发：`pnpm dev:web` → http://localhost:5173（/api 代理到 4317）
  - E2E：`pnpm test:e2e`（自起 4321 端口独立实例 + 独立 DB `data/e2e.sqlite`）

## 2. 实际交付（20/20 overnight 任务 DONE，progress.json 同步）
- **M0**：Zod 严格合同（DTO+状态机+canonical/sha256 纯 TS）、策略引擎（动作注册表/digest 审批/路径防逃逸）、SQLite（node:sqlite，显式 migration/WAL/FK）、fixtures/eval 复放框架
- **M1**：Fastify localhost API（会话+CSRF+Origin、SSE 端点）、规则发现/去重/抑制、Run 编排（MockExecutor 真实写 `.hearth-demo-artifacts`、独立 Verifier、重启恢复）、React UI 全五页（Home/Chat/Projects/Activity/Settings，中文、空/错/加载态、1280/1440 无横滚）
- **M2**：确定性评分（golden precision@3=1.0）、静默时段（IANA 时区+DST 测试）/每日预算/忽略冷却（用户显式扫描不被静默拦截，ADR-006）、Hermes 只读 probe（未配置→诚实 unconfigured）
- **并行方式**：4 个子 Agent（eval、UI shell、Home、Projects/Activity/Settings），合同/存储/权限/编排由主 Agent 串行收口；子 Agent 不 commit，主 Agent 统一验证合并

## 3. 测试摘要（全部真实 exit code，证据在 handoff/EVIDENCE/）
| 命令 | exit code | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 全仓 strict 通过（含 web 独立检查） |
| `pnpm test` | 0 | **12 files / 131 tests**（contracts 32、policy 17、storage 13、eval 16、verifier 6、orchestrator 8、discovery 15、scoring 7、server api 20…） |
| `pnpm lint` | 0 | eslint 9 flat config |
| `pnpm build` | 0 | web vite build（341KB js）+ server esbuild bundle |
| `pnpm test:e2e` | 0 | **11 passed / 0 failed**（Playwright 1.64.1 + chromium-1248） |
| 安全负例 | 0 | S01–S12 全部有真实断言（policy/api/e2e 分层，见 m1-gate.txt 映射） |

## 4. Demo 演示路径（明早照此点击）
1. `pnpm build && pnpm dev:server` → 打开 http://127.0.0.1:4317
2. **Home**：3 张合成卡（CI 诊断/实验清单/会议草稿），每张有 whyNow/来源/风险/TTL
3. **硬闭环**：CI 卡「查看证据」→ 见 fixture 来源与事件 → 「开始处理」→ queued→executing→verifying→completed（步骤实时轮询）→「查看 Run」进 Activity：3 个步骤、sha256、artifact 路径
4. **验证产物**：`.hearth-demo-artifacts/report/ci-42.json`（真实文件，Verifier 独立重算 hash 才置 completed）
5. **刷新/重启**：状态保留（E2E-03 + demo-run.json 里真实 kill-restart 记录）
6. **负例**：双击同卡幂等（同 run）；忽略后不再重现；跨项目查询服务端隔离；未审批 L2 零执行器步骤（API 级断言）
7. **Chat**：输入即回（明确「离线演示 · 不连接模型」），记录持久化
8. **Settings**：安静时段/预算/时区可保存；「重置 Demo 数据」需二次确认且只清 demo DB

## 5. Git / 证据
- 14 个本地 commit（eadc0d7 → f076cb4），未推送任何远端
- 截图：`handoff/EVIDENCE/ui-{home,chat,projects,activity,settings}.png`（Playwright 实拍）
- 闭环 trace：`demo-run.json`；审计快照：`morning-audit-snapshot.json`；每任务证据 txt 共 12 份

## 6. 已知边界与下一阶段优先项
1. E2E-12 浏览器级断服模拟未做（client 重试+ErrorState 已覆盖路径）；SSE 端点已备、UI 暂用轮询
2. 50 条标注基准集未建 → precision@3 NOT_MEASURED（现有 golden 5 条 = 1.0）
3. Hermes 未配置（不请求密钥、不假装在线）；真实 connector 全 OFF
4. 下一步建议顺序：真实 connector 只读接入评审（M2 文档）→ 50 条基准集 → SSE UI 消费 → M3 browser handoff（人工评审后）

## 7. 用户审批事项（今晚零越权）
未访问 personal-vault/memory-vault；未碰 Hermes 配置；无 sudo/Docker/远端推送/邮件/支付；所有密钥类操作为零（PROVIDER_BUDGET=0，无付费 API）。真实副作用接入一律等你明早批准。

## 2026-10-29 · P2-A Live Verification 增量交付

真实 stepfun-plan/step-5-preview 在 pindou 上生成建议卡，工程闭环 PASS；默认 Mock 保留。修复 Provider 扩展注册缺失、显式模型选择、结构化输出合同和 UI 来源标识。全仓 306 tests、类型检查、改动文件 lint、web build 通过。未执行模型建议、未更改 pindou、未修改全局 Pi/Hermes 配置。人工有用性判断尚未完成，未进入 P2-B/C。详情与截图：docs/verification/hearth-p2a-live-verification.md、handoff/EVIDENCE/p2a-live-card.png。原有工作区改动保留；全仓 diff-check 的既有空白问题不属于此次变更。

## 2026-10-29 · R0/R1/R2整改增量

R0 PASS（cca95e0），R1 PASS（1642215）。R2工程本地检查通过：343测试、typecheck、lint零错误、完整build、16项E2E。隐私预览/逐次确认与持久化记录、排除路径、稳定上下文、真实模式与Mock标识、反馈、README及最小CI已实现；远端CI需以新运行确认。R2人工价值门禁NOT_MEASURED，用户定性反馈已保存，未执行新的真实模型请求。数据migration至analysis v4；启动补偿清理任务，不自动重试中断模型。运行方式与限制见README及docs/verification/remediation-r*.md。

远端补充：GitHub CI Run40836527163对00121a2实际通过，job2m31s；完整源码已推送私有仓库。R2仅人工价值门禁未通过，不能用CI替代。后续本批只有验收记录更新，不变更已通过源码。

## UI-REFRESH-01 · 第一块交付

本地分支codex/ui-refresh-01，主题基础与空详情隐藏已完成，web build/typecheck、局部lint、新浏览器1场景与基础对比度检查通过。尚未重构真实首页、导航或分析API，未进入P2-B/C。继续执行从tasks/UI-REFRESH-01.md最新交接开始；本块不推送以保留小步本地交付。

## UI-REFRESH-01 · 第二块交付

UI-01.2基础完成：真实根页只读洞察、Demo受模式门禁、Mock/Demo次级导航，真实项目页无合成项目请求。web build、全仓typecheck、改动文件lint及全19项E2E通过，证据ui-01-mode-*。下一步UI-01.3响应式导航/详情焦点交互，接班读tasks/UI-REFRESH-01.md末尾。不推送、不调用Pi、不宣称R2价值通过。

## UI-REFRESH-01 · 第三块交付（UI-01 阶段门禁 PASS）

UI-01.3完成：响应式导航（1024px紧凑72px图标导航并保留可访问名称、>=1280px 200px）、主内容最大1200px居中；按需详情面板（空时不渲染、>=1600px 360px内联列、1024/1440px覆盖式抽屉、600px底部模态）；顶栏常驻说明；Esc/关闭按钮/点击遮罩退出并自动归还焦点。全仓typecheck、web build、lint零错误、Playwright全量22/22通过。证据：handoff/EVIDENCE/ui-01-layout-*。至此UI-01全部完成并通过阶段门禁。下一步进入UI-02.1（只读overview聚合接口）。

## UI-REFRESH-01 · 第四块交付（UI-02 阶段门禁 PASS）

UI-02 完成（UI-02.1、UI-02.2、UI-02.3 全部交付）：
1. 只读概览聚合接口 `GET /api/v1/overview?projectId=…`：有界聚合优先最多 3 条 Insight、全部项目摘要、最近 10 条真实观察事件、分区独立可用性（`AVAILABLE`/`DEGRADED`/`UNAVAILABLE`）；零模型调用；
2. 真实项目工作台首页（`/`）：四大固定区域（今日概览叙事与三大核心指标、值得关注列表、项目概况网格、最近观察记录），状态文案覆盖未登记/无信号/全部正常/待关注/降级/暂停，URL 项目筛选 `?projectId=...` 同步与刷新恢复，旧 Demo 移至 `/demo`；
3. 真实观察时间线（`/observations`）与导航：主导航正式加入“观察记录”入口，时间线倒序展示真实事件与来源质量，支持项目筛选与保留分页的加载更多；
4. 活跃页面 3 秒只读非重叠静默轮询：后台标签页自动暂停轮询，切回前台立即单次刷新；
5. 发现与建议（`InsightsPage`）：增加“发现列表”与“分析建议历史”双视图，项目标签采用真实项目名称映射；
6. 阶段门禁通过：合成 JUnit 失败测试报告自动经后台流水线生成新 Insight 并呈现在首页，重复扫描不重复展示，全过程零模型调用；
7. 验收测试：全仓 43 文件 / 348 个单测 PASS；全仓 `typecheck` PASS；`eslint` 0 错误；Playwright **25/25 PASS**。证据：`handoff/EVIDENCE/ui-02-workbench-home.png`、`ui-02-workbench-filter.png`、`ui-02-observations-timeline.png`、`ui-02-gate-insight.png`。下一步进入 UI-03.1。

## 2026-10-29 首页视觉与交互改版
- 已完成对话优先首页：重点事项、按需证据、快捷提示、可发送及停止等待的输入框、可折叠持久会话；桌面及手机布局。
- 实际数据继续来自 overview；无项目、无法连接、部分来源不可用分别展示相应状态；对话清楚标注离线演示。
- 检查证据：`handoff/EVIDENCE/focus-ui-{build,typecheck,lint,browser}.log`；截图同目录。重点卡截图为合成验收数据。
- 运行：`pnpm dev:server` 与 `pnpm dev:web`，访问本地 5173；生产静态构建 `pnpm --filter @hearth/web build`。
- 范围：修改首页与首页外壳样式；未接入真实模型，未做外部发布，未运行完整历史 E2E。旧首页四区块布局测试需随新设计调整。

## 2026-10-30 Ember 叙事与动效
- 本地分支 `codex/ember-narrative-motion` 集成新的前端设计、空会话修复和根叙事规范。
- 完成炉温真实性修复、点燃/复燃、输入井位置过渡、焦点和失败草稿恢复、动效暂停/减少动态效果、手机滚动布局维护。
- 本地预览 4401 使用独立合成数据库；常规运行仍为 `pnpm dev:server` + `pnpm dev:web`。
- 适用检查和截图/录屏在 `handoff/EVIDENCE/ember-motion/`；完整实现和未实现能力见 `docs/EMBER-MOTION-IMPLEMENTATION.md`。
- 尚未发布，未接真实聊天模型，未宣告 N0/N2/N3 或完整历史 E2E 验收通过。

## 2026-10-30 追加：桌面欢迎与炉心精修
- 完成叙事补充及可运行的初光→可选称呼→入席→真实发送后点燃；欢迎可返回/跳过/重看，本地保存失败可临时进入。
- 炉心重做为三套非对称SVG轮廓、半透明内焰、亮丝/炭纹，GSAP点燃core→wings→mantle，持续火舌错相与轮廓形变；暂停/隐藏原地恢复，reduce静帧。
- 排版、纸面、输入井、消息/小卡、按钮与chrome精修；按用户澄清仅桌面，不扩展手机设计。
- 适用检查：50测试通过、build/typecheck/lint通过；真实浏览器完整流程和GSAP运动/暂停采样通过。文件位于handoff/EVIDENCE/ember-craft。
- 预览 http://127.0.0.1:4402/ 使用独立合成数据库；完成过欢迎的浏览器可点“重看欢迎”。正常开发启动命令保持不变。
- 未发布、未推送；账号后端和真实模型未新增。最终视觉需要用户审阅，不能把自动检查等同于美学验收。

## 2026-10-30 追加：活的炉边叙事
- 已先重构完整叙事，再将火体/房间/输入/项目操作映射为可实现的动作语汇；根NARRATIVE.md与EMBER-STORY-SYSTEM.md记录产品发展边界。
- 三态火尖持续运动，靠近轻倾，输入短回应；页面下缘火形、侧光和纸面呼吸使用GSAP。确认消息、失败、取消、切换与成功添加项目分别映射，不能冒充任务已完成。
- 54项适用测试及真实浏览器叙事/旧欢迎回归通过；证据handoff/EVIDENCE/ember-story，录屏living-hearth.webm。
- 本地4402预览继续可用；无远程推送、无外部发布、无真实账号或模型新接入。本次仍仅桌面。

## 2026-10-30 追加：对话即炉心
- 已先重写 NARRATIVE.md，再将页面改为中央对话与连续暖光；无独立火焰/石头，欢迎也使用同一视觉语汇。项目、历史、设置与动效控制保留为按需菜单。
- 对话光强基于当前线程服务端确认的消息渐进、封顶和随时间衰减；失败、未确认回读、旧本地叠层不误加热。项目真实推进尚不参与计算。
- 实际完成桌面 1440×900 / 1280×800 验证、57项适用测试、构建、类型检查与lint。截图、录屏与日志在 `handoff/EVIDENCE/conversation-hearth/`，复现脚本 `scripts/qa/conversation-hearth.mjs`。
- 预览 http://127.0.0.1:4402/ 与当前打开的会话可用；4403是隔离合成验收服务。未引入真实模型/账号，也未推送远端。

## 2026-10-30 追加：昼夜炉心与细分交互
- 先补充昼夜叙事，再实现昼夜空间、欢迎页、输入、真实等待、确认、失败、切换与暂停；GSAP 多层流光和呼吸夜间放慢，光强仍只来自当前话题的已确认交流。
- 按话题暂存未发送草稿。中途切换会提示发送结果可能不确定；草稿保存在当前页面内存，刷新或关闭后不保证恢复。
- 桌面浏览器测试、截图和录屏：`handoff/EVIDENCE/day-night-hearth/`；完整单元测试、全仓类型检查、修改文件 lint、Web build 均已运行。结果、构建提示及运行方式见证据目录的 `README.md`。
- 本地预览仍为 http://127.0.0.1:4402/；昼夜按设备时间显示。测试使用独立合成数据库和 4404。当前对话仍是离线 Mock，真实模型与项目进展关联未新增；未推送远端。

## 2026-10-30 完工：磨砂玻璃活火与动效精进
- 动效革新：将原有平铺光幕升级为 WebGL 真实湍流与双流合成的有机活火，透过磨砂玻璃层（backdrop-filter）漫射出柔和橙色火影；白天暖白玻璃，夜间深黑空间，火影作为全屋唯一光源。
- 动效精进与缺陷修复：
  1. 消除湍流扭曲在纹理边缘的硬裁切缝隙（Shader 添加边沿平滑淡出）；
  2. 修复高频输入打字时 GSAP timeline 重置造成的脉冲闪烁跳变，改为动态平滑插值过渡；
  3. 修复昼夜切换时磨砂玻璃底色无平滑过渡的突跳问题，并与暂停动效状态联动；
  4. 修复动效暂停偏好在 documentElement 与全域 CSS 动画之间的穿透暂停链路；
  5. 清理欢迎组件废弃的纸面与呼吸样式，完善火势大小（0.65–1.40）键盘控制与本地持久化。
- 自动化验收与证据：全套单元测试 375 PASS、类型检查 PASS、ESLint 0 错误、Web build 成功；Playwright 真实浏览器 `scripts/qa/glass-fire.mjs`（7 项全绿）、`day-night-hearth.mjs` 与 `conversation-hearth.mjs` 历史全套回归通过；证据归档于 `handoff/EVIDENCE/living-fire/`。
- 依然遵循安全红线：无远端推送、无真实外部大模型或真实隐私目录访问。

## 2026-10-30 完工：火焰生命赋予与项目全周期联动 (Living Flame Lifecycle)
- **核心理念**：将火焰赋予生命，让整个项目跟着火焰状态走。
  - **初火星 (spark)**：项目/话题刚创立，微火核 (0.12 heat)，轻柔静谧，正如夜空初绽的一粒火星；
  - **初生火苗 (sprout)**：随着交流逐步展开（1-2条有效消息），火苗起伏抽芽 (0.42-0.53 heat)；
  - **繁盛之火 (blaze)**：持续深入对话与代码推进（3+有效消息），一团旺盛翻腾之火 (0.64-0.75+ heat)；
  - **常明金火 (golden)**：项目卡片/任务圆满达成，转为澄澈温润的金黄色调 (`u_golden=1.0`)，平稳安宁守护成果；
  - **静卧余烬 (dormant)**：项目被搁置/暂停观察或长期未活动，收敛于炉底深红炭火低态呼吸 (`u_dormant=1.0`)；
  - **添柴激荡与火星散发 (stoke & sparks)**：每次扫描项目或手动添柴，触发 `stoke` 事件，火舌激荡上涌 (`u_surge`)，32 颗点精灵上升气流火星粒子喷薄飞升！
- **全链路实现**：
  1. `projectEmber.ts`：纯函数生命态推演引擎，结合会话消息量、最近活跃度、项目启用状态及卡片完成率；
  2. `flameRenderer.ts`：升级 WebGL Fragment Shader 与 Point-Sprite 火星粒子系统，支持微小环境火星与上升气流粒子群；
  3. `EmberAtmosphere`：GSAP 多参数平滑过渡与双层磨砂玻璃色温漫射折射；
  4. `ChatPage`：空态卡片实时展示当前生命态阶段（徽标、诗意引言、行动指引与添柴按钮）；
  5. `AppShell`：顶栏菜单展示项目生命态与添柴快捷按钮，`ProjectsPane` 展示中央炉火横幅与项目生命态徽标；
  6. `ProjectsPage` & `ObserverDetailPage`：项目卡片展示生命态徽标，立即扫描动作绑定添柴激荡与火星飞升。
- **全量测试与验证**：
  - 自动化浏览器测试：`scripts/qa/living-flame-lifecycle.mjs` (ALL PASS)；
  - 全套回归：`glass-fire.mjs`、`day-night-hearth.mjs`、`conversation-hearth.mjs`、`conversation-hearth-motion.mjs` (ALL PASS)；
  - 单元测试：`npm test` 50 文件 / 381 用例全绿；
  - 静态检查：`npm run typecheck` 0 错误，`npm run lint` 0 错误；
  - 证据归档：截图与录屏存入 `handoff/EVIDENCE/living-flame/`。
- 绝无远端推送、无外部未授权调用，遵循 AGENTS.md 全部红线。

## 2026-10-30 本地启动预览
- 最新前端已构建，现有本地预览为 http://127.0.0.1:4402/；测试使用 4404 独立合成数据库。
- 修复主动丢失 WebGL 上下文导致的非预期降级，浏览器确认渲染、暂停及恢复；证据 `handoff/EVIDENCE/preview-2026-10-30/`。本次只做局部构建和 lint，未运行全量测试。

## 2026-10-30 火影颜色
- 调整透明边缘合成与暖色调，缓解发黑；桌面白天/夜间截图及浏览器动效检查在 `handoff/EVIDENCE/flame-color-2026-10-30/`。Web build 与改动文件 lint 通过；未运行全量测试。

## 2026-10-30 火焰状态截图
- 已生成白天、夜间五态截图与初火星完整页面，见 `handoff/EVIDENCE/flame-states-2026-10-30/`。均由合成输入驱动真实渲染；同一尺寸及稳定帧。
- 当前初火星/初生火苗使用同一纹理且尺寸差异约 6%，磨砂后不易分辨；本轮未改动产品视觉或状态逻辑。

## 2026-10-30 五态火影与动效
- 已完成火星、小火苗、繁盛、金火和余烬的比例及呼吸差异；保留磨砂玻璃和昼夜配色，GSAP 在阶段间平滑过渡。
- 相关 67 项测试、类型检查、构建、修改文件 lint 和浏览器验证通过；图片及录屏在 `handoff/EVIDENCE/flame-shapes-refined/`。桌面预览为 http://127.0.0.1:4402/，浏览器可能需要刷新以加载新版本。

## 2026-10-30 前端整理
- 已汇总前端入口至 `handoff/FRONTEND.md`，关闭不再使用的四个旧验收服务，清除 Vitest 缓存。4402 当前预览与唯一前端构建保留，历史原型、截图和本地数据保留。

## 2026-10-30 MVP G0 审计交接
- 已提交 G0 待审设计到 `docs/mvp/g0/`，包含差距、复用、合同、ADR、威胁、G1–G5 和 H1/N01–N24 追踪。没有业务编码、真实研究、模型调用或远程写入。
- 局部 46 项测试通过；PR #5/#6 的实际 CI 失败，G0 Gate 待用户审阅，真实闭环未验证。详见 `handoff/EVIDENCE/mvp-g0/README.md`。

## 2026-10-30 G0 审查整改
- 已按用户 CONDITIONAL_PASS 反馈修订 G0 合同与阶段计划，细化授权主题周期扫描、三类证据、只读 GET 和幂等投递、旧执行入口以及 11 个 CI 失败处理；修订版待再次审阅。
- 没有业务编码、新测试运行、真实外发、GitHub 推送或合并；G1–G5 均未启动。
