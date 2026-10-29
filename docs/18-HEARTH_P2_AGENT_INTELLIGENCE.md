# Hearth · P2-A Agent Intelligence 开发规格 v0.1

> 性质：可执行产品规格，不是基础设施蓝图  
> 日期：2026-10-29  
> 前置：P0 Observer、P1 Insight Engine / Feed（`CONDITIONAL_PASS`）  
> 本阶段只做：用户触发的只读分析，以及一张可行动的建议卡

## 1. 产品目标

P1 已经能可靠地知道项目发生了什么。P2-A 要验证的是另一件事：

> 用户在 Insight 详情里点「深入分析」之后，Hearth 能否阅读该项目的真实状态，并给出有证据、有边界、可以直接行动的建议？

成功标准不是多一个服务。成功标准是：在 `pindou` 或 `prototype-skill-lab` 上，一个真实用户愿意点开那张建议卡，并知道下一步做什么。

## 2. 第一版用户路径

1. 用户打开 `/insights/:id`。
2. 点击 **深入分析**（仅此入口，无后台轮询、无通知）。
3. Hearth 组装只读 Project Context（观察事实、Insight 规则解释、有限文件摘录、用户可见的项目目标）。
4. 通过 Provider Adapter 调用 **Pi**（第一执行器）做一次受控只读分析。
5. 结果落成 Recommendation Card：结论、依据、风险、建议下一步。
6. 用户可以 acknowledge / dismiss / useful / not_useful。不自动改代码、不跑测试、不发消息。

## 3. 必须遵守的边界

- 只读。禁止 `git commit`、改工作区、写测试、装依赖、开网络爬取用户源码托管。
- 证据优先。每条建议至少引用一条已有 P0 事件、P1 Insight 或用户明确授权阅读的文件片段。
- 不能把 UNKNOWN / UNDETERMINED HEAD 说成「当前提交失败」。
- 没有证据时返回 `NO_RECOMMENDATION`，不要用空话填卡。
- 统一 Provider Adapter。Pi 是第一实现；Hermes 的长期记忆与偏好稍后接入同一接口，不在本阶段绑死单一 Agent。
- 沿用现有 session、CSRF、路径脱敏。分析请求要限流。

## 4. 建议的最小切片

### P2-A0 · 产品合同

冻结 Recommendation Card 字段、Context 允许读取的来源清单、Provider 输入/输出 JSON。写一条 ADR：为什么 Pi 先上、Hermes 后上。

### P2-A1 · Context Assembly

纯函数优先。输入：`insightId` + 项目观察摘要 + 有限相对路径文件（上限与截断必须可测）。输出：给模型的只读包。禁止扫描家目录。

### P2-A2 · Provider Adapter + Pi

一个接口：`analyze(context) -> structured result | NO_RECOMMENDATION | PROVIDER_UNAVAILABLE`。超时、失败、空结果都要在 UI 里诚实显示。

### P2-A3 · Recommendation Card UI

Insight 详情上的「深入分析」、加载/失败/无建议态、依据列表、跳回 `/observe/:id`。复用 Hearth 现有设计系统，低干扰。

## 5. 明确不做

- 系统通知、邮件、主动打扰
- 自动改代码、自动开 PR、自动跑测试
- 多 Agent 编排、队列、向量库
- 项目完成率、进度停滞主观判定
- 为了「看起来聪明」而扩大上下文窗口或加新的基础设施

## 6. 验收（第一版）

| ID | 必须看到 |
|---|---|
| A1 | 未点「深入分析」时不调用模型 |
| A2 | 无证据时 `NO_RECOMMENDATION`，Feed 不出现假卡 |
| A3 | 建议卡含结论、至少一条可核验证据、风险、下一步 |
| A4 | 失败/超时显示真实错误，不伪装成分析完成 |
| A5 | 分析不修改被观察仓库的 HEAD / status / index |
| A6 | 在一个已登记真实项目上走通一次，留下截图 |

P2-A 通过的标志：一次真实点击产生一张开发者认为有用的卡。不是又一份架构图。
