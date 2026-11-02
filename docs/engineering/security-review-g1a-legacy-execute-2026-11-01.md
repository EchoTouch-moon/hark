# D-01 安全审查：legacy 执行路径 fail-closed

[PR #29](https://github.com/EchoTouch-moon/hark/pull/29) 已推送至 `ops/security-g1a-legacy-execute-disabled`，并已基于 G0 集成线 `b2b70c2` rebase；本 PR 尚未合并。独立复核对 `daf03e14` 给出 **CONDITIONAL_PASS**，要求补齐首次 Demo 启动、混合数据 reset 安全及本审查文档。这个结论不是完整 G1-A 安全认证，最终结果以新提交的检查和人工复审为准。

## 当前安全边界

- 正常查询（cards、projects、events）和本地反馈（dismiss、snooze、discover）可用；它们本身不调用执行器。
- 旧线程 action、卡片 execute 和 approval 入口保持 **403 `LEGACY_ACTIONS_DISABLED`**；生产装配不启用 legacy executor。已有任务的取消和不确定性恢复不应被一并封死。
- 旧线程 proactive 对存在的线程保持只读 `{suggestion: null}`；不凭客户端声称的 Demo 标记制造完成记录。
- `HEARTH_DEMO` 仅精确等于 `1` 时启用 Demo，首次合成数据初始化不依赖 legacy 执行器是否开启。Demo reset 遇到无法可靠区分的数据即拒绝，且不删除审计记录；由于现有记录缺少可信的来源标识，已播种的纯 Demo 库也会被拒绝，只有待清理表为空时才返回成功且不删除数据。

## 检查状态与风险

对旧 head `daf03e14` 的 GitHub Actions [run 41324943166](https://github.com/EchoTouch-moon/hark/actions/runs/41324943166) 已通过 Linux 全量检查和 Mock 浏览器测试、Windows 检查以及 `ci-gate`。本次追加提交的最新运行和结论以 [PR checks](https://github.com/EchoTouch-moon/hark/pull/29/checks) 为准；旧 head 的绿灯不代表新提交自动通过。实际本地检查输出见 `handoff/EVIDENCE/d01-followup-2026-11-02/`，环境与结果以日志为准。

此变更不证明真实项目隔离、真实模型或主动研究通过；reset 的安全性取决于可证明的归属，不能将来源不明数据视为 Demo。回滚会恢复旧执行或宽松模式的风险，必须重新审查。合并前仍需独立安全复审；不因此改变 G2 Ruleset。

## 历史材料

早期版本记录过“未推送”“尚需 rebase”和“查询/Demo 面全部 403”；这些只是当时状态，已被 PR #29 当前实现和本次修订取代，不构成当前安全认证。旧材料可通过 Git 提交 `81bc17d` 查看，初始测试回执保留于 `handoff/EVIDENCE/g1a-security-preparation.txt`。
