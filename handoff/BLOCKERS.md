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
