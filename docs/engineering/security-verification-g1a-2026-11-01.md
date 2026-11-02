# D-01 安全修复 · 当前核验记录

[PR #29](https://github.com/EchoTouch-moon/hark/pull/29) 已推送并基于 `bot/hearth-g0-contract@b2b70c2` rebase，尚未合并。独立复核针对 `daf03e14` 的结论是 **CONDITIONAL_PASS**；新提交须重新检查及最终人工复审。

| 核验项 | 当前要求与证据 |
| --- | --- |
| 生产执行 | 服务端生产装配不设置 `allowLegacyExecution`；卡片 execute、approval 和线程 action 均拒绝，返回 403。测试专用 opt-in 不代表生产能力。 |
| 正常查询与本地反馈 | cards、projects、events 等查询和 dismiss、snooze、discover 可用，并有断言表明不会调用执行器。 |
| 主动建议 | 已存在的线程的 proactive 返回 `{suggestion: null}`；测试比较读操作前后的状态。 |
| 首次 Demo 启动 | 仅精确 `HEARTH_DEMO=1` 启用；真实 `startServer` 测试检查首次合成数据初始化及执行拒绝。 |
| Demo reset | 使用合成的 Demo 项目、独立真实聊天及设置测试；不能证明为 Demo 的数据不允许因 reset 被误删，审计日志保持追加式。含种子数据的纯 Demo 库目前也拒绝，只有待清理表为空时才返回成功且不删除数据。 |

旧 head `daf03e14` 的 [Linux、Windows 和 ci-gate 运行](https://github.com/EchoTouch-moon/hark/actions/runs/41324943166) 已通过。**追加提交的结果必须单独核验**：[查看 PR 当前 checks](https://github.com/EchoTouch-moon/hark/pull/29/checks)。本次局部与全量本地测试命令、退出码及环境记录在 `handoff/EVIDENCE/d01-followup-2026-11-02/`；Linux Mock E2E 以 GitHub Linux job 的实际结果为准。

旧文档声称本分支“未推送”“等待 rebase”，以及旧版将查询和全部 Demo 路由视为默认 403 的说法，只反映更早版本，不再是当前结论。历史原文可在 Git 提交 `ecc0d5b` 中查阅。现有测试和 CI 不覆盖真实用户数据、真实 Provider，也不授予合并许可或升级完整 G1-A Gate。
