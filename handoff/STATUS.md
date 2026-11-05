# Hark R1 当前状态

本文件为 R1 新状态；旧结论可在 Git 历史查阅，不继承为 R1 PASS。

| 项目 | 状态 | 证据/下一步 |
|---|---|---|
| F0 工程基线 | implemented | 用户批准；AGENTS、README、docs/r1/IMPLEMENTATION-PLAN.md |
| F1 Core/Reader/SQLite | verified-local | `crates/hark-core` 与 `contracts/ipc-v1.md`；本机 cargo test 22 项与 cargo check 通过。不是产品 PASS |
| F2 嵌入式 Pi Host | pending | 等主会话放行 F1 后开始；无远程模型授权 |
| F3 Tauri 集成底座 | pending | F1+F2 之后；正式 UI 后续 agent 负责 |
| R1-A/B/C/D 产品闭环 | pending | 见实施计划 DAG，未交付完整 R1 |
| 真实项目/StepFun/搜索/用户验收 | unverified | 需要单独授权/凭据/真实交互 |
| macOS 安装包 / Windows 实机 | unverified | 不以本机静态检查替代。Windows 安全读源码 fail-closed，未在 Windows 编译 |

PRD 六项微型验收包：

| ID | 状态 | 说明 |
|---|---|---|
| CTX-01 | pending | 未进入本切片 |
| MEM-11 | pending | 未建记忆表，未实现提议 Tool |
| SEARCH-01 | pending | 未建 FTS |
| WS-OVERLAP-01 | not-pass | 重叠显式拒绝；父子排除未实现，不称 AT-05 通过 |
| ONBOARD-01 | verified-local-partial | 两种首消息幂等与成功收据折叠已在 Core 测试；无 UI、无真实模型 |
| READER-01 | pending | 网页 Reader 未做。本地文件负例见 EVIDENCE/r1/f1-core-limits.md |
