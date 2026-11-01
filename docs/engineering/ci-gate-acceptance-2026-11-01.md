# CI 门禁验收记录：合并后的双线验证（2026-11-01）

> 本文件同时承担两个作用：记录 G1 合并后的验收结果，并作为**纯文档 PR** 验证
> `detect-changes` 会判定为 `docs-only`、重型作业跳过、`ci-gate` 直接变绿。

## 1. 合并结果

| PR | base | 方式 | merge commit |
| --- | --- | --- | --- |
| [#20](https://github.com/EchoTouch-moon/hark/pull/20) | `master` | merge | `78ebfa87d53fee5ce99427898a1ff3a5ca254032` |
| [#21](https://github.com/EchoTouch-moon/hark/pull/21) | `bot/hearth-g0-contract` | merge | `b2b70c2720ead37230d8f2be0426737e38255afa` |

## 2. 合并后的 push 触发 CI

| 线 | HEAD | run | event | 结论 |
| --- | --- | --- | --- | --- |
| `master` | `78ebfa87` | [#62](https://github.com/EchoTouch-moon/hark/actions/runs/41299786155) | push | **success** |
| `bot/hearth-g0-contract` | `b2b70c27` | [#63](https://github.com/EchoTouch-moon/hark/actions/runs/41300110831) | push | **success** |

明细：

| run | detect changes | Linux | Windows | `ci-gate` |
| --- | --- | --- | --- | --- |
| #62（master） | success 19s | success 1m38s | success 1m55s | success 13s |
| #63（G0） | success 24s | success 3m03s | success 2m42s | success 21s |

## 3. 本次真正解决的历史问题

改造前，G0 的 HEAD `4fd0480b` 的 check-runs 为 **0 个**——G0 的 merge commit 从未被独立验证过，
PR 上的 green 与合并后的真实状态是两回事。

改造后，`b2b70c27`（#21 的 merge commit）立刻产生了**该分支历史上第一个 push 触发的 CI 运行**（#63），
四个作业全部 success。也就是说：G0 从「PR green 但 HEAD 无人验证」变成了「merge commit 有独立检查」。

## 4. 待补：文档快速通道的验证结论

本 PR 是纯文档改动，用于验证：

- `detect-changes` → `mode=docs-only`、`reason=all-documents`
- `verify-linux` / `verify-windows` → **skipped**
- `ci-gate` → **success**（快速绿，而不是永久 Pending）

结论记录于本报告最终版。
