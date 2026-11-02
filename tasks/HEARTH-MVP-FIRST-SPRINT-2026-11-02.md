# Hearth 正式开发阶段任务池｜G0 / G1-A / G1-B / G1-C / Experience（版本记录：2026-11-02）

> 状态：TASKS PROPOSED · NOT AUTHORIZED FOR CODE EXECUTION。**不设置开工日期、任务截止日或时间盒。由前置 Gate PASS、具体授权与验收状态决定何时执行。**
> 初始编码基线：bot/hearth-g0-contract（每轮开始前重新拉取固定 SHA）；开发分支各自隔离，所有改动通过 PR，不直推 master 或 G0。
> 配套开工门禁：docs/mvp/g0/06-2026-11-02-development-readiness.md。原始合同：docs/mvp/g0/02-contract-and-decisions.md、03-plan-threats-traceability.md、05-dual-track-and-viewmodel.md。
> 此任务包为可供用户逐批授权的执行规格，不是总包授权。模型、公开检索、真实私人项目均默认关闭。文件名保留首次建立时的历史版本标记，不表示固定 Sprint 周期或完成期限。

## 一、开发策略与分工

- **Track A · Mind**：G1-A 安全负例与回归 → G1-B Chronicle → G1-C Opinion Memory → 后续 G2 Research / G3 Proactive。
- **Track B · Experience**：先对契约/Mock 做设计与验收方案；G1-A 门禁过后才进行 E1 fixture-only 代码；Mind 集成时只经 HearthViewModel，不做第二套状态引擎。
- **共享契约**：packages/hearth-contract 的版本化 Zod + fixtures、packages/contracts 既有内容及服务器响应投影；新增或改变公共 schema 必须单独经过 G0 小闸审查，双方不在各自分支偷改。
- **成果判断**：Hearth 不是自主做工的 Agent，核心成果是有来源、有反证和记忆的项目观点，克制呈现，并能听懂用户的反驳和新决定。所有 Plan 为不可执行草案。

### 任务领取与转阶段规则

**不是一次性把以下所有任务并行发给编码 Agent。** 当前只释放已满足前置的任务；每批任务必须具备可观察产物、负例与退出标准。每完成一批，先提交审阅和证据，再由 Gate 结果解锁下一批。若出现 FAIL / BLOCKED，不按日期升级阶段。

| 工作项 | 所需前置 | 当前任务判断 | 下一道闸 |
|---|---|---|---|
| S0-01 · 基线及静态安全核对 | 已有 G0 分支及合同 | 第一轮静态报告已产出（07 文档），仍需评审并补充动态测试计划 | 审阅结果 + G1-A 具体编码授权 |
| A-01 · G1-A 动态负例和最小修复 | S0-01 审阅、用户明确授权 | WAITING_FOR_APPROVAL / DYNAMIC_NOT_RUN | 全部关键安全负例与 CI 实测 PASS |
| B-01 / B-02 · Chronicle | G1-A PASS | BLOCKED_BY_G1-A | 迁移/绑定/隔离/恢复和只读接口 PASS |
| C-01 · Opinion Memory | G1-B PASS | BLOCKED_BY_G1-B | 版本 CAS、来源、用户反馈及恢复 PASS |
| E-01 · 纯 fixture UI | G1-A PASS，ViewModel 冻结；设计和 QA 可先行 | DESIGN_ONLY | UI/键盘/状态/错误行为 PASS |
| I-01 · Mind/Experience 对接 | G1-B/C、E-01 PASS | BLOCKED_BY_DEPENDENCIES | HVM 有界真实投影集成 PASS |

任务状态建议使用 NOT_STARTED、IN_PROGRESS、READY_FOR_REVIEW、PASS、FAIL、BLOCKED；每次状态变化必须附对应 PR、测试 SHA 与验收记录，不允许将“已写代码”直接当成 PASS。优先级按安全阻塞、用户价值与当前依赖实时调整。

## 二、任务清单（按验收依赖顺序，可动态调整优先级）

### S0-01｜正式开发代码基线与安全差距审计（P0，先做）

