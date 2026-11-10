# Hark R1 架构与交付状态

## 2026-11-10 · AI 配置与用户界面

macOS Native 使用系统钥匙串存放 AI Key，保存/读取失败不降级为明文；Key 和项目授权仍分离。隔离存储测试、Native 及 UI 构建通过；真实系统钥匙串与跨重启产品体验尚未验收。证据 `handoff/EVIDENCE/r1/product-settings-2026-11-10.txt`。

## 2026-11-10 · 首次配置与菜单

首次引导复用 Native 的会话 Key 配置；目录权限按钮接入已有 Native 命令，未新增权限或模型调用。此为 UI 与合成浏览器验证，不代表真实项目闭环通过；实际外发内容审阅与 Real-First 的差距仍待解决。证据 `handoff/EVIDENCE/r1/setup-menu-feedback-2026-11-10.txt`。

本机入口：用户授权的桌面Hark.app已创建，AppleScript→仓库Python标准库启动器→本地Vite/既有Native二进制，已实测启动与复用进程；不是独立产品打包，bundle.active仍false。无Native接口/模型授权变化，仍需本机仓库与Node。证据：`handoff/EVIDENCE/r1/desktop-launcher.md`。

应用视觉资源：三款App Icon提案已输出到 `design/app-icon-concepts/`，用户选定01炉心；PNG32～1024、ICNS/ICO与单色托盘已接入Native配置，macOS cargo check/fmt及资源解析通过。bundle.active仍false，当前进程未重启；实际Dock/托盘、Windows与安装包未验。功能架构、权限与运行进程不变。

主页已完成渐进披露整理：Header仅项目与⋯，初读/记忆折页移入项目概览，扫描/依据/观点/记忆回执默认折叠，Composer保留核心操作。复用原Bridge和原生dialog，无后端/权限/存储变更。UI类型、29测试、构建与Chrome合成页面交互/截图通过，Native WebView实际效果待用户确认。证据：`handoff/EVIDENCE/r1/home-minimal.md`；外部画布目标未配置，未扫描个人笔记。

当前已实现并在本机测试：Rust Core 库，嵌入 Pi SDK 1.5.0 的 TypeScript Host，进程内 Native shell，以及 Unix 上由 Rust 管理的一条首次开场 stdio。v1/v2迁移原文保留；v2给 `onboarding_runs` 增加当前 opening run 与授权快照列；v3为普通聊天扩展事件CHECK并增加稳定seq，仅新建 `conversation_runs`，保存普通run与对应用户/助手消息引用，重启恢复。主线源码现已增加v4：独立记忆/观点修订、反馈、幂等写收据与FTS5投影；聊天和文件来源仍各自为权威。Core69项通过；Native/页面认知读与反馈接口已合入6da36be（Native20/UI27），包括历史检索、观点反馈/撤销与消息来源。用户已选择部署并重启，随后确认窗口可见。Pi记忆/观点提议及按需recall已部署376d75e，普通对话可写Core真实修订并返回收据；UI从持久收据投影而非伪造聊天原文。Core69/Native21/Host16+2/UI29及构建通过，窗口已重启/前置。opening仅recall不写记忆，自动L0/L1投影仍未完成，真实模型效果未验收。sessionRef 写在现有 `evidence_json`，没有新 migration。目录授权可暂停/撤销。确认前初扫有界。Workspace 读取绑定已验证目录 fd。开场必须匹配 Core 发放的 run；调用方 `success` 不是完成。IPC v1 frame 没有 HTTP。

Host 不调用 Pi CLI。stdout 只写 NDJSON。模型可见工具为两个workspace读取工具及 `memory_propose_change` / `opinion_propose_change` / `memory_recall`，无内置bash/通用读写工具；提议写入仅普通对话可用。一个 Host 进程同时只跑一个 run。每次 provider 请求前反向 overview。Rust 用当前 Core 授权构造 `authorization.current`，Core `enabled` 映射 Host `active`。`stream.delta` 只是候选。合法 `stream.done` 后 Rust 用本轮真实读取收据调用 `commit_agent_opening`，成功才折叠本地卡。opening 的 `userMessageId` 缺省，不向 Hark 插入虚假用户消息。Core记忆/观点与按需recall已实现；自动L0/L1仍未投影，Context Pack的empty标志不表示数据库无历史记录。显式 stepfun 槽可以按 OpenAI-completions 形状构造，真实协议未验证。

Native shell 目录选择仍走短时 picker token。未配置 Sidecar 时 `connected=false`，不读 Key，不发请求。已配置的开发 Node 路径只来自 Rust，不接受前端任意命令。macOS 用进程组关闭 stdin、SIGTERM、SIGKILL、`waitpid(WNOHANG)` 和有界 stop。worker 与 `sidecar_status` 读同一份状态。stdout frame ingress 上限 64，过载关闭受影响 run。Windows 没有 Job Object，Sidecar 默认关闭。

用户初版React/Vite/Tailwind前端已迁入 `apps/desktop/ui`（3c6289a），保留炉心外观，默认strict Native；真实目录选择/导入、本地卡/消息/来源、目录暂停撤销和窗口隐藏退出已适配。UI21测试、build、Host类型与Tauri检查通过，但没有Native点击证据。普通聊天已接上三个Native命令和per-turn Channel，Core提交成功后才通知前端完成。主会话复跑Core56/Native17/UI23及桌面build通过，模型仍scripted。开发Vite已HTTP200、Tauri进程已启动并激活；该切片没有Native控件点击或截图证据；本次补充的是合成Chrome页面证据，非Native验收。

页面模型配置与workspace启用已合入a8deffb，固定StepFun套餐anthropic协议并复用Pi驱动；Key仅本次Native/Node运行内存、元数据无Key，授权复用service_grants。配置不自动发请求、不代表已认证。主会话复跑Host14+2/UI24/SDKsmoke1/Native18及前端/桌面build通过，已重启并激活新桌面供用户操作。

当前未完成或未通过：窗口控件点击/托盘人工验收、用户新Key下真实聊天体验、PiSDK真实StepFun、真实模型下的记忆/观点调用与对话认知验收、自动L0/L1投影、联网搜索、Observer、网页Reader、安装包、Windows实机、整R1。父子目录排除（AT-05）未实现。已进入内核的单次 read 不能被本切片打断。合成 scripted transport 不是 StepFun。

主会话已在 `9f9bb01` 定向复核并复跑 Core48、Native16项通过，接受真实本地磁盘/SQLite/Node+PiSDK/stdio 首次开场底座；模型transport仍为合成SSE。StepFun套餐 `/step_plan/v1/messages` 的直接HTTP基础文本已实际200/OK（step-3.7-flash，输入21/输出130tokens）；通用API两次402不代表套餐不可用。原3次许可已耗尽，Key已撤销。Host已在a8deffb复用PiSDK的anthropic-messages接入套餐，保留原OpenAI形状支持；SDK流式/工具与桌面真实闭环尚未通过。不再扩建独立验收/额度脚本，优先产品接线与常规连续对话。

目标（非已实现）：Tauri UI → Rust Core ↔ TS Agent Host → 已授权 StepFun/搜索。Pi JSONL 与 SQLite 业务权威分离。

串行建设见 `docs/r1/IMPLEMENTATION-PLAN.md`。实际状态以 `handoff/STATUS.md` 与 `handoff/EVIDENCE/r1/` 为准。历史 M0/M1 不继承为通过。

本地画布目标在新工作区未配置，本轮不扫描其他个人文件。
