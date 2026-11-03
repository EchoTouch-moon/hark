# Hearth MVP · 心智、项目生命与叙事架构

> 设计提案 v0.1。字段名与存储方式供实现 Agent 进一步 ADR 审核，不是当前 API 的声明。以既有安全/数据合同为硬约束。

## 1. 分层架构

```text
Project Registry + Goals/Decisions + Threads
           │
Git Observer → Evidence/Insight Store ─┐
                                       ├→ Research Candidate Selector
Public Search Adapter (permissioned) ──┘             │
                                             Research Job
                                        (budget/privacy/timeout)
                                                     │
                                       Evidence & Source Ledger
                                                     │
                                              Opinion Engine
                                          (revision + evidence)
                                                     │
                                      Narrative State Projection
                                         ├─ Story Surface
                                         └─ Flame Surface
                                                     │
                                  User Feedback / Plan Review Gate
                                                     │
                            only explicit, scoped approval → future Execution
```

**安全隔离**：Observer、Narrative、UI 以及后台候选筛选器均不能获得写仓库或启动执行任务的 Provider/Command 权限。研究服务只接收已脱敏的研究问题和明确授权的外部检索凭据。研究的自动授权与工作执行授权绝不共用凭证或许可令牌。

## 2. 数据真相与视图投影

建议先定义这些概念及最小字段（具体表名可调整）：

| 记录 | 关键字段与不变量 |
|---|---|
| Project | projectId，用户目标及版本，登记时间，观测启停与范围；仓库只是可选数据源 |
| ProjectSource | sourceId，projectId，类型，本地/远端授权范围，lastObservedAt，freshnessStatus，epoch/watermark |
| ProjectFact | factId，projectId，sourceId，observedAt，sourceTime，sourceRef/hash，evidenceStatus；immutable |
| ProjectDecision | decisionId，projectId，用户/系统提议，明确的用户选择，发生时间，关联目标与来源 |
| ResearchJob | jobId，projectId，reasonFactIds，公开查询摘要，policyVersion，预算上限/实际用量，状态，取消/错误原因 |
| ResearchSource | sourceId，jobId，URL，检索时间，标题，版本或发布日期，引用片段哈希，来源可信度/限制 |
| Opinion | opinionId，projectId，topicKey，latestVersion，lifecycleStatus，triggerRef，nextReviewCondition |
| OpinionRevision | revisionId，opinionId，版本，事实链接、推断、反面证据、不确定性、建议、方案、模型/规则来源、创建时间 |
| NotificationCandidate | candidateId，projectId，opinionRevisionId，dedupeKey，importance，suppressionReason，deliveredAt |
| ProposedPlan | planId，projectId，opinionRevisionId，具体范围、步骤、风险、预算/外发、验收、版本哈希；不得暗含授权 |
| ExecutionConsent | **不在自动研究路径**；将来需绑定 planHash、projectId、scope、actor、过期时间与本次用户主动发起 |

现有 Observer/Insight/Analysis 的持久化不必重写。新增 Project/Opinion 层通过只读端口整合旧证据，并保留项目删除、源重置、epoch 变化时的隔离规则。

## 3. 状态与异常

**ResearchJob**：proposed → eligible → running → completed | blocked | failed | cancelled。异常可恢复、持久化；重启不得重做已完成且未失效的研究；未知网络结果不冒充成功；超预算进入 blocked。

**Opinion**：draft → ready → presented → acknowledged / deferred；新证据可以触发 revised 或 withdrawn，保留完整 revision 链。用户拒绝方案不等于事实被证伪。

**Observation freshness**：KNOWN_FRESH / KNOWN_STALE / UNKNOWN / GAP / DISABLED / UNAVAILABLE；“DISABLED/UNAVAILABLE”不得映射成“项目休眠”，不能把 UNKNOWN 变成 PASS。

**Proactive delivery**：仅在 `ready` 且来源完整、价值足够、非重复、未被用户搁置、满足安静政策时 present；一次仅一条主观点，其他入 Inbox。系统可以形成研究记录而不自动打扰。

**线程与项目**：一个项目可关联多个线程，一条线程可以全局或关联一个及多个项目；每一个观点和证据始终携带 projectId/scope。切换线程或项目不得继承另一项目的请求、研究结果或火势。真实跨项目比较需要显式范围。

## 4. 观点生成的证据合同

