# Hark R1 当前状态

本文件为 R1 新状态；旧结论可在 Git 历史查阅，不继承为 R1 PASS。父会话审查原文保留在 `handoff/EVIDENCE/r1/f1-parent-review.md`，本文件不覆盖它。

| 项目 | 状态 | 证据/下一步 |
|---|---|---|
| F0 工程基线 | implemented | 用户批准；AGENTS、README、docs/r1/IMPLEMENTATION-PLAN.md |
| F1 Core/Reader/SQLite | verified-local | 审查五项已在当前 Core 串行合入并有本机联合测试。#2/#4 resolved-local，见 `f1-reader-fifo-budget.md`。#1 与 #5 fd/物理范围 resolved-local，见 `f1-scope-repair.md`。#5 检查到 open/read 的短事务准入 resolved-local，见 `f1-revocation-admission.md`。#3 开场 run 绑定 resolved-local，见 `f1-opening-receipt.md` 与 `f1-core-integrated.md`。父会话已在 `0771ebe` 复跑 fmt/check/46 项测试通过，放行 F1 本机底座继续开发；不是产品 PASS |
| F2 嵌入式 Pi Host | verified-local | 已合入 `2b9ac8c` 与 `40dae61`。本段复跑 strict TS、SDK smoke、Host 14 项（含 opening 可空 userMessageId）与 stdio probe 通过。不是 StepFun，不是产品通过。见 `f2-parent-review.md` |
| F3 Native shell + opening stdio | verified-local | 已合入 `ca0efb3` 与 `8ca7617`，并接通 Unix 进程组管理的 Node+Pi SDK stdio。窗口点击、托盘、安装包、Windows Job Object、真实模型未验。见 `f3-parent-review.md` 与 `f4-core-host-bridge.md` |
| Bridge 重试/状态/队列/stop | verified-local-accepted | 主会话已在 `9f9bb01` 检查diff并复跑Core48与Native16项，全通过；独立Session重绑probe从失败变成功，接受首次开场本机底座。真实模型/整R1未通过。见 `f4-parent-review.md` |
| R1-A/B/C/D 产品闭环 | blocked | 整 R1 未通过。见实施计划 DAG |
| StepFun 套餐接口基础文本 | verified-live-synthetic | 正确套餐 `/step_plan/v1/messages`、step-3.7-flash，实际HTTP200/回复OK，输入21输出130tokens。原3次请求已用完、用户已撤销Key。直接HTTP，不是PiSDK/流式/工具/桌面闭环；见stepfun-plan-direct-check.json。先前通用API402不能据此判定套餐不可用 |
| 普通连续对话 Core/Native/UI | verified-local | 已合入3b9dee7+d74ba9f：普通聊天三个Native入口、per-turn Channel、Core提交后完成事件、会话引用复用、取消/恢复/幂等。主会话复跑Core56/Native17/UI23及UI类型/build、桌面build通过；transport仍scripted，真实模型未启用 |
| 用户React前端迁入 | verified-local | 已合入3c6289a，原目录不动；主会话复跑UI类型/21测试/build、Host类型与Tauri check通过。默认strict真实适配，已接picker→确认→卡片/对话/来源与隐藏/退出；未跑Native窗口点击，不冒称产品体验通过 |
| 开发窗口启动 | running-local | 已实际启动Vite，127.0.0.1:1420返回200；新构建Tauri进程存活并通过NSRunningApplication激活到前台。不是截图/DOM/控件点击验收；见desktop-startup.md |
| 模型配置与workspace启用 | verified-local | a8deffb已合入：页面本次运行Key、固定StepFun套餐anthropic协议、现有service_grants启用/禁用；保存不fetch、配置不等于已认证。主会话复跑Host14+2/UI24/SDKsmoke1/Native18与build通过，随后重启并激活新桌面；见model-settings.md |
| 记忆/观点/反馈/检索 Core | verified-local | 已合入3dfc540+a4b1e92，v4独立记忆/观点修订、反馈/撤销及FTS5；否定/疑问/条件摘录决定修正。主会话复跑Core69及Native check通过。仍需Native/Host/UI接线，不当R1-B产品通过 |
| 认知后端 Native/Host/UI | in-progress | 正接记忆/观点提议与recall工具、观点读写反馈/撤销、来源与历史检索；替换现有unavailable/空列表，不加新框架或真实模型测试 |
| R1-A 当前下一步 | awaiting-user-model | 入口与管道均已接，用户需在桌面填新Key并为Workspace启用后主动发送，才可验证真实体验。原Key已撤销，本会话未用新Key或发请求；Memory/搜索/Observer等仍未实现 |
| macOS 安装包 / Windows 实机 | unverified | 不以本机静态检查替代。Windows 安全读源码 fail-closed，未在 Windows 编译 |
| AT-05 / 父子排除 | blocked | 重叠拒绝不是排除流程。不得标通过 |

PRD 六项微型验收包：

| ID | 状态 | 说明 |
|---|---|---|
| CTX-01 | verified-local | Host 请求级 pack 与本段 Core 有界概况已在合成快照/合成目录上验证。没有 Memory Engine，pack 标 empty。不能当产品通过 |
| MEM-11 | pending-integration | v4记忆/观点修订与Core提议API已实现，69项Core通过；Host绑定提议Tool与真实UI收据仍在接线，不能标产品通过 |
| SEARCH-01 | verified-core-only | 已实现FTS5 trigram与明确短词LIKE兜底、来源/历史标签；前端/recall尚待接线，未做用户检索验收 |
| WS-OVERLAP-01 | not-pass | 重叠显式拒绝；父子排除未实现，不称 AT-05 通过 |
| ONBOARD-01 | verified-local | Core 拒绝取消/旧 run/错模型/未配置模型/跨 workspace/撤权，并只在绑定 run 的成功收据后折叠。无 UI、无真实模型，不是产品通过 |
| READER-01 | pending | 网页 Reader 未做。本地文件负例见 EVIDENCE/r1/f1-core-limits.md |
