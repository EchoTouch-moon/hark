# Blockers

> 每条记录复现命令、真实退出码、最小修复建议、是否需要人类操作。

| id | task | severity | reproduction | attempts | next action |
|---|---|---|---|---|---|
| — | — | — | 无未解决 blocker | — | — |

## 已解决（记录备查）

| id | 现象 | 根因 | 修复 | attempts |
|---|---|---|---|---|
| B1 | zod 3.25.0 安装后 vite 报 "Failed to resolve entry for package zod" | 镜像 tarball 缺 dist/ | 锁 3.24.1（ADR 见 DECISIONS） | 1 |
| B2 | pnpm 拒绝执行 esbuild postinstall | pnpm 11 构建脚本策略 | pnpm-workspace.yaml allowBuilds: esbuild: true | 1 |
| B3 | storage 测试 "[object Object]" is not valid JSON | parse() 假设入参为 JSON 字符串，而 rowToEvent 传对象 | parse 双模式（string→JSON.parse，object→直用） | 1 |
| B4 | API 测试全 401 | light-my-request set-cookie 返回 string 而非 string[]，[0] 取到 "h" | 兼容两种类型的 cookie 提取 | 1 |
| B5 | repeat discover 偶发 created:3（应为 0） | 模块级 rate-limiter 跨测试实例污染，首次 discover 吃 429 被忽略 | WeakMap 按 storage 实例隔离限流 | 1 |
| B6 | E2E 空态 401 / 页面无内容 | ① auth hook 守卫了静态路由 ② E2E 用相对 DB 路径落错目录且没 build web | hook 限定 /api/v1/*；E2E 绝对路径 + 前置 build | 3 |
| B7 | E2E-01 凌晨运行 cardsCreated=0 | quiet hours 正确拦截了用户显式扫描 | userInitiated 绕过静默（ADR-006） | 1 |
| B8 | 执行后 UI 停留「排队中」 | 轮询集合不含 proposed（execute 返回时 card 仍 proposed） | 轮询条件并入“存在非终态 run” | 1 |

## 诚实边界（非 blocker，需人审知悉）

1. **E2E-12（server 不可用页面态）**：浏览器级未模拟杀进程；以 client 重试逻辑 + ErrorState 单元路径覆盖，标注 NOT_RUN(browser)。
2. **SSE** 已实现端点但 UI 用轮询（见 DECISIONS）。
3. **M2 precision@3**：仅 5 事件 golden fixture（P=1.0），50 条标注基准集未建，报告 NOT_MEASURED。
4. **Hermes**：本机未配置（HEARTH_HERMES_URL 未设），probe 呈 unconfigured，未做任何真实连接。
5. **node:sqlite 为 experimental**：Node 22 内置，性能/稳定性对本 demo 足够；升级 Node 大版本前需回归 storage 测试。

## 2026-10-29 · P2-A live 更新

本次选定 StepFun 的真实请求已通；旧 Pi 认证阻塞对这一显式配置已解除。第一次真实分析因输出结构不匹配失败，补全提示合同后成功。无需用户提供密钥。复现配置见 README-dev.md，证据见 docs/verification/hearth-p2a-live-verification.md。剩余：建议质量待人工评价；ignored 文件未纳入指纹；英文/冗长建议及“先 commit/stash”措辞需后续按评价改进。

## 2026-10-29 · R2价值门禁未满足

工程可继续验证CI；人工价值基线缺少至少第二个真实项目、24条新增用户触发建议和30条逐项人工标签。现有6条历史建议收到“偏本地检查，希望发展/演进且更多元”的定性评价，已记录而未转换为虚构量化分数。恢复：用户触发真实分析并在docs/evaluation/recommendation-ratings.json逐项标注，再运行pnpm exec tsx scripts/score-recommendations.ts。不自动调用Pi补样本/不进入后续阶段。

## UI-REFRESH-01 · 第一块

当前无阻塞。后续导航/真实首页/按需抽屉和异步Run未实施，均明确列为PENDING；已有未跟踪截图与参考包保留。未运行全仓回归或远端CI，不宣称已通过。接班先查看分支codex/ui-refresh-01与tasks/UI-REFRESH-01.md。

## UI-REFRESH-01 · 第二块

当前无阻塞。已修复共享模式读取重构时的残留语句及旧测试误选折叠Mock导航的问题，最终19项浏览器通过。今日概览聚合/观察时间线/响应式详情仍为计划待办，未伪装已完成。

## UI-REFRESH-01 · 第三块

当前无阻塞。修复了 1024px 响应式样式中对 `:root` 变量覆盖优先级不足导致导航未收敛至 72px 的问题，以及窄屏下顶栏身份区被徽标挤压导致操作失焦的问题。全量 22 项 Playwright 浏览器测试已全部通过。UI-01 全部任务与阶段门禁均已达成。

## UI-REFRESH-01 · 第四块

当前无阻塞。
已解决问题：
1. 修复了 SPA 静态文件路由在处理带 query 参数的根路径（如 `/?projectId=...`）时抛出 `EISDIR` 500 异常；
2. 修复了 JUnit 报告中存在用例失败时的 `MIXED` 状态正确识别为测试失败 `FAILED`；
3. 修复了 Playwright E2E 定位器在匹配中文文本时的精确度与作用域限定。
目前全仓 348 项单元测试与 25 项 Playwright 浏览器集成测试全部通过，UI-02 阶段门禁正式通过。

## 2026-10-29 对话优先首页
- 本次无阻塞。真实 AI 对话不属于此次视觉实现，现有 Mock 能力已在页面标注。
- 旧 workbench 首页四区块布局断言对应已替换设计，本次以 `scripts/qa/focus-ui.mjs` 验证新首页；未运行完整历史 E2E 套件。

## 2026-10-30 Ember 动效
- 无本次实现阻塞。视觉待用户审阅；N2 真实故事片段、N3 同线程 Pi 闭环、暗色主题完整验收未完成，不能将本次结果当作完整产品周期验收。
- 集成回归发现旧 migration 测试期望版本 1，实际线程版本为 2；已修正断言并复测，详见 ember-motion/regression.log。

## 2026-10-30 桌面精修
- 本次无未解决阻塞。欢迎退出的GSAP context递归已修复，完整浏览器复测通过。
- 账号注册服务仍未实现；此次为本机欢迎/偏好初始化。真实故事卡、Pi同线程闭环不因视觉精修获得新能力。
- 构建有主bundle体积提示，尚未做按路由拆包性能专项；没有以此阻断已验证的桌面交互。全历史E2E及整站无障碍认证未在本次范围。

## 2026-10-30 叙事系统
- 本次无未解决实现阻塞。系统reduce、全局UI暂停及页面内导航已验证；OS级省电、整站无障碍认证未扩展验收。
- 真实故事连续性/跨会话决定需要未来持久化与来源合同，仍未实现；当前离线聊天标注保留。

## 2026-10-30 对话即炉心
- 本次无未解决的交互或构建阻塞。真实项目进展参与光场仍缺少明确的项目—线程关联及可追溯事实合同，保持候选；当前光强仅表示已保存交流。
- 未运行完整历史 E2E；旧 `ember-story` / `ember-craft` 脚本绑定已退役的火焰图标与旧导航，保留为历史证据。复现当前界面：使用隔离 Demo 服务 4403 后运行 `node scripts/qa/conversation-hearth.mjs`。

## 2026-10-30 昼夜炉心
- 本轮无已知实现阻塞；真实模型和可靠的项目—话题进展关联仍未接入，光强只表示已确认交流。
- 暗色画面已检查对话、欢迎、菜单、项目及设置，未进行整站无障碍认证或真实操作系统后台/省电测试。Web 构建保留既有的主包体积提示，后续可单独优化拆包。

## 2026-10-30 玻璃火影与动效精进
- 本轮无已知实现阻塞。修改涉及的前端组件与着色器全部通过类型校验、ESLint、单元测试及 Playwright 浏览器自动化检测。
- 静态资产 `living-fire.png` 引入了约 1.9MB 的打包资源，构建时有 chunk 大小提示；因其为本地优先单机桌面应用，不影响本地极速渲染和交互，后续如有需要可实施 webp 压缩或延迟加载。
- 真实大模型调用仍保持离线标注与 Mock 边界，未越过安全红线。

## 2026-10-30 本地预览
- 启动问题已修复，无新增阻塞；浏览器核验使用软件 WebGL，未代表所有实际 GPU 和浏览器性能。

## 2026-10-30 火影颜色
- 本次无新增阻塞；色彩核验基于桌面浏览器与软件 WebGL，其他屏幕色彩仍有设备差异。

## 2026-10-30 火焰五态对照
- 无截图阻塞。五态间的视觉辨识度问题已由对照图记录；本次为现状截图，不将其视为已修复。

## 2026-10-30 五态火影
- 无新增阻塞。对照与浏览器验证使用桌面环境、合成数据和软件 WebGL；未覆盖所有设备。前端构建仍有已有的包体大小提示。

## 2026-10-30 前端整理
- 无新增阻塞。需要重跑隔离浏览器验收时，按 `handoff/FRONTEND.md` 中的说明重新启动 4404 服务。

## 2026-10-30 MVP G0 阻断
- G0 方案待用户审阅和明确发起后续编码；G1–G5 NOT STARTED。旧线程主动建议未按项目过滤、模拟动作可能显示真实完成；先写负例并在真实模式隔离。
- PR #5/#6 的远端 CI 为 FAILURE（各 11 个浏览器 E2E 失败、3 未运行），不能继承历史 GREEN。完整 H1 的真实仓库范围、公开研究/模型授权与预算及人工价值评审尚未提供，分别标 BLOCKED / NOT_MEASURED；不要私自外发或调用付费服务。

## 2026-10-30 G0 修订待审
- 原 G0 为 CONDITIONAL_PASS，修订版尚需用户再次审阅；G1-A 不因本次反馈或文档修订自动获准。旧真实模式执行路径及跨项目问题尚未修复，CI 11 项失败与 3 项未运行尚未恢复。

## 2026-10-30 MVP G0 审查后
- G0 文档审查已 PASS，原“待再次审阅”阻断解除；G1-A 等待用户明确发起，旧执行入口安全问题和远端 CI 失败尚未修复。
