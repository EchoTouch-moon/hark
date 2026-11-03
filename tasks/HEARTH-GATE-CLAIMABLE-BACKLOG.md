# Hearth · 可认领开发任务池（阶段门禁驱动）
> 快照日期 2026-11-02（仅证据时间戳，**无日期排期**）；最新核查基线 `bot/hearth-g0-contract@6ef6fe00c90545749f8beef25ac5753e13ccc8e9`。任何认领在开工前必须重新拉取最新 HEAD 并复核依赖。本文处于 PR #31 Draft，不等于 G0 审批、编码授权或合并授权。

## 一、当前项目状态：以远端代码和 CI 为准

| 能力 / Gate | 代码证据 | 真实状态 | 禁止误称 |
|---|---|---|---|
| 旧项目观察、Insight、只读分析预览 | `packages/project-observer`、`packages/project-insight`、`packages/project-analysis`、历史 R0/R1/R2 | 已有功能与合成工程验证；R2 用户价值样本不足 | 不等于项目长期认知 / 新 H1 |
| Experience E1 / Mind 早期 M1/M2 / I1 | 既有 PR #8/#9/#10/#11 已合并 G0；`apps/server/src/http/hearth/{observe-view,chronicle,flame}.ts` | 有 ViewModel、观察叙事和基础 UI；`featuredOpinion:null` | **当前 `chronicle.ts` 仅观察摘要→StoryBeat，不是持久 Project Chronicle** |
| G1-A 局部安全 | PR #29 旧 execute fail-closed、#30 restricted payloadRef、#32 permissions CSRF + 冷启动；均已合并 | 局部 PASS，尚缺项目 scope、恢复、Demo reset 验证等 | 不等于完整 G1-A PASS |
| G0 目标分支 CI | G0 HEAD `6ef6fe0`，push CI run 41414610654 | SUCCESS | 绿 CI 不是 H1 / 安全矩阵整体 PASS |
| G1-B / G1-C | 当前旧 `packages/storage` 未含新的 Chronicle/OpinionRevision 全量合同；`featuredOpinion` 固定 null | 待开发 | 不得把 StoryBeat 或旧 Card 说成 Opinion Memory |
| G2/G3 | PR #12 为研究、#15 为离线呈现 PoC；二者未合并 | 研究/离线实验，未接生产读写/网络 | 不等于主动研究或可靠呈现已可用 |
| G5 / H1 | 未经用户授权做完整真实项目+公开研究+观点反馈闭环 | NOT_MEASURED | 不得用 Mock 或单一模型评价冒充真实价值 |

**仓库治理**：`master@ca17007` 与 G0 已分叉（比较 API: G0 相对 master ahead 100 / behind 25）；开发基线继续定在受保护 G0，暂不盲目合并 master。开放 PR：#1/#3/#4/#5/#6/#12/#15/#31/#33 共 9 个，其中 #31/#33 为 Draft 文档工作；历史 UI PR 不整包合并。既有 `handoff/STATUS.md` 和 G0 02/03/04 的部分 “未开始/待合并” 是历史快照，遇到冲突以本次固定 SHA + GitHub PR/CI 为准。

## 二、认领与模型等级规则

- **L / 低成本模型优先**：单文件/少量文件、断言明确、无数据模型选择、纯函数/fixture/文案/小型 CI 隔离。适合 PI 内任意能够运行 TS 测试的低价模型；模型必须给出可验证的实际结果。L **不等于安全代码免复审**。
- **M / 中等能力**：有限服务逻辑、多接口数据映射或前后端状态关联；需要较好现有代码阅读能力，改动交由独立 Agent 复审。
- **H / 强模型主导**：项目身份/来源信任、迁移/删除恢复、并发 CAS、权限、出站预算、执行/恢复、跨域安全及 HVM 真值；不推荐便宜模型直接单独设计/合并。
- **Human**：产品授权、跨项目隐私范围、模型/网络外发许可、真实用户价值评价、合并决策。不可委托模型假设获得。
- 任务状态：**READY_FOR_SPEC / READY_TO_CLAIM / BLOCKED / IN_PROGRESS / REVIEW / PASS / FAIL**；只有前置 Gate PASS、文件责任明确、用户已批准具体编码范围，才允许进入 READY_TO_CLAIM。表中的 “可先做” 只指**规划/隔离测试工作**，不意味着授权真实操作。
- **领取协议**：一个 Agent 一个 task ID，一个独立 branch/worktree，一个小 PR。开始先输出当前 base SHA、文件白名单、触及权限/外发与否、预期失败用例、测试命令；不得修改其他任务的共享契约。PR 附红→绿、变更文件、测试/CI、未覆盖风险、回滚方案；无证据不算完成。所有合并须用户再次授权。
- 特别要求：不得为了绿色 CI 删除反例、用 `skip` 掩盖合同失败、把 real 失败转为 Mock；若现状应当红，交付 **DRAFT / RED_REPRODUCED** 供强模型修复，不合并失败测试。默认使用 Node/pnpm/SQLite/Mock，**不要求 Docker、不得调用付费模型、不读私人项目**。

