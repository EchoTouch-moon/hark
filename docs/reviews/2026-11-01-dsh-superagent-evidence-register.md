# DeepSeek × Hearth 审查证据登记表

> 2026-11-01；静态审阅；DeepSeek `6337fc8`、Hearth `e470436`。索引不等于测试记录。本次无测试执行、没有外部 Agent 调用或真实网络副作用。

## 证据级别定义
- **SRC**：直接读取对应版本代码/文档；仅能证明静态实现。
- **GIT**：GitHub 分支、PR、提交及历史已有的 CI 记录；不代表本次运行通过。
- **DOC**：需求/方案；尚未证实落地。
- **UNVERIFIED**：动态可利用性、部署行为、用户价值或正式性能均未验证。

| ID | 类型 | 来源（固定版本） | 支撑的事实 | 未覆盖 / 反例 |
|---|---|---|---|---|
| E01 | SRC | [DeepSeek README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md) | 研究原型、单仓 GitHub，飞书可选；非官方产品、与内部/文章不一致 | 文章未落地机制不能借此证明 |
| E02 | SRC | [000 philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md) | 人类注意力成本与规则先行 | 没有量化 Hearth 用户收益 |
| E03 | SRC | [001 domain](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/001-domain.md) | Source、Trigger、Eval、Mandate、Ticket、Assignment、Subscription 的职责 | 并非 Hearth 必须复制整套对象 |
| E04 | SRC | [002 authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md), [policy.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts) | off/observe(default)/auto、显式与推断准入、策略版本、恢复重验 | DeepSeek 已启动 Ticket 的策略变动不总是立即中止，Hearth 更严格 |
| E05 | SRC | [intake.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts), [tickets.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/tickets.ts) | 来源过滤、去重、Thread Subscription 直送 | 上下文输入不是新授权 |
| E06 | SRC | [003 execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md), [dsh.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts) | Worker/Assignment/恢复机制；Worker 按 OS 用户执行 | 不能认为其为沙箱或符合 Hearth 用户单次确认 |
| E07 | SRC | [effects.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts), [outbox.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts), [replies.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/replies.ts) | 持久消息、重试、回执、排序和本地幂等 | 外部发送完成但本地崩溃时不等于 exactly once |
| E08 | SRC | [cache.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/cache.ts), [007 architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md) | 按资源 ID 分页读取与大小限制、LRU | 不证明完整 Context Runtime 及 Fact-Loss 改善 |
| E09 | SRC | [threads.ts L175–235](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/threads.ts#L175-L235) | GET 可能写 Thread；listCards 全局 proposed | 动态信息泄露、实际权限影响未测试 |
| E10 | SRC | [threads.ts L239–328](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/threads.ts#L239-L328) | 客户端 demo:false 可令 Mock 结果文本标记完成，ok:true | 不表明实际调用外部执行器 |
| E11 | SRC | [runs.ts L19–68](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/runs.ts#L19-L68) | execute/approval/cancel 路由仍可达且执行动作调用 | 要核对全局 middleware 和 Demo 隔离，不能仅依据路由宣称漏洞被利用 |
| E12 | SRC | [hearth.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/hearth.ts), [permissions](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/permissions.ts) | GET 只读设计与 PUT observe Origin 校验；execute:false | Origin/CSRF 等真实浏览器环境防护尚待复核 |
| E13 | SRC | [observe-view.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/observe-view.ts), [contracts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/hearth-contract/src/index.ts), [web VM](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/web/src/features/hearthViewModel.tsx) | M1/M2/I1 局部实现，错误态不回退 fixture | featuredOpinion:null 不证明意见引擎完成 |
| E14 | DOC | [G0 合同](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/02-contract-and-decisions.md), [分闸](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/03-plan-threats-traceability.md), [UX VM](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md) | 四类权限分离、研究预算、OpinionRevision、执行禁令 | 大量项仍是设计，非当前落地 |
| E15 | DOC | [G0 历史审计](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/01-architecture-audit.md), [旧路由审计](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/04-ci-and-legacy-route-review.md) | H-P0-01/02/03 是已知历史问题，非本报告首次发现 | 需复验修复前后真实入口 |
| E16 | GIT | [PR #8](https://github.com/EchoTouch-moon/hark/pull/8), [#9](https://github.com/EchoTouch-moon/hark/pull/9), [#10](https://github.com/EchoTouch-moon/hark/pull/10), [#11](https://github.com/EchoTouch-moon/hark/pull/11) | 四项阶段已有合并记录，G0旧 NOT STARTED 表并非当前状态全貌 | 未验证每一条新端到端场景 |
| E17 | DOC | [H1 验收](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/03-ACCEPTANCE-SCENARIOS.md), [R2 旧质量记录](https://github.com/EchoTouch-moon/hark/blob/e5752ce7894d77461e780c84609c7fe26d6ccf61/docs/verification/remediation-r2.md) | H1 需要真实项目/来源/观点/反馈；价值测量不可伪报 | 本次 NOT_MEASURED |
| E18 | DOC | [Canvas Context Runtime v0.4](https://github.com/EchoTouch-moon/canvas-agent/blob/main/docs/research/context-runtime-v0.4-direction.zh-CN.md) | R2/R3 compaction 后事实保持是既定研究闸门 | 本次未运行任何 compaction |
| E19 | UNVERIFIED | 运行 DeepSeek Harness 与 Super-agent | 未部署、未运行 `pnpm check`、未复现实验 | 所有运行时性能判断必须保持未测 |
| E20 | UNVERIFIED | Hearth 动态攻击与端到端 | 没有跑 e2e / provider / H1 / 真实项目写保护对比 | 不能标 PASS、已修复或安全认证 |

## 报告可追踪规则

1. 新审计发现必须同时给“代码路径 + 锚点 + 风险的必要前提 + 当前状态 + 复验负例”。
2. 文档对比不是漏洞验证；静态可达与生产可利用性分开写。
3. 自称代码、PR 或自动化“运行成功”必须附新运行 ID、时间、提交 SHA 和完整失败项；本轮不提供虚构日志。
4. 关键证据只在不可变 commit SHA 链接上核查，不用移动 `master` 作为历史审计真相。
5. 仍以 G0 原合同作为约束上界。审查建议不是修改用户授权。
