# Task Status — Hearth 夜间自动开发

> 由 Coding Agent 维护；每项附真实证据路径。`pnpm test` 输出等见 `handoff/EVIDENCE/`。

## 阶段快照

### M0 完成快照（2026-10-28 UTC）
- HEAD: a6cee0f（+ 本次 STATUS 更新 commit）
- 完成率: M0-T01..T05 + M0-GATE 全部 DONE（6/6）
- 原始 exit codes: `pnpm typecheck`=0, `pnpm test`=0 (5 files / 78 tests), `pnpm lint`=0, `pnpm build`=1（M0 阶段 web/server 尚未实现，属预期；build 为 M1 验收项）
- 下一任务: M1-T01（localhost API server 与认证边界）
- 阻塞: 无

## 任务表

| Task | 状态 | commit | 测试结果 | evidence | blocker |
|---|---|---|---|---|---|
| M0-T01 | DONE | eadc0d7 | typecheck/lint/test exit 0 | handoff/EVIDENCE/m0-t01-bootstrap.txt | — |
| M0-T02 | DONE | 0a158f4 | 32 tests pass | handoff/EVIDENCE/m0-t02-contracts.txt | — |
| M0-T03 | DONE | bce3e7e | 17 tests pass (S02-S08/S10 负例) | handoff/EVIDENCE/m0-t03-policy.txt | — |
| M0-T04 | DONE | a6cee0f | 13 tests pass (migration 幂等/FK/重启) | handoff/EVIDENCE/m0-t04-storage.txt | — |
| M0-T05 | DONE | a6cee0f | 16 tests pass (子agent完成) | handoff/EVIDENCE/m0-t05-fixtures.txt | — |
| M0-GATE | DONE | — | GREEN (78 tests 全过) | handoff/EVIDENCE/m0-gate.txt | — |
| M1-T01..M1-T09 | NOT_STARTED | — | NOT_RUN | — | — |
| M1-GATE | NOT_STARTED | — | NOT_RUN | — | — |
| M2 tasks | NOT_STARTED | — | NOT_RUN | — | — |

## 最后一项实际完成任务
M0-GATE（2026-10-28）。M0 全绿。

## 下一项待办
M1-T01。

## 关键证据
- `handoff/EVIDENCE/m0-gate.txt` — M0 门禁判定
- `handoff/EVIDENCE/m0-t03-policy.txt` — 安全负例（路径逃逸/越权/L2无审批/digest篡改）