## 三、当前可准备的首批低成本任务

| ID / 模型 | 前置和可改文件 | 最小工作与明确交付 | 验收 / 边界 |
|---|---|---|---|
| **Q-01 · L** | 无业务 Gate；`docs/verification/`、`handoff/` 新独立审计文档 | 用 PR/CI/源码更新 G0→G1 真实状态矩阵：#29/#30/#32 MERGED，区分 #31/#33 Draft、#12/#15 lab，以及真实缺口；每行写来源 SHA/测试结果 | 文档与现有源码一致；不改已有历史证据，不宣称 G1-A PASS；不碰源码 |
| **Q-02 · L** | 无业务 Gate；新增 `docs/verification/pr-triage*.md` | 对开放 #1/#3/#4/#5/#6/#12/#15/#31/#33 按“保留/小块摘取/废弃/等待”提出文件级建议，标明 base 与潜在重叠 | 只产出建议、不自动关闭/合并/改 base；必须记录具体文件、冲突与复用理由 |
| **Q-03 · L→M** | 独立测试环境；`tests/e2e/playwright.config.ts`、`tests/e2e/start-server.mjs`、专用测试/文档 | 消除两套本地 Playwright 进程争抢固定 `4321` 端口及数据库的可能：为每次运行配置隔离端口、DB 和 artifactRoot；不改业务 API | 单跑及两进程并行实测均通过；保留原有 28 项语义，不改 `reuseExistingServer:false` 的隔离立场；若无法证实并行安全先停在 REVIEW |
| **A-02 · L 编码 / H 安全复审** | G1-A 已开启局部修复；`apps/server/src/http/app.ts`、安全 HTTP 测试 | 将服务端 CSRF/Origin 写方法集合与客户端统一：补齐 PATCH。**只用测试路由探针**验证缺失/错误 token 与 Origin，不新开生产 PATCH 业务 | PATCH 无授权写请求一律 403 且 executor/DB delta=0；已有 POST/PUT/DELETE 回归无变化；安全代码必须强模型独立复审 |
| **A-03 · L 测试 / M 修复** | 允许仅测试的独立分支；`apps/web/src/features/{threads,chat}.ts` 对应测试 | 针对 real/unknown API 报错、线程列表为空、权限拒绝等情况，构造**不得回退本地 Mock/虚构线程/伪完成**的浏览器或单测反例 | 测试先在旧版标红并记录真实失败；强模型确认行为合同后方可做最小客户端修复；不能通过伪造服务器模式放绿 |
| **A-04 · L 负例设计 / H 修复** | 合成 A/B 两项目；`apps/server/src/http/routes/{threads,chat,cards,runs,projects}.ts` 只读核对，新增独立安全矩阵 | 构造 forged projectId/threadId/cardId/runId、旧 tab、SSE、无绑定/全局查询的 API 操作矩阵；注明“合法全局”与“项目焦点”边界 | 每用例给期望 status/data isolation/DB delta/audit；**目前源码没有完整 server-side binding**，发现失败先留 DRAFT，禁止低成本模型临时发明身份架构 |
| **A-05 · L 测试 / M 最小修复** | 现有 `apps/server/src/http/routes/core.ts`、设置页、isolated SQLite | 验证 Demo reset **可信归属未知时 fail-closed**，连纯旧 Demo seed 都不能被误删；核对 API/UI 错误文案、内部异常脱敏 | 不得为了“reset 好用”放宽删除权限；若需重设计归属及真正安全 reset，转 H 类 G1-B 任务 |

