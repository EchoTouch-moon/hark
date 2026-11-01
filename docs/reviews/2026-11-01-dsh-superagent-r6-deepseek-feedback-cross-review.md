# R6 · DeepSeek 原文深读反馈的交叉复审与编码前收敛建议

> 日期：2026-11-01 · 审查对象：[PR #12](https://github.com/EchoTouch-moon/hark/pull/12) 中 [《原文深读 × Hearth 炉心》](./2026-11-01-dsh-superagent-article-deep-read-and-hearth-soul.md)，新增时对应 `341a6e2`。  
> **性质：RESEARCH REVIEW / NO CODE / NO IMPLEMENTATION AUTHORIZATION**。公开原型 `6337fc8`、Hearth G0 基线 `e470436`；审查是对设计论证和源码行为的静态核验，未运行 DeepSeek/Hearth、未测吞吐/噪声或真实 H1 价值。  
> 原文参考：[DeepSeek 官方公众号链接](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg) 与 [中文全文转载（第一财经）](https://finance.eastmoney.com/a/202610313917654063.html)；文章标明是设计探索，不能用内部实例描述断言开源原型实现。  
> 本报告是**第三方复核意见，保留原研究文档，不悄悄覆盖对方结论**。

## 0. 总裁决

**ACCEPT CONCEPTS / CORRECT INFERENCES / REJECT UNGATED IMPLEMENTATION / IMPLEMENTATION_HOLD。**

新增研究最重要的贡献不是“炉心=Router”，而是它把**注意力预算和静默准入**从视觉表现重新推到可解释的行为决策层。这个方向应保留。

但论文、文档和代码三方核对后，需明确：**Hearth 不是只有 UI 端的克制**。现有 [G0-05 §5](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md) 已**明确规定**四条服务端候选门槛：新增证据、与当前 Goal/Decision 关联、输入/搁置/冷却限制、**每项目 24 小时最多主动呈现一条**；[G0-02 ADR-05](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/02-contract-and-decisions.md) 已规定来源去重、研究预算和有条件模型调用。目前最大差距是**合同是否由真实 M3 引擎执行、有否事件与打扰漏斗的证据**，而不是空白待从 DeepSeek 搬一套 AttentionPolicy。

## 1. 七项机制的交叉验证

| # | 新研究建议 | 裁决 | 证据与必须补充的边界 |
|---|---|---|---|
| V1 | 将“克制”变成可验收候选判定 | **采纳其研究命题** | DeepSeek [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md) 强调少消耗人的注意力；Hearth G0-05 已有四门槛。需冻结 **candidate→eligible→presented→acknowledged** 各环节，不只统计卡数量 |
| V2 | 炉心应成为持有全部项目状态的唯一全局 Sequence Point | **修改** | DeepSeek Router 的 sequence point 是协调/对外交流语义；Hearth [G0-05](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/docs/mvp/g0/05-dual-track-and-viewmodel.md) 已定义 Mind→Experience 唯一 `HearthViewModel`。**唯一呈现投影≠唯一真相存储**；跨项目 scope/auth/freshness 不能被全局聚合抹除。保持 Project/Opinion/Source 为权威来源 |
| V3 | 确定性 Gate + `strength` + 命中规则及 whyNow 审计 | **采纳概念、精简形状** | `strength: explicit/inferred` 在 DSH 指**请求准入强度**，**不是**执行授权强度；Hearth 若记录，应更明确为 `triggerKind/user_requested|system_suggested` 及 `ruleRefs/version`；不能因为 explicit 就绕过单次执行批准 |
| V4 | 订阅直通已有 ResearchJob | **推迟实现** | DSH [002](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md) 明确订阅只传上下文、不授新权。Hearth 现在没有必要照搬 Ticket/Thread 所有权；未来仅限**活跃且授权的 ResearchJob、同 project/source、有效版本**把相关事件作为输入；必须保留必要的 source 轨迹与独立高优先级事件评估 |
| V5 | 观点八问作为引用图、截断文件补续读 ID | **研究价值高，但不是接口小改** | [files.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/packages/project-analysis/src/context/files.ts) 已标明 `sha256` **仅前缀内容**，`truncated` 可检测；当前安全条件包括 whitelist、项目根、符号链接阻断、尺寸/总额度、脱敏。续读必须重新校验 project/scope/当前文件身份/修改状态、授权、逐块范围与总预算，不能把“可读取全文”作为默认赋权 |
| V6 | 批处理候选评估窗口 | **仅保留研究假设** | DSH 原文的 batch 性能属于群聊高流量，不证明 Hearth 低频本地项目净收益。**模型判定次数减少不等于用户打扰次数减少**；延迟会影响用户明确发起请求与新关键事实。先测候选到达率与延迟容忍，再决定是否有窗口；不要冻结 15 分钟 |
| V7 | 零出站“投机研究”：只记录高价值结果，不记录失败 | **前半采纳、后半拒绝** | 可以在用户已授权的只读项目内做确定性差分/本地研究草稿；但**丢弃所有未呈现候选/拒绝原因**会使“静默是否正确”无法检验，违背审计、去重、用户反馈回放目标。建议仅保存有界脱敏 `decision trace` 和短期计数，草稿原始私密文本按保留策略处理 |
| V8 | 单次主动卡字数/阅读预算，跨信道共用 | **采纳研究问题，反对立刻固定硬值** | 一张卡仍可过长；但 DeepSeek 的“100 词”是沟通策略，**不能假定 host 强制执行**；中文表述和不同状态的有效信息密度需先盲评。字数/阅读负担与“是否值得打扰”各自测量，不把火焰热度当消息配额开关 |

**注：新研究是七项机制，其中 V8 独立列出其 §4.7 通信预算，使序点、准入、订阅、按需展开、批处理、投机研究、注意力预算可分别核对。**

## 2. 对新文档中三个核心论证的取舍

### 2.1 “Hearth 的约束只在呈现层”——**不成立，但有真实 implementation gap**

源合同已写出确定性的“什么才值得呈现”：新证据、目标绑定、用户没有在输入、冷却、24 h 配额；`M3` 是否真正产出 `OpinionRevision` 且能执行这些门槛仍是工程/动态验收问题。正确的研究问题应该是：

> 在已有 G0 规则下，多少候选被正确静默、多少有价值候选被漏掉、用户觉得主动告知是否值得？补上 `ruleRefs`、`would_present`、呈现原因及失败原因是否改善审计/质量？

不要再次起草一套重复的“AttentionPolicy”。

### 2.2 “炉心唯一持有所有项目状态”——**需明确拆成两个 Sequence Point**

- **事件序点（如存在）**：由 source/store/transaction authority 定义，只保证各自的稳定顺序和身份；跨项目不存在天然的绝对顺序/单一版本。Hearth Observer forward_seq 的排序语义不能被统一 UI timestamp 随意替代。
- **呈现序点（建议）**：同一用户与 surface 焦点下唯一确定性 ViewModel 组装/claim 入口；聚合项目摘要时每个项目保留 scope、权限、新鲜度和出处，不能变成无需授权即可访问全库的“万能心智”。

读侧单一入口可以很轻，不需要一个全局常驻 LLM 或新的事实权威。对已有 `stale` 时仍按旧信息 `deriveFlame` 的问题，优先审查“过期/无覆盖时视觉是否降级并解释来源”，而不是假定加一个全局序点就自动解决语义新鲜度。

### 2.3 “投机执行 = 安静陪着的物理实现”——**应重命名、收紧并保留拒绝记录**

Hearth 的 `passive evidence preparation` 仅指已授权源上的只读观察、已读事件差分、确定性候选检查和内部审计，不应被称作主动执行/自动复现。用户未登记的目录、Git hook、执行命令、测试、模型调用和公网请求仍各自受限。

**研究时要分清三个分母**：产生的候选总数、允许展示的高价值候选、实际成功展示/用户确认的数量。被判定“没事”的条目也需要能追溯到安全且有保留期限的拒绝摘要；否则产品只有“我很安静”的宣称，无法证明没有漏报。

## 3. 与原文交叉验证后的四个容易忽略的矛盾

1. **节省 Router 决策 ≠ 用户注意力收益**：直通可减少决策数与缓存消耗，但原文也说明完成时间改善不显著；对 Hearth 需直接测 `unnecessary_interruptions` 与 `missed_valuable_opinions`，而非 Router token。
2. **可检索 ≠ 可读取任何内容**：Prefix hash 是截断文本的证据，不是内容稳定全文版本；读取后续块需新的校验/脱敏/限额，尤其要防止模型用“再看一段”绕过上下文白名单与出站审批。
3. **本地优先 ≠ 永远不联网**：DeepSeek §5 论证环境留在本地的现实困难，但其方案也考虑云端状态与计算；这支持“本地源码/凭据不应随意复制”，**不足以证明所有计算必须本地**。Hearth 的单独公开研究和模型 Provider 授权仍然有效。
4. **克制不是“一律少说”**：若把卡片字数硬限、candidate 合并窗口和火焰状态全部串在一起，会使突发关键事实被吞掉。静默的假阳性（该提醒却没提醒）必须与噪声的假阴性一起度量；按目标重要性判断，而不是“越少越好”。

## 4. 编码前只剩哪些研究问题？建议两轮收口，而非无限阅读

### R7 · 行为机制与权限边界定稿（再一轮研究）

**单一目标**：对 8 个机制逐一决定 `REUSE G0 / ADAPT / DEFER / REJECT`，只形成“合同差异清单”，不能新建功能框架。

重点查三项硬前提：
- `G0-05` 的四项 ProactivePolicy 怎样成为可审计事件/决定证据，而不是在前端写一个静默 if？
- `Project/Opinion` 与 UI 表示之间怎样区分真相所有权与呈现序点？一条线程关联多项目时，若只允许读 A，怎样证实不引用 B？
- `passive preparation` 与 `Context Runtime` 的读取/续读边界分别在哪里？何时要拒绝进一步读文档？每种授权的撤销如何覆盖在途工作？

**R7 出口**：每项设计有证据、原合同落点、否定例、当前实现情况和待测假设，不能靠单句“已有/缺失”。产出一页明确的“**可编码/不要编码**”范围。

### R8 · 离线实验规范冻结（最后一轮研究）

**单一目标**：把已有 [R4 34 项合成场景](./2026-11-01-dsh-superagent-r4-hypotheses-and-evaluation.md) 中与第一实验切片直接相关的部分挑出来，冻结最小前置样本和判定标准；不把 34 个全部变成 MVP 阻塞项。

建议优先覆盖：跨项目不混用；READ 不写；模型建议不授予执行；README 注入不升级；`explicit/inferred` 不影响动作许可；有新证据但未被显示；重复展示/崩溃语义不假装 exactly-once；源 stale/epoch reset 时明确 unknown；“值得告知”和“没必要告知”的**成对正反例**。

**R8 出口**：冻结 fixtures 与人工判定 rubric（相关性、新信息、证据、行动价值、打扰成本），说明哪些可用纯函数离线验证、哪些必须后续真实 H1、哪些明确 `NOT_MEASURED`。尚未执行的案例不得称为 PASS。

### 然后才进入最小编码尝试（需用户另行明确授权）

- **先决硬门**：既有 G1-A 对真实/未知模式执行路径和 GET/项目隔离的安全修复与测试不能因研究完成而跳过；任何切入真实 API 的研究功能都必须先证明不会绕过它。
- **推荐首个尝试**：**离线 / synthetic / deterministic 的“候选 → 解释为什么值得或不值得呈现 → 记录拒绝理由 → 单一 ViewModel 投影”切片**，无模型、无公网、不触碰真实用户项目、不执行命令；不建新 Router、全局状态真相库或 Worker 池。
- **最小成功准则**：可追溯的候选漏斗、用户可理解的 whyNow、正确静默与不漏重大证据、跨项目/权限无混用、所有结论只从模拟项目事实得来。真实性、Model 质量、H1 用户价值仍需后续单独验证。
- **实验不能用 Demo 证明真实安全**；R8 的测试设计通过不等于 G1-A 修复通过；不得向真实产品混入 Mock 成功状态。
- **审批模式**：本 PR 的“研究通过/可编码设计”≠ 自动授权编码，更不意味着允许真实网络、付费模型、GitHub 提交或自动执行。这些均应独立发起。

## 5. 决策快照（本轮）

| 问题 | 本轮答复 |
|---|---|
| 另一台电脑 DeepSeek 的研究值得保留吗？ | **值得**：明确了 attention/quiet 的行为可证伪性，补上组织方式与通信预算视角 |
| 是否要重构 Hark 为 DSH Router/Worker？ | **不需要**，当前没有有证据的收益 |
| 需要新的全局“炉心真相所有者”吗？ | **不需要**；沿用分域权威 + 单一有界的 presentation projection |
| 马上用 Chain of Recall 自动续读任意文件？ | **不可以**；只在独立批准的受控读取权限/版本/限额下研究 |
| 需要几轮才可小范围编码？ | 建议 **R7 + R8 两轮收口**，如果两轮能关闭关键争议，则开始 **隔离的离线 PoC**，不承诺真实产品安全已经通过 |
| 现在的状态 | **RESEARCH_CONDITIONAL_PASS / IMPLEMENTATION_HOLD / H1_NOT_MEASURED** |

**对用户最重要的产品判断：Hearth 的“灵魂”不是它总能说话，而是它既有观点，又知道什么时候有足够证据值得开口。**
