# DeepSeek Super-agent 原文 × 公开原型 × PR#12 补遗：第三方交叉验证与概念收敛

> 2026-11-01 · **RESEARCH REVIEW ONLY / NO IMPLEMENTATION AUTHORIZATION**  
> 对象：[PR #12](https://github.com/EchoTouch-moon/hark/pull/12) 新增 [architecture-supplement.md](./2026-11-01-dsh-superagent-architecture-supplement.md) @ `d422dd54`；[DeepSeek 原型](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e) @ `6337fc8`；Hearth @ `e470436`。  
> DeepSeek 原始公众号入口：[mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)；本次以[注明原文作者的全文转载](https://www.chaincatcher.com/article/2300676)核对文章内容，**未宣称直接读取/校验了公众号原始页面**。  
> 本次是**二次静态与文献交叉验证**，未克隆/运行 Harness、未启动 Agent、未调用模型、未复现实验、未修改产品代码或现有 G0 合同。

## 0. 裁决概览

**第二轮补遗总体有价值，但不是无条件 PASS。** 新增 Gate→Assessment→Host Decision、Admission table、Effects/Outbox、权限外移的风险点、Rejected concepts 的研究方式，均为实质增量。它修正了 PR#12 初稿的若干视角盲点。

不过，原补遗存在数处**可直接由源码反驳**或**推断超过证据**的语句，应作为勘误处理：

| 编号 | 补遗说法 | 本轮核查 | 收敛后的准确表述 |
|---|---|---|---|
| C01 | “模型只能填证据，不能填结论” | **不准确**：`src/policy.ts` 的 `Assessment` 直接要求 `decision: 'accept'|'ignore'|'unavailable'`，模型可**提议** accept | **模型提出 Decision 候选，host 依准入强度/规则覆盖/方向/证据强制换算为最终 Outcome**；模型不能单凭声称获得权限 |
| C02 | “原型唯一能改变生产代码的动作是合并 PR” | **表述越界**：Worker 可执行 shell、改 worktree、push GitHub 分支、创建 PR、写 GitHub 评论；merge 是**使改动进入受保护分支的关键阶段**，不是所有真实副作用的唯一入口 | merge 的 host 缺少专门强制门禁，外部 GitHub branch protection 才能成为最终强制边界；所有写/出站路径都需审查 |
| C03 | “Auto-merge 的唯一约束是提示词 + 仓库外部设置 / 提示词就是权限” | **部分成立、措辞过强**：`docs/003` 承认 host 无 merge-specific decision；但默认不开 agent 账号 auto-merge，且 **GitHub CLI 账户权限、分支保护**是独立强制边界 | “内部自动合并条件部分靠提示词执行，缺少 host 内部强校验；**不得把提示词视为安全边界**”，而非“所有权限只由提示词决定” |
| C04 | “GET 必写 / ensureThread 无条件写入” | **不准确**：路由无条件**调用** `ensureThread`，但 `Storage.ensureThread` 若已存在直接返回，不写；已 consumed/无用户消息分支也可能无写入 | **GET 是可能写入且在特定路径确定写入**：不存在的 thread 会 INSERT；已有用户消息、尚未 consumed 且正常供卡时更新消息/状态 |
| C05 | “H-P0-02 只是标签不一致，只需改契约文案” | **过度降级**：确有括号提醒“未接外部执行器”，但客户端提供的 action/demo 同时影响 `parts.result.ok: true`、`done` 等持久显示状态；旧服务端真实/未知模式隔离问题并未消失 | **展示契约矛盾 + 信任边界问题并存**。文案修正不能替代真实模式服务端拒绝旧模拟执行入口 |
| C06 | “Hearth 无 Health 契约” | **过度概括**：`apps/server/src/http/routes/core.ts` 已有 `GET /api/v1/health` 及 coordinator/provider health 投影 | 缺少 DeepSeek 式每 effect kind 独占申领的 **HealthBoard 模型**；不是没有任何 health 机制 |
| C07 | “Hearth 无单写者约束” | **过度概括**：Hearth `Storage` 门面集中 DB 操作，有事务状态机和 append-only audit；但未见 DSH 式 domain aggregate owner 的独立性合同 | 应写为“**单写者语义/并发所有权尚需逐域核查**”，不要抹掉现存存储收口 |
| C08 | “任意人一句话默认恢复 Ticket” | **危险性方向正确、前提不完整**：只发生在属于该 Ticket 的 **own Thread 的人类消息**，排除 stop 和 context-only；Resume 仍要求 Source 监听且 Mandate revalidate | “对 **own Thread 上的其他人** 未单独重审身份，可能沿原 Mandate 恢复；不宜迁移至多项目/私人数据环境” |
| C09 | “没有 watchdog|inline.*spill|chain of recall 检索命中”证明全部未实现 | **检索方法不足**：示例 `grep -rin "watchdog|inline.*spill|chain of recall"` 未加 `-E`，`|` 不作正则或匹配 | 依 README 的**明确不等同声明**、源码/设计对应关系判断；不以零匹配声称不存在。对象图/分页按 ID 回读的**一部分召回机制已实现**，但完整论文方案未经证明 |
| C10 | “把 Worker 优先 slot、每类队列并发直接落成 ResearchJob 强制合同” | **类比过拟合**：原型的 `maxWorkers+1` 针对人工消息唤醒，Hearth 的 ResearchJob 无等价可写 Worker 池 | 应将 **可中断/人工请求优先/有界并发** 作为需求假设，避免移植固定数值和无关状态机 |
| C11 | “Gate/Assessment/Host 三段式等同于 shadow 模式无需模型调用” | **不等同**：DeepSeek 的 `observe` 对通过 Gate 的 inferred 候选仍走模型 assessment，只把正面评估换算为 `would_accept`；Hearth 原 S1 定义为**确定性、零模型外发** shadow | 把 “**影子接受/行动**” 与 “**无模型推断**” 分别记录。若借用 DSH observe 语义，调用预算/隐私策略必须显式声明，不能默认零成本 |

C01 / C02 / C04 / C05 为最应优先纠正的四条；C06 / C07 / C09 属于证据纪律；C08 / C10 / C11 属于适用范围纪律。

## 1. 从原文重建其问题链（优先于照抄代码）

原文第 1 节不是“怎样写一个自主 Coding Agent”，而是：**当单任务越来越能交给模型时，人无法同时注意、派发、追踪许多 Session，形成新的多任务瓶颈**。作者提出四项能力：**连续、高效、主动、持久**。

这四项能力分别被拆进五套机制：

| 原文章节 | 目的 | 提出的具体机制 | 已公开原型的关系 | 文章仍未解决 |
|---|---|---|---|---|
| §2 双层架构 | Session 从用户心智负担变成系统内部细节 | Router 负责跨任务序点/沟通；Worker 负责隔离工作与局部推理 | 主 Session + 各 Ticket 的 Executor Session 有实现 | 单 Router 的横向扩展/跨 Worker 协作 |
| §3 事件驱动 | 持续性不是让 LLM 永远轮询一切 | Fast Path 程序过滤、Slow Path 语义判断；Thread 订阅直通；Inline/Spill、Chain of Recall；有限投机行动 | Source/Thread/Eval/Subscription/资源分页实现了**部分**；完整上下文管理及文章内部策略不等于公开代码 | 噪声/相关性/上下文准确性的真实质量仍待验证 |
| §4 面向人的交互 | 异步工作不妨碍持续沟通 | 不同 Channel 的输出节奏，异步 ReAct Loop，长任务开始/结束消息化 | 输出/队列/回执机制部分存在；原文明确某异步 Harness 特性尚未默认开启 | 用户如何脱离 Session 批准、审阅、纠错 |
| §5 计算/状态/环境分离 | 不因本地机器睡眠与 Agent Loop 重启丢任务 | 云端无状态 Loop + DB Session 状态 + 可插拔本地 daemon / BYOM | **公开原型的 SQLite + DSH 不是云端无状态集群或端侧 daemon 已交付的证明** | 凭据、联网、延迟、设备边界 |
| §6 外部 Watchdog | 同时查活性与进度（是否跑偏） | 具有模型能力的外部控制回路；可对系统设置进行干预 | README 明确文章部分设计未实现；公开版健康投影 ≠ 完整外部 Watchdog | Watchdog 自身授权、错误修复是否安全、如何限制权力 |

**核心概念图：**

```text
Environment → Source → Trigger → deterministic Gate
                                   │ admissible
                                   v
                               Eval / LLM assessment
                                   │ host checks rules, direction, evidence, mode
                   ignored / would_accept / accept
                                                 │
                                          Mandate + Ticket
                                                 │
                 ┌──── Subscribed Thread ────────┤
                 │ (context only grants no authority)   v
                 └──→ Inputs → Assignment → Executor Session
                                      │
                                Report / Outbox
                                      │
                                  User / Channel

                   SQLite domain state ≠ Session transcript ≠ cloud deployment
```

这里需要分清两条“Fast Path”：**准入 Fast Path**（无模型规则过滤）与**订阅直通 Fast Path**（已有任务直接接收后续上下文）；两者目的不同。并非所有通过 Gate 的事件都创建 Ticket，也不是所有订阅事件都重新 Eval。

## 2. 深入看授权：三层都要理解，不能只学一个开关

### 2.1 Gate 决定“候选能否入场”，不是“最终已获权”

直接证据：[policy.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts) 的 `settingsPolicy().gate`。它返回 `admissible`、`strength`、`basis` 或拒绝原因；机器来源、Source 的监听范围、身份表、直接点名和当前 Thread 关联共同决定结果。Gate 无模型调用。

注意源码会在准入时按场景选择不同路径：已列名单且 @ agent 为 explicit；inferred 在 mode=off 被阻断；受订阅的上下文可以被直接 fan-out，而不是获新授权后才允许引用。

### 2.2 模型**能提议**接受，但不能越过 host 授权

`Assessment` 的 `decision` 明确包含 accept。函数 `assessmentOutcome` 要求所有 enabled rules 恰好各评一次；若方向尚未确定、无匹配规则则换算 ignore；接受还必须有 `intent_evidence`；inferred 在 `observe` 中换算为 ignore + `would_accept`。这是**程序二次裁决**，不是“模型只能写证据”。

模型可以在允许的范围内写决策建议、理由和指向的工作；不能单靠自己的回复生成具有更高权限的 Mandate。

### 2.3 Mandate 与后续订阅的边界

`Mandate` 持有授权版本、来源和作用域；`Subscription` 决定“将新材料送去哪里”，**不赋予额外权力**。恢复旧 Ticket 时需考虑原 Thread、来源仍监听、Mandate 是否 revoked/stopped/revalidated。源码对 `basis.via === 'followup'` 的 explicit 路径确有较宽的重验语义，适合单仓协作约束，**不适合直接照搬 Hearth 的个人项目权限模型**。

### 2.4 权限不是只有模型这一层

系统的权限可分四层：
1. **来源准入**（谁的什么事件可进入 Eval）；
2. **业务授权**（哪个 scope/Policy/Mandate 允许接受什么工作）；
3. **实际工具/环境权限**（Worker OS 进程、GitHub CLI、账号、网络可达性）；
4. **外部平台强制保护**（GitHub 分支保护/审核/组织政策）。

原型对合并的审查揭示的是第三和第四层若不足，仅靠第二层的提示词行为规范不能强制保障安全；**不能说全部执行权限都由 prompt 决定**。

## 3. 深入看长期可靠性：四个“持久”不能混为一谈

| 层级 | 原型机制 | 保障程度与未解决问题 |
|---|---|---|
| **事件持久** | Trigger 身份/Disposition/Thread 游标 | 防重入、可解释消息去向；不证明遗漏消息为零 |
| **决策持久** | Policy version/Decision/Mandate/Ticket/Assignment | 恢复后知道“为何接单”，不证明此前外部动作一定完成 |
| **副作用持久** | `Effects` 先写 SQLite 事务后发任务、`Later` 延后不加失败、`Outbox` 发送回执 | 减少重复和乱序；外部发送成功后本地回执失败依赖目标平台幂等，**不是普遍 exactly-once** |
| **语义持久** | Source 资源页、Ticket 引用和对话历史按需回读 | 找得到历史不等于经过 Compaction 后的 task-critical state 在下一请求里仍正确 |

补遗的并发 4/4/1/1/1 和 `maxWorkers+1` 是 **DSH 这套部署的配置策略**，不是 Agent 长期可靠性的通用常数。Hearth 未来需要先证明哪类任务会等待、丢失或打扰用户，再选择是否需要这些机制。

原型明确说明它的持久记录 **尚无删除机制**（[007 Architecture §Persistence](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md)），这对私人项目系统的保留期限、删除/撤销及数据成本尤其重要。

## 4. 原文 §7 的实验究竟证明了什么？

实验是**路由/调度的合成基准**，不是长期记忆或实际编程能力的随机对照试验。

| 指标 | 报告数值 | 正确解释 |
|---|---|---|
| 消息 / 工作请求 | 每轮约 300 / 20 | 主要负载是闲聊、跟进、叫停、CI 消息，编码工作由耗时工具模拟 |
| 重复次数 | 每方案 5 次 | 初步参考，不是长时间生产数据 |
| Super-agent 完成时间 | p50 12.4 分、p95 15.7 分 | 证明在该模拟调度负载下性能较好 |
| 中性单 Session + Subagent | p95 29.5 分 | 对照依赖 prompt 配置与是否调用 subagent，**不能直接外推为任何单 Agent 都慢一倍** |
| 禁止直通时 Router 压力 | 决策数约 +30%；Cache read 约 2323 万→3177 万 | 能支持直通降低 Router 开销的机制性解释，但实验不证明用户注意力成本真的降低 |
| Router 到达速率测试 | 约 1→40 Trigger/min；batch 1→2.8；per-decision 6.4→1.6 秒 | 高到达率下批处理摊薄单次决定的推理时间；**不是无限可扩展证明** |

**绝对不能从实验推出**：“Watchdog 已在公共原型表现可靠”“真实 Coding 质量提升”“跨月记忆保持有效”“自动授权安全”“Hearth 的 Opinion 更有用”。

## 5. 对 PR#12 补遗的具体保留与修订意见

| 来源补遗 | 结论 | 理由 / 下一步只是研究活动 |
|---|---|---|
| §2 Gate/Assessment/Admission table | **ACCEPT WITH CORRECTION** | 保留三个机制，纠正模型不能提议 accept 的表述；区分 DSH observe 会调用模型与 Hearth 影子零模型方案 |
| §3 Merge prompt-as-policy | **ACCEPT WITH CORRECTION** | 保留安全警示，删去“唯一生产写入路径”、区分 prompt 指导 / host 授权 / GitHub 保护 |
| §4 Effects/Outbox 详细语义 | **ACCEPT** | 证据直接成立；不要把线程发送顺序直接套到 ResearchJob，也不要移植默认并发常量 |
| §5 任意人恢复 Ticket | **ACCEPT WITH SCOPE LIMIT** | 风险真实，但适用 own Thread + human + revalidation，不能泛化为任何消息/任何人无条件恢复 |
| §6.1 CSRF 豁免 | **ACCEPT** | `app.ts` 证实刻意跳过该 PUT 的 token，同时仍要求有效 session 和 Origin；**有裁定不等于已证明防护足够** |
| §6.2 GET 必写 | **CORRECT** | `ensureThread` 仅在缺失时写；路由仍违背 GET 应无副作用的原则；保留安全问题 |
| §6.3 Demo 只是标记不一致 | **REJECT AS SUFFICIENT** | 可补展示契约，但不能撤销服务端真实模式隔离/客户端权限不可信的 S0 门禁 |
| §7 Rejected concepts/HealthBoard/数据无界 | **ACCEPT/QUALIFY** | Rejected concepts 和无界存储确实值得学习；Hearth 已有 Storage 集中写与 health API，差别是更强的聚合所有权而非“完全没有” |
| §8 DEC-11–14 / DS-H-05a,b/07,08 | **PROVISIONAL** | 适合作为**可讨论的研究候选**；现在不写入可执行开发 Gate、不直接替换 G0 既有合同 |

## 6. 对我们三条研究线的真实启发

**Hearth/Hark：** DeepSeek 让 Session 成为实现细节，我们可以让 Project + Opinion 成为产品的一等身份；最需要借鉴的是 **把感知、判定、授权、记录、呈现、用户决定分层**。这是长期项目观点成立的条件，并非复制 Ticket 编排器。

**Context Runtime：** DeepSeek §3.3 的引用图/按需翻页主要回答 **“历史在哪里、如何沿 ID 找回”**；我们要证明的是 **“压缩替换后哪些 critical facts 在真正发给模型的上下文里继续有效，以及恢复是否改善任务结果”**。这两个研究问题相邻，但不能等同。按 Canvas 的 R2/R3 Gate 行事，不因为 article 提出 Chain of Recall 就推倒现有实验纪律。

**Agent Internet Lab：** DSH Router/Worker 位于一个由同一宿主主持的协调/授权系统内；A2A 要考虑不同主体、权限与信任域之间的通信与身份，不能把中心路由+会话订阅等同于跨 Agent 开放协议。

## 7. 建议下一步继续**阅读**而不是开发的问题

1. **原文范围**：文章哪些模块是在 DSH 内部跑起来的，哪些是论文式未来方向？尤其异步 Loop、Watchdog、云端 BYOM。
2. **信任边界**：为何 Source 过滤、Mandate、OS 用户、GitHub branch protection 是四道不同防线？哪个是宿主实际能强制的？
3. **长期记忆**：Chain of Recall 如何避免“找到了旧资料，却拿错版本/不适用事实”？
4. **观察模式**：若 inferred 审核走模型，如何核算成本、隐私和“只观察而不执行”的真正保证？
5. **真正的自主性**：Agent 能自主决定“何时值得打扰”，不等于拥有自主写入代码的权利。价值应如何被人的真实判断证实？

这些是下一轮讨论议题，不构成编码任务或新授权。

## 8. 证据等级及仍未完成项

- **ARTICLE（全文转载）**：§1–9 的设计意图、数值和未来方向，可信度来自文章署名/上下文，但不是本次亲自读取的官方公众号页面。
- **SRC（公开源码）**：`src/policy.ts`、`src/app/effects.ts`、`src/app/outbox.ts`、`docs/002`、`docs/003`、`docs/007` 与 Hearth `app.ts`、`routes/threads.ts`、`storage.ts` 等对应版本静态代码。
- **INFERENCE（本次判断）**：对 Hearth 的适用性与安全含义，不冒充作者明确主张。
- **UNVERIFIED**：原文的内部部署细节、长期运行性能、异常恢复实际可靠性、云端 BYOM/Watchdog 完整实现、Hearth 动态攻击面和 H1 产品价值。

**第三轮结论：RESEARCH_CONDITIONAL_PASS / IMPLEMENTATION_HOLD。** 理解 DeepSeek 的关键进步是把“人的注意力、事件来源、持久任务与模型会话”解耦为系统机制；下一步仍应深化设计理解，**不凭研究报告直接授予实施权限**。