以上可按依赖并行准备；**建议先派 Q-01/Q-02/Q-03 与 A-02 的测试部分**。A-03/A-04 是侦测红灯任务，不能交给廉价 Agent 凭想象“修到绿”。

## 四、强模型牵头的关键主线（逐闸释放）

| ID / 级别 | Gate / 前置 | 具体工作和文件建议 | 严格 DoD（Definition of Done） |
|---|---|---|---|
| **A-06 · H** | G1-A，A-04 作用域合同冻结 | 定义 server-side Project/Thread/Run/Card scope 读取与允许的 global 查询；明确单机单主体不等于项目可串线；改 `routes/threads/chat/cards/runs` 与必要存储查询，禁止“前端切焦点”充当鉴权 | 双合成项目直接 API/并发/历史/SSE 不串线；错误身份不创记录、不外泄；旧 Demo/真实身份不自动混同 |
| **A-07 · H** | G1-A | 完整归档 execute/approve/cancel/recovery 的服务路径及非原子 completed→evidence 窗口；先合成故障注入，再按需子进程强杀/重启 | 真实/未知错误路径 executor=0；恢复只核验不重做；审计、DB delta 和 outcome_unknown 诚实；区分进程内模拟与真实崩溃 |
| **G0-C · H/产品** | 与 A-04/A-06 联动，早于 G1-B 表结构 | 冻结 ADR-01 的 HearthProjectId/ProjectSource/ThreadProjectBinding、单/多项目 thread focus 和全局 scope 规则；写 schema/API 变更映射和迁移策略 | 绝不把 Demo/Observer 项目 id 直接当统一永久身份；无隐式旧数据迁移；不凭空补用户授权 |
| **B-01 · H** | 完整 G1-A PASS + G0-C 审阅 | 新独立 Chronicle SQLite + versioned migrations、ProjectSource、ThreadBinding、GoalRevision、Decision、EvidenceRef、deletion journal；Observer/Insight 保持只读对接 | 冷启动、重复迁移、事务回滚、两项目、删除途中崩溃/重启、源重置后旧引用 withheld；不假设跨库事务原子 |
| **B-02 · M 实现 / H 复审** | B-01 PASS | 项目/目标/决定/来源的最小只读 API，严格 Zod，Server 侧 scope；类型化来源失效投影 | GET 零写入、缺失/撤销/epoch/gap 不说“没事”，无 private 数据泄漏；用户目标可被后续观点引用 |
| **C-01 · H** | G1-B PASS | `Opinion`、不可变 `OpinionRevision`、`ProposedPlan(executable=false)` 的数据表与 CAS 更新 | 同一 (projectId, topicKey) 并发二选一、不可覆盖旧 revision；重启完整，跨项目引用 withheld |
| **C-02 · M / H 复审** | C-01 PASS | 反馈、搁置、反驳和保留历史读 API；用户拒绝不自动视为事实被证伪 | feedback 幂等、搁置到期、撤销来源后保留历史但不可继续呈现；GET 零写 |
| **R-01 · H** | G1-A/B/C PASS；ResearchPolicy/预算/来源需另行明确授权 | 独立 research permission、允许的公共域、SSRF/重定向/大小/超时拦截、预算原子预留和取消/恢复；默认关 | 未授权出站 spy=0，额度不超、不发送私有源码；一次真实公开请求需用户另审并明确允许的接收方 |
| **P-01 · M / H 复审** | G1-C PASS；PR #15 PoC 单独 review | 抽取呈现资格纯函数已有 19 案例的可复用部分，增补 production proof，分清 seen / claim / presented / ack_uncertain | 先离线/合成，跨项目/消息相同证据不同/滑动 24h/ACK 丢失不重复伪称送达；不整包合并 #15 |
| **P-02 · H** | C-01/C-02、P-01 PASS；研究结果需要 R-01 | 新证据与目标关联的观点候选生成、来源验证、抑制/冷却/展示确认，`featuredOpinion` 有真实持久来源 | 非可信来源不变指令；新证据+whyNow+反例/局限；无值得打扰的观点保持 null；没有真实模型授权不调用模型 |
| **I-01 · M→H** | G1-B/C、E1 与 P-02 必要接口齐备 | 通过**一个** `HearthViewModel` 进行 Mind→Experience 投影；扩展现有火焰、故事、观点卡（不重做 E1） | 同 project+同证据/新鲜度/权限时 Story/Flame 同源；跨项目切换不污染；错误绝不 fallback Mock |
| **H1 · Human + H** | 必要的 A/B/C/R/P/I Gate PASS | 用户自选授权项目，演示观察→公开研究→引用观点→轻敲→反馈/反驳→新证据修订→重启 | 独立记录资料 URL/时间、无越权外发与执行、恢复、真实人的有效性判断；人评未做保持 NOT_MEASURED |