**输入**：G0 当前 HEAD、PR #29/#30、G0 02/03/05、现有 API 与测试、#12 研究与 #15 离线 PoC。
**动作**：只读核对本地/远端 HEAD、test inventory、功能范围；列出执行路由、proactive GET、Thread–Project 绑定、reset API、直接调用 Orchestrator 的所有入口；给每条现有断言标 PASS / FAIL / NOT_RUN / BLOCKED，附源码位置。
**交付**：一页 G1-A fail-closed matrix；一份文件级受影响清单；单独列出 #29/#30 已覆盖与未覆盖；一个最小 G1-A 编码 PR 方案。
**验收**：不把 CI 总绿当成安全总绿；至少核对真实/未知/Demo 三种模式、双项目切换和并发、恢复、旧间接入口；无业务代码或数据库修改。用户审阅后另行进入 G1-A 编码。

### A-01｜安全基线动态负例（P0，G1-A，需单独授权）

**前置**：S0-01 审核 + 用户明确授权本批代码；隔离 SQLite 合成数据库和 Fake Executor，禁止真实项目及 Provider。
**范围**：服务器入口 fail-closed，覆盖 threads / cards / approvals / background orchestration / proactive / reset 的作用域和模式检查；已有 #29/#30 不重复重写。
**最小负例**：
1. real / unknown + execute/approve → 拒绝；executorCallCount=0；无 run/card/evidence 变更；审计只记脱敏拒绝。
2. Demo + 允许路径 → 只能命中 Demo 合成存储和 Mock；其他项目/真实数据零接触。
3. real / unknown + recover → 允许核验既有动作产物、修正必要状态，但 executorCallCount=0；不能把恢复当作重新执行。
4. GET proactive / GET project / GET events → 不插入聊天、不改候选、不推进投递、不泄露其他项目；多标签窗口同样验证。
5. 伪造 demo、projectId、threadId、cardId、runId 和跨项目 sourceRef 必须拒绝；reset 无可信归属则明确拒绝且 API/UI 语义一致。
6. 围绕 completed→evidence 非原子窗口写故障注入证明，区分仅进程内模拟与真正进程终止/重启，未跑不得标 PASS。
**验收**：对应合成测试实测，列执行调用计数、数据库前后 diff、审计语义和不泄漏断言；Windows/Linux CI 通过；安全评审确认后才允许进入 G1-B。禁止扩展真实执行能力。
**交付**：独立测试/最小修复 PR、门禁记录和可复现实验命令。

### B-01｜Chronicle 存储与迁移骨架（P0，G1-B）

**前置**：G1-A PASS。无网络/无模型/无私有项目。
**实现建议**：独立 Chronicle SQLite / schema_version / WAL / foreign_keys / explicit migration；持久化 HearthProjectId、ProjectSource、ThreadProjectBinding、GoalRevision、Decision、EvidenceRef 的最小可用子集。旧 Observer / Insight / Analysis 保持隔离、只读端口取数；不改写私有 Git。
**边界**：ProjectSource 显式绑定，不用 Demo id 冒充 real id；只有 Observer 证据带 epoch，研究源与用户决定各按自身版本判定；跨库删除采用 deletion journal 与 tombstone。
**验收**：空库首次建表、旧版迁移、重复迁移、事务中断回滚/恢复、重启持久、两项目隔离、来源重置冻结旧引用、删除后不重新绑定。禁止自称多库事务天然原子。
**交付**：schema/migration PR + 数据字典 + 严格合同测试 + 迁移回滚说明。

### B-02｜项目身份、目标与证据只读 API（P0，G1-B）

**前置**：B-01 PASS。
**实现**：服务端 scope 校验、项目和线程显式绑定、用户目标及决定修订记录、类型化来源读接口；未知/过期/gap/disabled 不推断为项目没事；同项目旧浏览器请求响应不能污染新焦点。
**验收**：跨项目 forged API 请求不可见、并发切换严格隔离、已撤销来源/旧 epoch withheld、GET 不写入、用户目标版本能被后续观点引用。无网络外发。

### C-01｜不可变观点修订与反馈（P0，G1-C）

**前置**：G1-B PASS；本批不得接真实 LLM。
**实现**：Opinion、OpinionRevision、ProposedPlan(executable=false)、Feedback。按 (projectId, topicKey) 唯一；Revision 单调递增不可覆盖；事务 CAS；有事实/推断/局限/反证或缺失说明；Feedback 独立追加、不把拒绝当成事实证伪。
**验收**：两个并发修订恰好一个提交另一个冲突、断电重启不丢修订、重复 feedback 幂等、搁置生效、反驳产生可追溯事件、撤销/跨项目/失效引用 withheld。无模型、不发网、不修改被观察仓库。
**交付**：Storage + Service + API 合同测试 + 真实线程以合成项目验证的演示说明（明确 Mock）。

