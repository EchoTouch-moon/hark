# Hark R1 当前状态

本文件为 R1 新状态；旧结论可在 Git 历史查阅，不继承为 R1 PASS。

| 项目 | 状态 | 证据/下一步 |
|---|---|---|
| F0 工程基线 | implemented | 用户批准；AGENTS、README、docs/r1/IMPLEMENTATION-PLAN.md；新分支保留共同祖先 |
| F1 Core/Reader/SQLite | blocked | 原 workflow 启动前失败；Pi runner 最小兼容修复已局部验证，待 `/reload` 后重新启动；见 EVIDENCE/r1/runtime-repair.md |
| F2 嵌入式 Pi Host | pending | F1 合同后开始；无远程模型授权 |
| F3 Tauri 集成底座 | pending | F1+F2 交接后开始；正式 UI 后续 agent 负责 |
| R1-A/B/C/D 产品闭环 | pending | 见实施计划 DAG，未交付完整 R1 |
| 真实项目/StepFun/搜索/用户验收 | unverified | 需要单独授权/凭据/真实交互 |
| macOS 安装包 / Windows 实机 | unverified | 不以本机静态检查替代 |

PRD 六项微型验收包：CTX-01、MEM-11、SEARCH-01、WS-OVERLAP-01、ONBOARD-01、READER-01 当前均 pending，随切片更新实际覆盖。
