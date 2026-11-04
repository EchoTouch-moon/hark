# M0 合同字段对照与裁决

状态：重建合同字段映射；**不代表每个字段已具备生产级执行或来源核验**。来源顺序、安全边界和阶段门槛见 `M0-CONTRACT-REVIEW.md`、`M0-EXECUTION-AND-E2E-MAPPING.md`。旧合同不因新增项目理解模型而废除。

| 合同及字段组 | 当前处理与裁决 | 未实现 / 使用前条件 |
| --- | --- | --- |
| `Risk`、`Sensitivity`、`Provenance` 枚举 | 旧 `src/contracts.ts` 保留枚举；项目事实、推断和用户决定在新合同中分开。 | 输入声称的 sensitivity/provenance 不是可信分类；服务端须从来源和策略确定，restricted 不得外发。 |
| `SourceRef` 的 type、uri、sourceId、observedAt、contentHash | 旧字段保留；项目理解的 `EvidenceRef` 区分 observer、research、decision，只给 observer 使用 epoch。 | 旧 type 无普通本地项目类型。正式本地来源须新增明确版本，绑定真实授权根、scope、来源和 epoch；fixture/vault 不得冒充。哈希和字符串均不证明内容或归属。 |
| `Event` 的 project、source、时间、TTL、summary、dedupe、分类和引用 | 保留旧结构；缺 TTL 的事件仍可解析、保存历史，但当前观察事实的时效预检为 withheld；过期、未来或推断也 withheld。 | 预检通过仅为 `needs_source_verification`。真实消费必须验证授权、来源存在/版本及可信时钟；对外响应需移除 restricted 的 payloadRef。 |
| `Candidate` 的 project、eventIds、whyNow、evidence、action、score、risk、expiry 与抑制状态 | 旧字段保留；候选与内嵌 action 的项目必须相同，缺证据和无 whyNow 拒绝。 | event IDs 的真实归属、风险由服务端确定、时效、来源及抑制一致性均未接入真实服务；评分不能证明观点有价值。 |
| `ActionSpec` 的 actionType、target、params、capabilities、risk、effect、limits、幂等键、sourceVersion、verification | 旧结构仅用于解析历史/内部数据；客户端提案使用独立严格入口，四类 action 均 disabled，客户端不能决定风险、效果、批准或完成。规范化摘要与幂等键有局部测试。 | 正式动作的固定风险下限、effect、能力、目标 allowlist 与按类型的 strict 参数 schema 尚未冻结；在它们及审批链完成前任何动作不得启用。 |
| `ActionCard` 的 candidate、project、evidence、action、时间、状态与用户反馈 | 旧字段保留，card 和内嵌 action 的项目必须相同。 | card→candidate→project 必须在服务端/数据库验证；前端不能直接推进执行或完成。旧 card 不是项目观点的唯一表示。 |
| `ApprovalGrant` 的 principal、card、动作/目标摘要、risk、能力、有效期与消费状态 | 旧结构保留；run→card→action 与 grant 的保守绑定规则见 `M0-EXECUTION-AND-E2E-MAPPING.md`。 | 身份认证、服务端风险推导、原子占用、执行前再次读取、来源版本复核及外部副作用恢复均未实现；结构合法不等于获批准。 |
| `TaskRun` 的 card/action、幂等键、状态、时间、产物、verdict、失败类别 | 状态图及非法跳转有测试；当前持久化层拒绝进入 executing/completed，中断中的 executing fixture 转为 pending_verification。 | 独立 verifier、真实执行和产物回读未实现；模型或客户端的状态/verdict 不得当成完成证据。 |
| `PanelSpec` 的 kind、query、refresh 和组件白名单 | 旧结构保留并仅对类型/未知字段做初步解析。 | 未实现服务端 query 授权、输出转义和渲染器；S12 不可标通过。 |
| `Project`、`GoalRevision`、`EvidenceRef`、`GroundedFact` | 明确项目身份、用户目标版本和三类来源；禁止公开研究引用冒充本地观察。 | 结构匹配不证明真实事实；正式项目生命周期、源内容支持和授权验证未实现。fixture 只证明合成机制。 |
| `Opinion`、`OpinionRevision`、`ProposedPlan`、`RevisionPair` | 分开事实、推断、反证/缺口、局限、观点和方案；方案不可执行；合成版本追加、CAS 和原因有测试。 | 正式来源核验、项目生命周期、真实用户价值及产品对话未实现；fixture 不能证明真实项目闭环。 |
| `Feedback` v1 / `FeedbackV2` | v1 兼容旧采纳/修改/搁置/反驳；v2 显式增加拒绝，保存版本标记；拒绝不自动视为事实证伪。 | `OpinionBundle` v1 不接受 v2 feedback；若需要组合新版本须定义新 bundle。真实身份、决定和反馈交互未实现。 |
| `ObservationGrant` 与项目 scope | 现有 fixture 每次读取/写入重新检查持久 grant、主体、根、项目、撤权、暂停和到期；合成项目非 active 时 withheld。 | 传入 principalId 不是认证；正式目录授权、排除范围、安全读取、进程内取消及撤权后缓存策略未实现。 |
| `contractVersion`、SQLite migrations 与审计 | OpinionBundle v1 和 FeedbackV2 显式区分版本；SQLite v1–v5 按版本迁移；fixture 记录和审计通过触发器防覆盖。 | 所有外部边界和正式存储均须绑定其合同版本及兼容测试；正式审计入口的脱敏和访问控制未完成。 |

## 裁决范围

- 执行系统保持关闭并不等于审批、执行或 verifier 已通过；未来每个能力须单独冻结合同、实现服务端边界并复核。
- 正式项目数据不因 fixture 的字段相等而自动成为真实证据；来源存在、真实性、适用 epoch、权限及项目状态必须由可信服务端在使用时重新核验。
- `docs/06-QA-BENCHMARK.md` 的 E2E-01～12 均未运行。与旧 UI 数量/执行表述有冲突的项目保留逐项审查记录，不以文档改写作 PASS。
- 静态字段对照、当前失败关闭和证据索引不替代 M0 的实际测试及独立 Gate 审查；安全 P0 Gate 未通过前不得启用真实 connector。
