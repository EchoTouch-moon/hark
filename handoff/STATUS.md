# Task Status — Hearth 夜间自动开发

> 由 Coding Agent 维护；每项附真实证据路径。所有命令输出见 `handoff/EVIDENCE/`。

## 最终状态（2026-10-28 夜间运行）

- **M0 GREEN**（contracts/policy/storage/fixtures 全绿）
- **M1 GREEN**（完整可运行可演示闭环 + UI + E2E）
- **M2 GREEN**（评分/抑制/预算/Hermes 探测；precision@3 在 50 条集上 NOT_MEASURED，诚实标注）
- M3/M4 NOT_STARTED（按计划不在夜间范围）

## 命令 exit codes（最终验证）

| 命令 | 结果 |
|---|---|
| `pnpm test` | exit 0 — 12 files / **131 tests** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0（vite web + esbuild server bundle） |
| `pnpm test:e2e` | exit 0 — **11 passed / 0 failed**（Playwright chromium-1248） |

## 任务表

| Task | 状态 | evidence | 说明 |
|---|---|---|---|
| M0-T01..T05 | DONE | m0-t0*.txt | workspace/contracts/policy/storage/fixtures |
| M0-GATE | DONE | m0-gate.txt | 78 tests green |
| M1-T01..T04 | DONE | m1-t0*.txt | server+auth / discovery / orchestration / UI shell |
| M1-T05..T08 | DONE | m1-t05-t08-ui.txt | Home/Chat/Projects/Activity/Settings（2 子agent + 主agent） |
| M1-T09 | DONE | m1-t09-e2e.txt | 131 tests + 11 e2e + 5 截图 + demo-run.json |
| M1-GATE | DONE | m1-gate.txt | GREEN，安全负例无回归 |
| M2-T01..T03 | DONE | m2-gate.txt / hermes-probe.txt | scoring/suppression/hermes probe |
| M2-GATE | DONE | m2-gate.txt | GREEN；precision@3 NOT_MEASURED（50 条标注集未建，不虚构） |
| M3/M4 | NOT_STARTED | — | 按计划 |

## 阶段快照

- M0 完成：commit 0821d21（78 tests）
- M1 API+core：commit 3cc6d99
- M2 core 并行推进：29b8307 / 4db20d7 / 0149b1b
- M1 UI 集成+E2E 全绿：commit 145213c

## 最后一项实际完成任务
M2-GATE（全部 20 个 overnight 任务完成）。

## 下一项待办（明早人审后）
见 MORNING-REPORT.md「下一步建议」。

## 关键证据
- `handoff/EVIDENCE/m1-gate.txt`、`m2-gate.txt`、`m1-t09-e2e.txt`
- 截图：`ui-home.png` `ui-chat.png` `ui-projects.png` `ui-activity.png` `ui-settings.png`
- 真实闭环 trace：`demo-run.json`；审计快照：`morning-audit-snapshot.json`