### E-01｜炉心与对话交互的 fixture-only 收口（P1，可平行设计）

**前置**：G1-A 过关才开始前端代码变更；此前仅审阅视觉稿、写 QA 用例、看现有 E1/I1 资产。
**必须复用**：packages/hearth-contract 的 HearthViewModel 单一输入，已有 E1/M1/M2/I1 组件；不从 #4/#5 整包搬 UI，更不重做已验收功能。以 G0-05 为 schema 权威。
**实现**：空态火焰+对话 Composer、项目焦点、状态文本、单张 featuredOpinion 模拟卡、用户反馈入口、reduced-motion/键盘与错误态。全局/项目 scope 分明；真实模式错误不得落回 Mock。
**状态覆盖**：ok、empty、error、permission_denied、stale；火焰只读 narrative.flame，消息次数/卡片数不得当长期活力。对话/卡片不得越权调用 legacy action。
**验收**：1440×900、1280×800、明暗主题、无 WebGL 降级、两项目切换、读屏与键盘、焦点不抢夺；截图+录屏；没有新观点就安静。不得把 Mock 演示标作真实可用功能。

### I-01｜Mind/Experience 合同对接（P1，G1-B/C 完成后）

**前置**：A/B/C 门禁均 PASS。
**动作**：HearthViewModel 从真实 Chronicle/Opinion 的有界只读投影生成；认知历史不全塞 ViewModel；GET 无副作用；前端只通过稳定接口索取。featuredOpinion 可以仍为 null（G3 判定未接入前），不编假观点。
**验收**：同 project / 证据 / freshness / 权限时 Flame 与 Story 一致；跨项目、错误、重启和授权撤销不串线；Mock 标识不消失。

## 三、开发 Agent 执行合同（每个批次必须遵守）

1. 开始前输出 base SHA、分支、现有实现与任务差异，先阅读当前合同和相关源码，再写代码；严禁以历史交接陈述直接当运行时真相。
2. 每个 PR 只做一个有界任务。先写失败的负例和安全断言，再做最小修复；任何多业务模块重构需停下申请范围审阅。
3. 不访问真实私人目录、密钥、账号、外部网络 Provider；不允许 Docker 作为必需环境。允许 CI 使用 Mock 和合成仓库；不得调用真实模型。
4. API 结构必须 Zod strict、有界、服务端鉴权和 project scope；失败关闭；GET 只读；外部材料/模型响应永不作为命令。
5. PR 描述必须注明：head SHA、变更范围、测试命令和结果、红→绿证据、权限/网络调用计数、已知缺口、回滚步骤、与 G0 条款及 Nxx 用例映射。
6. 合并、启用分支规则、调度真实公开搜索、付费模型调用、用户私有项目访问及真正执行动作要新的明确授权；本任务包不提供这些权限。

## 四、从 G0 审查状态进入 G1-A 代码开发的最小准入清单

- [ ] S0-01 审计单与 G1-A 范围评审。
- [ ] G0 02/03/05 的冲突和本轮证据快照形成差异表；日期仅用于记录事实，不作阶段时限。
- [ ] G0 / master 合并策略和历史 PR 保留/拆分决定；当前两条 branch rulesets 已确认 active，开发过程遵循 strict ci-gate。
- [ ] G1-A 的独立 PR 路径、Mock 测试与回滚方案得到具体审批。
- [ ] 记下尚未批准的 ResearchPolicy/Provider/预算/H1 真实样本，不能从计划推断许可。

## 五、明确不做

- 不重建 DeepSeek 的 Worker/Outbox/工单墙，不复制其超出 Hearth 产品所需的执行能力。
- 不改用模型代替证据校验；模型输出仅用于未来通过授权的观点候选。
- 不做自主编辑代码、执行 shell、自动 PR/Issue、付费实验或私有外发。
- 不以 PR #15 纯函数实验、PR #12 研究结论、已有 Mock 演示当成 H1 用户价值通过。
