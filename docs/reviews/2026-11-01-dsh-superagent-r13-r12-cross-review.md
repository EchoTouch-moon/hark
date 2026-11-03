# R13 · PR #12 最新 R11 v2 / R12 交叉复核：首个离线 PoC 前的最后规格歧义

> 日期：2026-11-01 · **RESEARCH-ONLY REVIEW / NO IMPLEMENTATION AUTHORIZATION**  
> 审核基线：Hark PR #12 HEAD [681a90c](https://github.com/EchoTouch-moon/hark/commit/681a90c5c8a91bc51c1d58ca25bbadd2a4762aab)，新增 [R11 v2](./2026-11-01-dsh-superagent-r11-frozen-contracts.md) / [R12 Group B Fixtures](./2026-11-01-dsh-superagent-r12-group-b-fixtures.md)；既有 G0 合同 [02](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/02-contract-and-decisions.md) 和 [05](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md)。  
> DeepSeek 公开原型参考（固定版）：[`src/core/intake.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts)、[`src/core/evals.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts)、[`src/app/outbox.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts)。  
> **本次静态复核，未运行任何测试、模型、项目目录或真实网络操作。**

## 0. 总结

- **R11 v2：ACCEPT（作为研究与实验设计合同，不代表 G1-A 动态通过）**。已修正四类准入/恢复/读行为、故障注入证明力、配额口径、投影作用域与日志基数，方向正确。
- **R12：CONDITIONAL_ACCEPT / NEEDS_SPEC_PATCH**。六组测试、双账单、白名单、人工 rubric 已经接近首个 PoC 所需的最小面；但 **测试输入、类型契约和具体 G0 投递保证存在冲突**，不能让编码 Agent 自行猜测。
- **下一步优先**：让另一端做**一次 R12.1 规格勘误**，只处理下述问题并冻结；完成后可请求用户批准一个纯离线、合成数据、无 Provider/网络/真实用户目录的 PoC。不要为了文档再重新造 Engine/Router 或长期 Memory 服务。

## 1. 必须修订的规格问题

| 编号 | 级别 | R12 原问题 | 为什么错 / 可能误导实现 | 建议最小勘误 |
|---|---|---|---|---|
| F01 | **P0** | N1 将 `eA4` 描述为“新 Git commit，SHA 不同、消息/内容与 eA1 相同”但要求 `NO_NEW_EVIDENCE` | **相同 commit message 不等于相同提交/同一事实**。新 commit 可能改变不同文件、父提交、时间或影响范围；只按摘要内容去重会吞掉真实项目变化。DeepSeek Trigger 去重按稳定事件身份、不是字符串内容相同 | 至少拆成两个 fixture：① 同一 `sourceEventId + epoch + contentVersion` 的重复投递 → 不算新证据；② 不同 Git SHA、相同 commit message → **需要重新判定变更事实**，不能直接 `NO_NEW_EVIDENCE`；可以限定“项目相关证据语义投影相同”，但要显式列出 diff/binding，且源事件仍需入账 |
| F02 | **P0** | `reasonCode` 声明只能取十个枚举值；N1 正例却要求 `reasonCode=null` | schema 内部自相矛盾；会诱导代码用默认拒绝码或为通过测试而放宽全局枚举 | 明确 `reasonCode: ReasonCode|null`；对于 eligible/would_present 应为 `null`，其他 disposition 按状态-理由关联校验。另在 Candidate 逻辑输出中区分 `evidenceDiffCount:number` 与 `newEvidenceRefs: EvidenceRef[]`；R12 把 `evidenceDiff: int` 和 `evidenceDiff=[eA2]` 两种含义混用 |
| F03 | **P0** | N6 反例 4 的绝对规则“ACK 丢失 → 不重发，也不计已呈现” | G0-02 §4 明确：**展示后、确认前崩溃时结果不可确定，租约到期可重新竞争，恢复可能重复一次**；不能保证永不重现，也不能把未知当作确定未展示。“不计已确认 presented”可以，“不重发”不能当无条件正确性断言 | 区分 `ack committed but response lost`（重试同一幂等键，必须返回原确认、不重复计数）与 `rendered but ack never committed`（`delivery_uncertain`；过期后可能按去重/冷却规则重竞争，不能宣称 exactly-once），分别有明确预期 |
| F04 | **P1** | N4 把含 projectB 的候选写作“反例判 FAIL” | 这是**应被拒绝/隔离的输入**，不是正确实现的测试执行应失败。若测试将 expected=FAIL 写死，会造成合规实现被判失败 | 定义 `candidateDecision=blocked/withheld`、`reasonCode=PROJECT_SCOPE_DENIED` 或独立 `authorizationError`；**测试预期 PASS iff 泄漏被拦截**。若枚举冻结不允许新增，则将 scope 权限拒绝放到 Candidate 决定之前，不需要新增可展示 reasonCode |
| F05 | **P1** | R12 §8 声称“六组正反例共 12 条”，而 N6 有 1 正例和 4 反例 | 算术不符：N1–N5 共 10 条，N6 共 5 条，因此按表列的可分离基础场景是 **15 条**；若 N5 本身为双时态重复测，还要明确是否算测试 case | 修改总数为“**6 组、15 条列举情景（含 N6 四反例）**”；与参数化/多设备组合扩展另计，避免虚构准确 case 数 |
| F06 | **P1** | `Candidate Decision Trace` 没有 `whyNow` 和 source/Goal ref，但 N2 又要求检查 `whyNow` 文本；N4 要“整个 trace 无 B 标识” | 两份账单刻意不存用户正文是对的，但**评估输出契约和持久审计契约不是同一个类型**；否则逻辑测试找不到被测字段 | 增加独立**非持久化** `CandidateEvaluationOutput`（含可核对 source evidence refs、goal revision ref、`whyNow`，仅在合成实验使用）；审计表仍只存枚举和有界数量，避免为了测试偷偷落敏感文字 |
| F07 | **P1** | 五维 rubric“打扰成本（反向计分）”中 1=打断也值，5=完全不值得打断，却未定义总评分方向；分歧≥2 不进平均 | 高分代表**更高打扰成本**，不能直接和其他“高分更好”指标相加；剔除分歧过大的样本会夸大一致性 | 将该指标标为**cost，越低越好**，或转换 `attentionBenefit=6-cost`；两人分歧≥2 时标 `DISPUTED` 进入第三方仲裁/另报比例，不能通过剔除争议样本虚报性能；在执行前公开阈值与样本分母 |
| F08 | **P1** | R12 结尾称“通道故障的安静必须出声说明我现在不知道” | G0-05 规定在用户查看时以状态/文字**明示未知**，并不意味着每次源 stale/ACK unknown 都要**主动推送打扰**；否则“克制”本身被监控告警打破 | 区分 **passive status visibility**（页面打开时展示），**proactive alert**（需另外权限/关注预算/严重性规则）；不要因无新观点自动主动通知 |
| F09 | **P2** | 固定项目 A 已授权 observe/research/model；实验却承诺零外发、零模型 | 测试应该隔离“拥有授权”和“实际使用能力”；全部授权的 fixture 可能诱导 Agent 加入模型适配器 | `execute=false, providerEnabled=false, externalNetwork=false` 并注入“任何外发调用立即失败”测试替身；不要依靠授权足够宽而默认调用 |
| F10 | **P2** | TriggerDisposition 中 `fanout:string[]`、Candidate Trace 中 `mergedFrom:string[]` 允许任意内容，但又说“字段白名单即可无泄露” | 允许字段的值也可能是 URL、路径或自由文本；仅拒绝未声明键不足以证明隐私 | 严格校验 ID 格式、长度、固定 project scope、数量上限；原因码封闭枚举；审计清理策略仍单列 |

### 注意：N2 的“测试失败必然与视觉刷新目标无关”也需要 fixture 先定义影响范围

同一 JUnit FAIL 可能阻断视觉刷新或上线，因此仅更换一段用户目标文字，并不能自然证明“完全不相关”。请给出固定的目标绑定/影响边界，或选择明确无关的源事实作为反例；否则“相关性”地面真值由测试作者主观决定，无法严肃评分。

## 2. 与 DeepSeek 底层机制的具体连接

### 2.1 “事件有身份、证据有语义”必须两个层次分开

DeepSeek `Intake` 的稳定 `Trigger.id`/Disposition 解决**重复到达**；`Evals` 的 Gate / Assessor / Decision 解决**工作是否值得接**。两步不能合并成“同一个描述文本 → 同一个事实”。  
Hearth 应再添加自己的 **SourceRef / streamEpoch / sourceVersion / evidence applicability**：同一条 diff 的重新观察可以是新 Trigger 但没有新事实；反过来两次 commit message 相同也可以是实质不同事实。

### 2.2 “决定值得呈现”和“真的被用户看到”是独立的效果

DeepSeek 的 Outbox `receipt pending/sent/dropped` 是**系统对外消息通道状态**；Hearth G0 的 `claim / presented / delivery_uncertain` 是**客户端可视呈现的确认协议**。两者在“把意图和送达分离”这一结构上相通，但**sent ≠ presented ≠ read**，不应复用名称而混同语义。  
当回执未能落库，本地不能从沉默推断“用户绝对没看过”，也不能认为系统必定“应该再次提醒”；需要幂等回查与有界不确定性状态。

### 2.3 Hearth 的真正创新焦点

DeepSeek 的处理单位更偏向 **authorized work**；Hearth 的产品单位是 **project viewpoint**。R12 首个实验应该证明：对同一目标版本与证据版本，系统能生成正确的**观点呈现资格和 whyNow 的证据绑定**；而不是再造 DSH Worker Scheduler、Outbox 或多进程 Watchdog。

## 3. 编码进入条件：缩小范围，不无限延长研究

**R11 v2：ACCEPT as design**；**R12：SPEC_PATCH_REQUIRED**，但不需要再写几轮大架构文章。另一端可以提交一版精简的 **R12.1 errata（不覆盖原文也可）**，处理 F01–F08（F09–F10 可简单写进接口约束）。

闭环后建议只考虑一个**离线合成数据 PoC**：
- 零网络、零 LLM、零访问私人项目、零外部执行，实验仅含 candidate eligibility、evidence refs、GoalRevision 关联、decision trace 与 claim/presented 的可选纯模拟；
- 实验输出必须留 `DESIGNED/NOT_RUN/PASS/FAIL` 真正测试标记，成功不能夸大成 H1 用户价值已验证；
- 既有真实执行与跨项目安全门禁 G1-A 仍然 BLOCKED，不能因为 PoC 通过而放开真实 API；
- **用户明确同意后才能编码。**

**最新建议：R11 v2 `RESEARCH_ACCEPTED` / R12 `CONDITIONAL_ACCEPT` / IMPLEMENTATION `HOLD` / G1-A `BLOCKED` / H1 `NOT_MEASURED`。**