引擎输出结构包含：
- `observations[]`：具有事实链接的已知观察；
- `inferences[]`：明确标记为模型/规则推论；
- `counterEvidence[]` 与 `uncertainties[]`；
- `opinion`：简明判断；
- `whyNow`：对用户当前目标的意义；
- `recommendation` 与 `alternatives[]`；
- `changeMyMindWhen[]`：可验证的更新条件；
- `proposedPlan`：审阅草案，默认 `executable=false`；
- `sourceRefs[]` 与 `researchLimitations`。

**生成并不等于验证**：模型输出需过 Schema、引用存在性、project/epoch 授权、来源日期/可访问性与事实-推断标记校验；不满足则 withheld，不生成强判断。真实研究必须附真实 URL 与检索时间，不允许虚构论文、版本或仓库名称。

## 5. 触发与研究策略（初版待量化）

候选由事件差分、目标冲突、已知问题持续、重大状态变化或新公开资料发现驱动。单纯“有新提交”“线程内多发消息”不自动产生高价值意见。选择器可以确定性运行，允许用户提交显式研究目标；外部检索需要授权和调用预算。

研究顺序：
1. 提出私有域内的研究问题，检查与已存观点是否重复。
2. 本地脱敏、只导出公开可表达的主题与技术栈；敏感信息不外发。
3. 受限检索 GitHub/公开论文/技术文档；留来源与检索时间。
4. 对证据进行相似性、质量、时效与适用性评估；标记未知。
5. 构成 OpinionRevision + ProposedPlan，先存入本地。
6. 主动呈现策略再决定是否提醒，而非研究结束自动弹出。

可暂停/取消；预算、Provider、允许域、频次与日志保留可配置；权限不足时 blocked，不调用任何隐式服务。避免无事件时周期性空耗模型成本。

## 6. Project Life Model（非线性）

**生命不是单个枚举**。建议 NarrativeState 投影为：
```ts
interface NarrativeState {
  projectId: string | null; // null = neutral hearth
  evidenceFreshness: 'fresh'|'stale'|'unknown'|'gap'|'disabled'|'unavailable';
  storyChapter?: 'beginning'|'exploring'|'advancing'|'reflecting'|'restarting';
  recentActivity: 'known-active'|'known-quiet'|'unknown';
  currentAttention: 'idle'|'focused'|'waiting';
  verifiedMilestones: Array<{id:string; evidenceRef:string}>;
  eventCue?: {eventId:string; kind:'discovered'|'research-ready'|'verified'; evidenceRef:string};
  opinionIds: string[];
}
```

- `storyChapter` 是可选叙事标签，不得替代事实、不得因“建议卡完成”自动等同成果。
- 主火焰的**基础存在感**长期稳定；项目聚焦时映射章/活动节奏；临时交互反馈独立。
- 不许“七天无新观测 → dormant”，除非真实观察覆盖该区间；即使覆盖也只表示近期安静。
- 高价值事件火星对应 `eventId`，刷新不重复播放；事件历史可点击查看来源。不能以火势推导健康/完成度。
- 表现层可以沿用 PR #5 WebGL/GSAP 五种视觉形态，但五形态不构成五个进度等级；全部形态必须有静态无障碍说明和 reduced-motion 降级。
- 用户可关闭火效，不影响后台观察与已获授权研究。

## 7. 最小 API（草案，不破坏已有路由）

- `GET /api/v1/life/projects/:id`：生命投影、事实新鲜度、可读摘要；
- `GET /api/v1/opinions?projectId=`：分页、状态、证据摘要；
- `GET /api/v1/opinions/:id`：全部修订、来源、方案、用户决定；
- `POST /api/v1/opinions/:id/feedback`：采纳/搁置/反驳/编辑建议，CSRF 与权限；
- `GET/PUT /api/v1/research/policy`：授权、允许域、预算与禁外发设置；
- `POST /api/v1/research/:id/cancel`：停止本地研究；
- `GET /api/v1/proactive`：当下最多一个高价值意见，未准备好为空。

**MVP 不应增加自动执行工作 API。** 若复用既有 Analysis Run，沿用其现有的预览、授权、请求范围与异常合同；新的后台研究许可不替代这个授权。

## 8. 迁移和兼容审查

必须审查：`apps/web/src/features/projectEmber.ts`（旧“3条消息=繁盛”、卡片完成=金火）、`emberHeat.ts`、`AppShell.tsx`、`ChatPage.tsx`、`ProjectsPage.tsx`、`EmberAtmosphere.tsx`、`apps/server/src/http/routes/chat.ts` 及现有持久化 schema。

先写对应负例，再换 projection。旧 Demo 和真实模式数据隔离；不直接删除旧数据库、不无声迁移项目记忆。新的研究/观点记录用 schema 版本和确定性重放来支持恢复与复审。
