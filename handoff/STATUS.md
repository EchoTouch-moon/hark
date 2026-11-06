# Hark R1 当前状态

本文件为 R1 新状态；旧结论可在 Git 历史查阅，不继承为 R1 PASS。父会话审查原文保留在 `handoff/EVIDENCE/r1/f1-parent-review.md`，本文件不覆盖它。

| 项目 | 状态 | 证据/下一步 |
|---|---|---|
| F0 工程基线 | implemented | 用户批准；AGENTS、README、docs/r1/IMPLEMENTATION-PLAN.md |
| F1 Core/Reader/SQLite | verified-local | 审查五项已在当前 Core 串行合入并有本机联合测试。#2/#4 resolved-local，见 `f1-reader-fifo-budget.md`。#1 与 #5 fd/物理范围 resolved-local，见 `f1-scope-repair.md`。#5 检查到 open/read 的短事务准入 resolved-local，见 `f1-revocation-admission.md`。#3 开场 run 绑定 resolved-local，见 `f1-opening-receipt.md` 与 `f1-core-integrated.md`。父会话已在 `0771ebe` 复跑 fmt/check/46 项测试通过，放行 F1 本机底座继续开发；不是产品 PASS |
| F2 嵌入式 Pi Host | verified-local-candidate | 已串行合入 `2b9ac8c` 与 `40dae61`。主会话已复跑 TS/SDK smoke/13 项 Host IPC/probe 并放行进入集成。不是 Rust 桥接，不是 StepFun 真机，不是产品通过。见 `f2-parent-review.md`、`f2-host-runtime.md`、`f2-host-seam-fix.md` |
| F3 Native shell | verified-local-candidate | 已串行合入 `ca0efb3` 与 `8ca7617`。主会话已复跑 fmt/check/9 项服务测试并放行进入串行集成，见 `f3-parent-review.md` 与 `f3-native-shell.md`。窗口点击、托盘、安装包、签名、Windows、Sidecar 未验 |
| R1-A/B/C/D 产品闭环 | blocked | 整 R1 未通过。见实施计划 DAG |
| 真实项目/StepFun/搜索/用户验收 | unverified | 合成收据不是真实 StepFun。需要单独授权/凭据/真实交互 |
| macOS 安装包 / Windows 实机 | unverified | 不以本机静态检查替代。Windows 安全读源码 fail-closed，未在 Windows 编译 |
| AT-05 / 父子排除 | blocked | 重叠拒绝不是排除流程。不得标通过 |

PRD 六项微型验收包：

| ID | 状态 | 说明 |
|---|---|---|
| CTX-01 | verified-local | Host 请求级 pack、10 轮、快照变化、无法过滤的 compaction 新 Session、原 Session 恢复与按目标 Session 去重的 handoff 已在合成快照上验证。版本变化但缺新正文时不发送旧 canary。没有 Memory Engine，不能当产品通过 |
| MEM-11 | pending | 未建记忆表，未实现提议 Tool |
| SEARCH-01 | pending | 未建 FTS |
| WS-OVERLAP-01 | not-pass | 重叠显式拒绝；父子排除未实现，不称 AT-05 通过 |
| ONBOARD-01 | verified-local | Core 拒绝取消/旧 run/错模型/未配置模型/跨 workspace/撤权，并只在绑定 run 的成功收据后折叠。无 UI、无真实模型，不是产品通过 |
| READER-01 | pending | 网页 Reader 未做。本地文件负例见 EVIDENCE/r1/f1-core-limits.md |