**可等候 Gate 的轻量辅助任务**（无需提前修改生产核心）：`E-02 · L`：现有 E1 的 empty/stale/gap/error/permission_denied/Mock 明示、键盘/reduced-motion 与 1280×800/1440×900 浏览器 fixture 回归；`B-T01 · L`：为独立 Chronicle 的型别化来源准备合成 A/B、旧 observer epoch、撤销用户决定的测试夹具，schema 由 H 模型定稿后再执行；`C-T01 · L`：Opinion 版本/反馈/并发矩阵合成输入夹具；`P-T01 · L`：复用 PR #15 的呈现资格测试而非新造算法；`H-T01 · L`：用户价值打分模板/盲评表（只做模板，不伪造评价）。其中 `E-02` 的 UI 测试准备可现在做，不能把 Mock 视觉验收说成真实观点闭环。

## 五、推荐领取顺序（不是时间线）

1. **现在：Q-01、Q-02、Q-03（L）** 与 **A-02 安全探针/最小修复（L 代码 + H 复审）**；另外 A-04 的红灯矩阵可交 L 型 agent 准备，用于强模型锁定数据身份合同。
2. **下一 Gate：G0-C（H）→ A-06（H） / A-07（H）→ G1-A 全矩阵验收**。未经这一步不能接真实私人项目、模型或周期研究。A-03、A-05 和 E-02 可按已锁定接口独立推进。
3. **G1-A 通过后：B-01（H）→ B-02（M）→ C-01（H）→ C-02（M）**；并行做 E1 的轻量 QA 与文案，不重建前端工作台。
4. **已有可信观点存储后：R-01（H）与 P-01（M）分开验证；P-02（H）→ I-01（M→H）**。是否开真实公开研究/模型要用户另行确认。
5. **最后 H1**：真实用户确认有“对我而言值得出现的新观点”，而不是完成了多少任务、生成了多少卡片。

## 六、可复制的模型认领 Prompt（用具体任务 ID 填空）

```text
你现在认领 Hearth 的 <TASK_ID>，任务等级 <L/M/H>，项目仓库 EchoTouch-moon/hark。
从 bot/hearth-g0-contract 最新 HEAD 建独立工作区/分支；先列实际 SHA 与文件变更白名单。
先读 AGENTS.md、docs/mvp/g0/02-contract-and-decisions.md、03-plan-threats-traceability.md、
05-dual-track-and-viewmodel.md，以及 tasks/HEARTH-GATE-CLAIMABLE-BACKLOG.md 中本任务条目。
仅执行此任务，不做范围外重构、不修改别人的 PR、不要将 Mock 当真实功能。
默认禁止访问私人仓库/文件、使用真模型或 Key、联网研究、外部写入、自动合并、打开真正执行入口。
先写真实可复现负例，再最小实现（test-only 任务只写负例，不改产品代码）。
完成时提交：base/head SHA、改动文件、前后对照、命令/退出码、关键断言、测试与 CI、
合成数据范围、未测与失败、禁止行为核对、回滚方式。不要删测试/skip/忽略失败。
出现身份归属、授权或方案歧义立即 BLOCKED 并给出选择，不自行做架构决策。
代码提交为独立小 PR，待用户授权合并；不要修改 master 或 G0 受保护分支。
```

**提醒**：低价模型写的测试和 UI 也可能把“正确失败”误改成“看起来成功”。优先用它做狭小、可复验、能定向运行的工作；安全架构、模型数据出站、迁移/恢复与合并一律保留强模型 / 人工复审。
