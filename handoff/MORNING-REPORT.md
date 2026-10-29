# Morning Report — 2026-10-28 夜间运行（主交付 HEAD: f076cb4，前序 145213c）

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
