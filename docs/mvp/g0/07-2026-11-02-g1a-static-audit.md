# S0-01 · G1-A 静态核对第一轮（2026-11-02）

> 结论：STATIC_REVIEW_COMPLETE_WITH_GAPS / DYNAMIC_NOT_RUN。
> 基线：2026-11-02 当前 bot/hearth-g0-contract；只读 GitHub 源码核对，未执行本地命令、未打开私人项目、未触发模型、未变更业务代码。
> 本审查不证明漏洞可实际利用，也不是 G1-A 动态验收。更精确的入口行为必须在隔离环境中以真实 HTTP、数据库前后状态和 Executor spy 验证。

## 1. 已有服务端保护（已看到源码，不等于动态 PASS）

| 入口 | 源码事实 | 本轮判断 |
|---|---|---|
| routes/threads.ts:59–68 | GET /threads/:id/proactive 对已存在的线程返回 suggestion:null；旧 thread action execute 403 | 旧主动写入已静态移除，不能冒充新 G3 候选实现 |
| routes/runs.ts:21–35, 51–61 | execute 和 approve 在调 Orchestrator 前调用 legacyDemoAllowed() 门禁 | 默认真实模式拒绝可期待；仍需真实/unknown、伪造 demo、并发和直接服务调用计数验证 |
| http/legacy-demo.ts:5–7 | Demo 允许需 config.demoMode===true 且 orchestrator.legacyExecutionEnabled | 是服务端条件；并不替代 Demo 与 real 数据隔离验证 |
| routes/core.ts:71–81 | Demo reset 在非 Demo 模式拒绝，执行时 storage.resetDemoData()，错误返回 RESET_REFUSED | 实际删除归属和 UI/API 文案仍需联测；无可信来源时应持续 fail-closed |
| http/event-projection.ts、routes/projects.ts:5–10、routes/cards.ts:33–40 | Project/Card/Events 详情调用响应投影，修复 restricted payloadRef 的三个出口 | 合并 PR #30 的局部修复；复测需覆盖内层聚合和新入口 |
| http/app.ts:55–86 | onRequest 拦 Origin，preHandler 检查 session，非 GET/HEAD/OPTIONS 写请求校验 CSRF 和 Origin | 共享防护存在；需针对重点写接口以实际 HTTP 负例验证 |
| http/hearth/observe-view.ts:35,60–129 | featuredOpinion 固定 null，execute=false；项目 scope 在被观察列表里检查；错误、无权限走明确状态 | HearthViewModel 观察只读路径可复用，但无法据此认定 Opinion/主动呈现已实现 |

## 2. 需优先用负例确认的边界（源码层面仍不足）

| 编号 | 路径与证据位置 | 源码观察 | 最小验证 |
|---|---|---|---|
| GAP-01 | routes/threads.ts:7–12, 29–44 | CreateThreadSchema 接收可选 projectId 并直接保存；该函数内未见项目存在性或当前 scope 绑定检查 | 以跨项目 ID、未知 ID、Demo/real 混淆提交，新线程不可绕过稳定 ProjectSource/Thread 绑定规则 |
| GAP-02 | routes/chat.ts:8–25, 74–86 | body 接收 projectId，但写入时使用客户端传来的 threadId/ensureThread；历史读取直接按 threadId，不见项目绑定校验 | 两个项目分别持有唯一消息，伪造 threadId 与 projectId、切换焦点、并发旧响应；确认跨项目不可串线 |
| GAP-03 | routes/cards.ts:25–43, 45–75 | listCards 允许不带 projectId；详情、dismiss、snooze 通过 card ID 访问并写状态，路由内无项目 scope 交叉校验 | 对另一项目 card ID 进行读取/反馈/延后；区分全局列表合法展示和项目焦点私有访问的合同 |
| GAP-04 | routes/runs.ts:36–49, 63–113 | runs 列表 projectId 可省略；run 详情、cancel、stream 按 ID 读取，路由没有显式 scoped project 交叉校验 | 非所属项目 runId 是否能读步骤和 SSE / 错误取消；执行关闭不代表只读/取消自然隔离 |
| GAP-05 | routes/projects.ts:15–35 | 项目详情校验 projectExists，事件列表 projectId 可省略；未看到以请求焦点为边界的 server project binding | 合法 global vs project scoped 查询分开测，测试 restricted/personal/source 引用跨 project 混合情况 |
| GAP-06 | http/hearth/observe-view.ts:35 与 G0-05 §5 | featuredOpinion 仍固定 null；新呈现资格、claim / presented 尚未进入真实 HTTP | 不能将 #15 离线 PoC 直接标记为产品 G3 PASS；后续走有界 ViewModel 集成 |
| GAP-07 | routes/core.ts:71–81 与 PR #29/30 | reset 由 storage.resetDemoData() 负责 fail-closed；API 错误使用 String(err) | 检查错误文本是否含内部细节，UI 禁用文案与 HTTP 一致，数据隔离/重启/异常中断不误删 |

**解释边界**：Hearth 当前是本地单会话应用，未必存在多用户鉴权问题；以上是对“项目与线程身份隔离”这项 G0 新合同的适配缺口，不能直接上升为已实证的远程越权漏洞。必须在服务端 scope / 授权来源确定后执行动态负例，而非要求前端简单隐藏列表。

## 3. GitHub 治理最新事实（实时读取，不沿用旧文档）

- GitHub Rulesets API 已返回两条 active 规则：protect-master（id 26311175），仅作用 master；protect-g0（id 26312695），仅作用 bot/hearth-g0-contract。
- 两条均要求 PR 合并（批准人数 0）、唯一必需检查 ci-gate（GitHub Actions integration_id 15368、strict）、禁止强推与分支删除。
- 直接读取 /branches/master/protection 被当前 GitHub App 权限拒绝（403），但上述 ruleset 实体、target、enforcement、rules 已由 GET /rulesets/:id 核实，足以认定 Rulesets active。
- docs/engineering/branch-protection-plan-2026-11-01.md 仍记“NOT APPLIED”，这是历史快照，不能拿它指导新 Agent；不建议在本任务中更改 Ruleset。

## 4. 建议的下一张开发前检查表

1. 固定 G0 最新 SHA；独立合成 Mock server + 双项目、双线程、唯一 Evidence 标记，各自保存先后快照。
2. real / unknown / Demo 的 execute/approve/recover/cancel 入口矩阵，逐格检查 admission、executorCallCount、permittedDbDelta 和 auditSemantics（参照 PR #12 R11 v2，动态结果未跑）。
3. 各 direct GET/POST 的项目隔离矩阵：threads/chat/cards/runs/projects/events/hearth；含 forged 参数、并发焦点切换、SSE 与重启。
4. reset 数据归属与错误文本；restricted 引用各入口的二次回归。
5. HTTP preHandler 的 session/Origin/CSRF 负例（不以源码存在代替测试）。
6. 如有 FAIL，只在独立 G1-A 分支修最小缺口，先提交失败复现，后修复；远端 ci-gate 成功与人工复审齐备后再宣布 PASS。

## 5. 本轮未做

- 未下载或执行仓库测试；未动态制造跨项目攻击；未跑子进程故障注入。
- 未验证真正的私人项目隔离、用户体验/观点质量、数据库演进，亦未衡量费用或研究效果。
- 没有代码更改、没有合并、没有修改 branch rulesets，真实运行环境与网络保持不变。
