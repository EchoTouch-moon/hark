# Hark R1 当前状态

## 2026-11-11 · 连接不可用状态

- 生产模型发送通道仍未接通；Native 明确报告不可用，界面保留草稿并阻止无效发送，添加项目时不再承诺立即 AI 分析。Key 和本地服务状态不等同于模型连接成功。
- UI 38/38、Native 22/22、构建及合成交互通过。外发批准原型未接入且不能部署；真实对话仍未修复。见 `handoff/EVIDENCE/r1/closed-transport-2026-11-11.txt`。

## 2026-11-11 · Key 与发送卡顿排查

- macOS Keychain 保存保留，修正对合法斜杠的拒绝并强化内存清除；隔离存储覆盖替换、重启恢复与失败保留。未实际操作用户钥匙串。
- 修复流失败码不匹配、终态丢失及重复发送；请求身份可按项目和请求号恢复，未知状态不冒充完成，状态查询不取消。快速切换项目时忽略过期加载结果。
- UI 37/37、Native 22/22、Host 16+2、Pi smoke 1、构建和合成浏览器交互通过。生产 sidecar 缺少真实请求通道，用户指定的实际内容审阅也未接通，因此真实模型聊天仍未完成。详见 `handoff/EVIDENCE/r1/send-key-regression-2026-11-11.txt`。

## 2026-11-10 · README 优先的项目认识

- 首次开场内部任务已要求先看概况、优先 README，再根据项目目的按需选读；明确项目用途、技术、依据、未知与待确认问题，未实际搜索不得声称联网。
- 本地首读在已枚举的关键文件中优先 README，保持读取预算与目录授权；Core 33/33、Native bridge_probe 7/7、桌面构建通过。证据 `handoff/EVIDENCE/r1/readme-first-2026-11-10.txt`。
- 未完成：已有项目后续授予模型权限仍不会触发开场；当前 R1 缺少实际外发内容审阅与批准版本复核，尚不能安全自动外发；联网搜索与技术替代研究未接入。运行窗口未重启。

## 2026-11-10 · 产品文案、菜单与 AI 配置

- macOS 桌面入口实现系统钥匙串保存、恢复与删除；保存不会发送模型请求，删除/更换清除旧 Host 中的凭据。其他平台不写入明文。
- 项目资料、首次引导、应用/项目设置和菜单按用户操作重新整理；本地读取不冒充 AI 分析。
- Native 22/22、UI 32/32、类型检查、构建及合成浏览器检查通过；真实钥匙串与用户窗口未验证。运行中的旧进程需退出重开，新版才能使用系统存储。详见 `handoff/EVIDENCE/r1/product-settings-2026-11-10.txt`。

## 2026-11-10 · 首次配置与菜单反馈

- 首次添加项目可在选目录前后填写本次运行 StepFun Key；成功状态来自 Native，保存不发模型请求。Key 是否配置与 sidecar 连接分开显示。
- 修复菜单焦点暂失后提前关闭；目录暂停/恢复/撤销接入已有 Native 接口并显示错误，不支持的关闭行为设置标为不可用。
- 合成浏览器、31 项 UI 测试、类型检查与构建通过；未验证真实 Native 窗口或真实模型。详见 `handoff/EVIDENCE/r1/setup-menu-feedback-2026-11-10.txt`。
- 完整自动初读仍未作为产品通过：真实项目体验未验，当前 R1 分支缺少 Real-First 所需的实际外发内容审阅。

本文件为 R1 新状态；旧结论可在 Git 历史查阅，不继承为 R1 PASS。父会话审查原文保留在 `handoff/EVIDENCE/r1/f1-parent-review.md`，本文件不覆盖它。

