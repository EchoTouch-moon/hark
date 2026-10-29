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

## 2026-10-29 · P2-A Live Verification

工程闭环 PASS；建议有用性待人审。真实 Pi `stepfun-plan/step-5-preview` 经页面点击生成建议卡；Git HEAD/index/status 与 611 个文件指纹不变（不覆盖 ignored 文件）。306 tests、typecheck、改动文件 eslint、web build 通过。证据：`docs/verification/hearth-p2a-live-verification.md`、`handoff/EVIDENCE/p2a-live-*`。此前总表为历史快照，不代表当前最新范围。

## 2026-10-29 · GitHub 同步准备

已创建私有仓库 EchoTouch-moon/hark 并配置 origin；源码/测试/验收文档快照纳入同步提交，未跟踪截图保留本地。全仓 306 tests/typecheck 复用本次 P2-A 验证（同一源码工作区），本次新增验证完整 web+server build exit 0，证据 handoff/EVIDENCE/github-sync-build.txt。提交内容密钥特征扫描无命中；历史唯一特征命中是 assemble.test.ts 的合成测试字符串。远端是否最新以 git rev-parse HEAD 与 git ls-remote origin refs/heads/master 对比为准。多端使用说明见 README-dev.md。

## 2026-10-29 · R0 PASS

审计H02/03/04/05/06/07/09/10修复与故障注入通过；40文件338测试、全仓typecheck、改动文件lint通过。证据 docs/verification/remediation-r0.md 与 handoff/EVIDENCE/r0-*。开始R1前已完成该门禁；尚未验收R1/R2。
