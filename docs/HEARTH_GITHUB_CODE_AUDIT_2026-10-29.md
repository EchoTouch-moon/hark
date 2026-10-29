# Hearth GitHub 代码审查与把关报告

- 审查日期：2026-10-29
- 仓库：[EchoTouch-moon/hark](https://github.com/EchoTouch-moon/hark)（私有仓库）
- 默认分支：`master`
- 审查基线：[`3c2c90961aad68f4ff0452c9cd5f8c65b82641a5`](https://github.com/EchoTouch-moon/hark/commit/3c2c90961aad68f4ff0452c9cd5f8c65b82641a5)
- 审查方式：通过已连接 GitHub 读取远端树（443 个路径）、核心源文件、测试和验收文档；**静态审查**，没有在本地克隆运行测试、没有修改仓库。
- 证据强度：对“代码中有/无某条调用”等给出直接文件依据；测试通过数量来自仓库留存的证据，不等于本次独立执行。

## 决策摘要

**结论：保留架构、先修关键缺口，再扩展 P2-B/C 和主动提醒。**

现有 Project Observer、Signal Inbox、Insight Engine、Episode、Feed 以及 Pi 真实分析链路，已具备从监测到人工触发建议的技术基础。GitHub 中另有原先的 Demo Discovery/ActionCard/Orchestrator 管线，两条产品链尚未真正收敛。当前缺少 Observer→Insight 的常驻自动消费调度，因此不宜宣传为无需操作即可主动管理项目。真实 StepFun/Pi 调用有已归档证据，但建议有用性尚待人审。

## 审查发现（按优先级）

### BLOCKER — 下一轮首先修复

**H-01：Observer→Insight 缺少运行时自动消费连接。**

- 证据：[apps/server/src/main.ts](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/main.ts) 创建 Observer、InsightStore、AnalysisService 并启动 observer，但未实例化/驱动 `InsightConsumer.consumeProjectBatch` 或 `processProjectRules`。二者存在于 [packages/project-insight/src/consume.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-insight/src/consume.ts) 与 [insights/processor.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-insight/src/insights/processor.ts)。
- 后果：新增 Git 事实可能不会自动进入 Signal Inbox/Insight；Feed 很可能只显示预先生成的结果。**能力已实现不等于能力已编排上线。**
- 建议：实现轻量、受限、可恢复的本地消费协调器（定时对账或事件提示+周期对账），在同一项目内按 Observer→Signal→规则顺序推进，使用已有的消费 checkpoint，保留 no-signal 零写入语义；断流需冻结而非静默重置。
- 验收：在隔离仓库制造已声明 JUnit 失败，不调用任何手动消费脚本，页面最终出现且仅出现一张有证据的 Insight；重启、重复扫描、删除/重注册、无变化期间均符合原门禁。

**H-02：Analysis 进程崩溃可能让项目长期卡在 running。**

- 证据：[analysis service](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/engine/service.ts) 的 `start` 检查 `runningCount(projectId)>0`；[store](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/store/store.ts) 将 running 持久化；[server main](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/main.ts) 只对旧 `Orchestrator` 调用 `recoverInterrupted()`，未恢复 Analysis Run。
- 后果：进程被 kill/crash 后，旧记录可能永远阻止这个项目的新分析。
- 建议：服务启动时把遗留 `queued/running` 转为 `interrupted` 或带明示原因的 failed，保留审计记录；不自动重复产生费用。
- 验收：分析进行中强制退出进程，重启后能重新分析；旧 Run 可查看且明确显示中断。

**H-03：旧 Run 的取消请求可能误取消同项目的新 Run。**

- 证据：[analysis route](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/analysis.ts) 在 `POST /runs/:id/cancel` 查询旧 Run 后调用 `analysis.cancel(run.projectId)`；[service](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/engine/service.ts) 以 projectId 寻找唯一运行中 controller，没有校验所请求的 runId。
- 后果：用户针对历史 Run 的取消命令可能取消另一个较新的正在运行的 Run。
- 建议：运行态按 `runId` 索引；必须匹配正在运行的同一 Run，历史/终态请求只返回幂等结果，不干预新 Run。
- 验收：创建 A→完成 A→启动 B→取消 A，B 不能被取消。

### HIGH — 与上述一起修复

**H-04：项目/Insight/Analysis 关联缺少完整校验。**

- 证据：[analysis route](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/analysis.ts) 接受任意 `projectId`、`insightId` 组合；[service](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/engine/service.ts) 未验证 `insightId` 是否属于该项目、是否存在、epoch 是否匹配；[context assembly](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/context/assemble.ts) 只取项目最新最多 8 条洞察，不保证包含用户点击的目标洞察。
- 建议：Insight 入口强校验目标、epoch 和 evidence 状态，将指定 Insight 的事实/理由置于上下文优先位；错配返回 400/409。
- 验收：跨项目/不存在/已删 Insight ID 被拒；分析内容针对被点击的具体洞察。

**H-05：删除项目未统一清理 Analysis 数据。**

- 证据：[observer DELETE route](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/observer.ts) 执行 `observer.removeProject(id)` 和 `deps.insight?.purgeProject(id)`；未清理独立的 `analysis.sqlite` 的 `analysis_runs`/`analysis_feedback`；[AnalysisStore](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/store/store.ts) 无对应 project purge API。
- 后果：用户删除项目后，AI 结论及可能包含项目详情的建议仍留存在另一库。
- 建议：定义跨数据库删除协调流程和失败补偿（不声称跨库原子），提供清理 Analysis Run/Feedback 的专用事务；区分“取消监控”与“彻底清除历史”两个用户意图。
- 验收：删除请求的所选语义在 Observer/Insight/Analysis 三库一致；中途断电可恢复补偿。

**H-06：Pi 子进程输出没有大小界限，终止后清理不完善。**

- 证据：[Pi provider](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/providers/pi.ts) 将 stdout/stderr 直接累加为字符串，没有 byte cap；超时和取消仅 `SIGTERM` 后立即 reject，未确认子进程退出、升级到 SIGKILL，也未统一清理定时器/监听器。
- 后果：异常模型输出可能造成内存问题、孤儿进程或资源占用；无进程级全局模型并发/预算约束。
- 建议：stdout/stderr 分别设置 byte cap，统一 finalize 路径，TERM→宽限→KILL，等待 close，并建立全局并发与预算；Pi 扩展需明确受信任。
- 验收：无限输出、忽略 TERM、取消/超时、同时多项目发起分析；进程被可靠回收，无泄漏与错误重复提交。

**H-07：项目文件采集存在无界全文读取和检查/读取竞态。**

- 证据：[context/files.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/context/files.ts) `readFileSync(real)` 先把完整文件载入，再取 8192 字节；`realpath/stat/read` 不是基于同一已打开 fd 的不可变校验。
- 后果：允许读取的一个极大 README 会导致超额内存/IO；有文件并发替换时存在路径验证竞态。
- 建议：使用 O_NOFOLLOW/限制路径、打开后 fstat、fd 定长读取、复核 inode 与 root containment；超过阈值明确 truncated，不读整份文件；为平台差异加测试。
- 验收：百 MB 文档只读固定前缀，内存有界；符号链接切换/路径穿越用例拒绝。

**H-08：敏感信息检测是有限正则，不能承诺任何源码都可安全发往模型。**

- 证据：[context/redact.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/context/redact.ts) 仅处理一部分常见密钥前缀/文件名；用户点击分析时文档摘录会发往外部 `stepfun-plan` 模型。
- 建议：首次启用远端模型时展示将发送的内容类型与用途；更广泛识别 `KEY=VALUE` 与高熵疑似秘密；支持项目级排除文件/敏感路径、预览和明确 opt-in；真正要求保密的项目可选择不向外部模型发送内容。
- 验收：人工构造不带常见前缀的合成密钥，不得被外发；Mock 和真实 Provider 明确区分。

**H-09：JUnit 解析依赖标签正则，没有确保 XML 完整有效。**

- 证据：[reports/junit.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-observer/src/reports/junit.ts) 使用 `<testcase`/`<failure` 正则计数；仅检查存在相关标签以及 `DOCTYPE/ENTITY`，未验证 XML 结构是否配对，注释中出现标签也可能被计数。
- 后果：不完整或损坏的报告有机会被识别为 `PASS`。
- 建议：改用受限、禁外部实体、大小与深度有限的 XML 解析器；对结构无效和统计矛盾返回 UNKNOWN/REPORT_PARSE_ERROR，不返回 PASS。
- 验收：缺闭合、注释假标签、嵌套 suite、failure/error 重复、skipped 与失败冲突等负例。

**H-10：可选的非 loopback 监听缺少真正的用户身份安全边界。**

- 证据：[config.ts](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/config.ts) 允许配置 `HEARTH_HOST`；[core.ts](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/core.ts) 的 `GET /auth/session` 可直接初始化并下发唯一 session/csrf，无密码/账户注册；[app.ts](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/app.ts) 的 Origin/CSRF 能防普通浏览器跨站，但**不是 LAN 上其他客户端的身份认证**。
- 建议：默认坚持 127.0.0.1，非 loopback 直接拒绝启动或要求显式额外身份认证和 HTTPS 反代；不要把当前 Local session 当作远程账户系统。
- 验收：默认 loopback 正常，配置 0.0.0.0 在无安全配置时拒绝启动。

### MEDIUM — 产品正确性和维护性

**H-11：Analysis 的 stale 判定与上下文指纹不一致。** `contextFingerprint` 哈希整个 Context（含 assembledAt），所以每次组装都不同；但 [service.withStale](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/engine/service.ts) 仅比较 snapshotId/headSha，没有比较上下文文件 SHA、目标 Insight 或规则变化。建议把稳定内容与采集时间分离，追踪可重现 input 版本，并清楚区分 HEAD-stale 与 Context-stale。

**H-12：现有项目分析更偏文档阅读而不是代码级分析。** [context/files.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/context/files.ts) 仅收集 README、AGENTS、CLAUDE、部分 manifests、docs 一级 md，最多 8 个，**不会读取 src 代码**（其测试也明确断言 src/main.ts 未包含）。这符合 P2-A MVP 的只读有限范围，但不能宣传为项目代码审计。建议 P2-B 开发证据驱动、按问题定向的代码上下文选择。

**H-13：`verified` 只验证引用身份，不能证明文字结论。** [engine/bind.ts](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/engine/bind.ts) 根据 `kind:id` 是否属于白名单就置 `verified=true`。建议 UI 改写为“来源引用已匹配”，对“结论已核实”独立评估，避免用户误解。

**H-14：旧 Demo 与真实 Project Intelligence 并列。** [server main](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/main.ts) 仍默认 `HEARTH_DEMO=1` 且首次自动导入 Demo；[chat route](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/chat.ts) 始终使用 Mock。两套 Projects/Cards/Insight/Analysis 语义并列，可能使用户误解真实状态。建议区分模式、主导航和产品主路径，之后再合并底层领域模型。

**H-15：缺少远端 CI。** 仓库树中未发现 `.github/workflows`；本地文档记录 306 tests、typecheck 和 build 通过，但 GitHub 目前没有自动质量门禁。建议加入 Node 22/pnpm 的最小 CI，运行 `pnpm install --frozen-lockfile`、typecheck、lint、test、build、受控 E2E；SQLite/OS 测试明确区分平台限制。

**H-16：README 首页仍自称“规划包，不是已实现软件”。** [README.md](https://github.com/EchoTouch-moon/hark/blob/master/README.md) 与已存在 apps/packages 功能相矛盾；建议主页更新为产品现状、真实功能、限制、快速启动和数据/模型隐私说明；历史规划移至 `docs/archive`。

**H-17：健康接口永远返回 provider=mock。** [core.ts](https://github.com/EchoTouch-moon/hark/blob/master/apps/server/src/http/routes/core.ts) 的 health response 固定 `provider:'mock'`，即便 Analysis Provider 已配置 Pi；建议单独暴露 chatProvider 与 analysisProvider（不泄漏凭证）。

**H-18：Analysis feedback API 有持久化，但 UI 反馈缺少稳定确认回显。** [RecommendationCard.tsx](https://github.com/EchoTouch-moon/hark/blob/master/apps/web/src/components/RecommendationCard.tsx) 点击后忽略异步调用结果；[AnalysisRunView](https://github.com/EchoTouch-moon/hark/blob/master/packages/project-analysis/src/contracts.ts) 不包含反馈状态。建议返回反馈值并支持刷新后展示、失败可见。

## 保留与肯定的设计

1. P0 事件 v3 `append_seq` 单调发号、事务一致性、epoch/tombstone 与断流明确标识。
2. P1 Signal Inbox、规则进度、Episode 去重、dismiss 与恢复语义、NO_INSIGHT。
3. Observer 的 Git 子进程参数白名单、`--no-optional-locks`、输出/执行上限、数据库隔离。
4. Pi 真实分析显式选择模型、禁 tools/mcp/自动扩展，错误不回退 Mock；保留未验证证据语义。
5. 真实验收披露 UNKNOWN、BLOCKED、历史限制，而不是用演示结果替代真实模型。

## 推荐实施与门禁

### R0：工程正确性与安全修复（停止扩功能）

修复 H-02、H-03、H-04、H-05、H-06、H-07、H-09、H-10。新增故障注入、长时间资源测试。安全边界重点是进程/文件限制和远程暴露，而非只改 Prompt。

**Gate R0：** `crash+restart` 不阻断新分析、取消 A 不影响 B、跨项目 Insight 拒绝、项目删除处理三库、过大文件/无限 stdout 被限额、无效 JUnit 不显示 PASS、默认拒绝非 loopback。

### R1：让 Project Intelligence 真正持续工作

解决 H-01：单个有界 Coordinator 驱动 Observer→Signal→规则，不要并行发起模型调用。保持 P1 的独立 checkpoint、无变化零写入、按项目隔离。增加后台运行健康指标。

**Gate R1：** 新报告→自动出现一个 Insight；重复和重启不灌水，断流冻结，静默无模型费用。

### R2：首次真实产品体验验收

修复 H-11/12/13/14/16/17/18；对 2 个真实项目产生可操作建议并人工评分，保留 `UNKNOWN` 和证据归属界限。建立 README 和最小 CI。

**Gate R2：** 用户可清楚区分 Demo、确定性 Insight、真实 Pi；数据发送有知情确认；30 条人工标注的建议精确度和噪声率有基线，不用凭“模型答得不错”评价整个产品。

### 之后才进入 P2-B/C 与 P3

P2-B 加证据驱动的代码上下文装配；P2-C 做建议价值评价与用户反馈；P3 才开放有预算、免打扰、频控和可关闭的主动推送。Hermes 应作为记忆/推理 Adapter，而不是更换 Hearth 事实账本。

## 本次审查限制

- 未执行任何本地命令；无法独立确认实际 306 tests 与 Git 指纹，也不能给代码覆盖率、真实负载或漏洞利用成功作保证。
- GitHub 没有远端 CI，不代表代码不能跑；只是暂缺独立的远端机器质量门禁。
- H-07、H-08、H-09、H-10 是基于实现边界的风险和缺失测试，不能一律视为已被现实利用的漏洞。
- 用户本机未提交内容不在此远端快照中；本报告只对 master `3c2c909` 负责。
