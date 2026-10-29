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