| 项目 | 状态 | 证据/下一步 |
|---|---|---|
| 桌面开发启动入口 | verified-local-launch | 已授权创建桌面Hark.app（炉心图标），本地开发启动器而非独立安装包；6项测试、Native build、签名校验通过，实际通过入口启动Native97055，再次运行复用同PID、AppKit激活成功，Vite200。不发模型请求；见EVIDENCE/r1/desktop-launcher.md。 |
| App Icon 炉心定稿资源 | verified-assets-native-check | 用户选定01炉心；PNG32～1024、ICNS、七档ICO与单色托盘已生成并接入Tauri配置/托盘，保留bundle.active=false；Pillow解析、macOS cargo check/fmt通过。当前窗口未重启，实际Dock/托盘、Windows和安装包未验。见EVIDENCE/r1/icon-concepts.md |
| 主页极简整理 | verified-browser-synthetic | 主线9e0c7bb已由既有Vite热更新，Native进程未重启。顶栏5→2按钮，低频操作进⋯菜单；初读/记忆折页移入项目概览，扫描/依据/观点/收据按需展开；保留错误提示及权限检查。UI类型、29测试、build通过；Chrome合成页面验证菜单、弹窗/Escape/焦点、390px布局与深浅主题，非真实Native或模型验收。见home-minimal.md |
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
| 记忆/观点/反馈/检索 Core | verified-local | 已合入3dfc540+a4b1e92，v4独立记忆/观点修订、反馈/撤销及FTS5；否定/疑问/条件摘录决定修正。主会话复跑Core69及Native check通过。Native/Host/UI后续接线见下两行，不当R1-B产品通过 |
| 认知后端 Native/UI | verified-local | 已合入6da36be：真实观点查询/反馈/撤销、历史检索、原消息证据回读，独立观点真实呈现及待修订状态。Native20/UI27与构建通过；用户选择部署后已重启，并确认能看到窗口。控件功能尚未用户验收 |
| Pi认知工具 | verified-local-scripted | 已部署376d75e：普通对话 memory_propose_change/opinion_propose_change 与按需memory_recall，真实Core收据及重启后UI投影；Core69/Native21/Host16+2/UI29与构建通过。否定摘录待澄清、结束run不再写、取消保留此前已提交记忆均有合成transport回归。窗口已重启/前置，真实模型尚未验收，opening不写记忆 |
| R1-A 当前下一步 | awaiting-user-model | 入口与管道均已接，用户需在桌面填新Key并为Workspace启用后主动发送，才可验证真实体验。原Key已撤销，本会话未用新Key或发请求；普通对话记忆工具已接；自动L0/L1、联网搜索与Observer仍未实现 |
| macOS 安装包 / Windows 实机 | unverified | 不以本机静态检查替代。Windows 安全读源码 fail-closed，未在 Windows 编译 |
| AT-05 / 父子排除 | blocked | 重叠拒绝不是排除流程。不得标通过 |

PRD 六项微型验收包：

| ID | 状态 | 说明 |
|---|---|---|
| CTX-01 | verified-local | Host 请求级 pack 与本段 Core 有界概况已在合成快照/合成目录上验证。尚无自动L0/L1投影，pack标empty不代表没有已存记忆。不能当产品通过 |
| MEM-11 | verified-local-scripted | 普通对话Host/Native可信绑定提议及Core真实收据、UI保存/撤销/重载已接；模型实际调用与漏记/误记表现未验证，opening写入未支持，不能标完整产品通过 |
| SEARCH-01 | verified-local | 已实现FTS5 trigram与明确短词LIKE兜底、来源/历史标签；Native/历史前端/按需recall已接，未做用户检索验收 |
| WS-OVERLAP-01 | not-pass | 重叠显式拒绝；父子排除未实现，不称 AT-05 通过 |
| ONBOARD-01 | verified-local | Core 拒绝取消/旧 run/错模型/未配置模型/跨 workspace/撤权，并只在绑定 run 的成功收据后折叠。已有Native/UI接线；无真实模型或用户操作验收，不是产品通过 |
| READER-01 | pending | 网页 Reader 未做。本地文件负例见 EVIDENCE/r1/f1-core-limits.md |
