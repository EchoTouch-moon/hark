# Hark R1 执行交接

## 2026-11-11 · 连接失败截图跟进

生产通道仍未接通，新增明确的不可用状态、草稿保留和发送禁用；新增项目不再承诺当前不可用的 AI 初读。UI 38/38、Native 22/22 和合成浏览器验证通过，桌面源码已构建。未使用真实 Key、项目资料或外部模型；当前程序不能真实对话。详见 `EVIDENCE/r1/closed-transport-2026-11-11.txt`。

## 2026-11-11 · 发送及密钥验证

修复部分合法 Key 被拒、失败状态导致界面异常和发送状态无法恢复；请求编号可用于定位持久运行，模拟浏览器覆盖失败、重复发送、核对与切换项目。Native 22/22、UI 37/37、Host 16+2 和 Pi smoke 1 通过。真实模型连接及外发审阅仍未接通，真实钥匙串未实测；见 `EVIDENCE/r1/send-key-regression-2026-11-11.txt`。

## 2026-11-10 · 用户反馈：主动认识项目

已为首次开场补充 README 优先和目的驱动阅读指令，本地选读优先 README；Core 33/33、Native bridge_probe 7/7 与桌面构建通过。未实现已有项目授权后的主动触发、真实外发内容审阅或联网研究，因此不是完整产品闭环；证据 `EVIDENCE/r1/readme-first-2026-11-10.txt`。

## 2026-11-10 · 产品界面与持久化

菜单、项目资料及设置已去除面向开发的显示文字；macOS 实现系统钥匙串保存 AI 配置。Native 22/22、UI 32/32、类型、构建和合成浏览器验证通过；未使用真实钥匙串或密钥。现有 Native 进程未重启，桌面 Hark.app 仍是开发启动器。证据 `EVIDENCE/r1/product-settings-2026-11-10.txt`。

## 2026-11-10 · 配置与菜单反馈

首次引导提供会话 Key 输入，目录授权按钮已接入现有 Native 能力，菜单焦点问题已修复；31 项 UI 测试、类型检查、构建与合成浏览器检查通过。真实 Native/模型验收未做；自动初读缺少 Real-First 要求的实际外发内容审阅，见 BLOCKERS。证据 `EVIDENCE/r1/setup-menu-feedback-2026-11-10.txt`。

## 最新：桌面Hark启动入口
- 按用户选择创建开发启动器Hark.app，炉心图标；双击准备本地页面并启动Native，重复打开复用已有进程。
- 已运行6项单测、Native build、签名校验；通过桌面入口实际启动，再次运行PID保持97055、AppKit激活成功，Vite200。此前旧PID已不存在，没有停止或重启一个在用进程。
- 启动器需要原仓库；退出后新启动Key仍是会话制，隐藏窗口可用托盘显示。不是独立安装包或完整R1验收。见EVIDENCE/r1/desktop-launcher.md。

## 最新：App Icon 三款提案
- `design/app-icon-concepts/index.html` 为独立预览，`preview.png` 为实际浏览器截图；三款SVG/1024透明PNG含大图、小尺寸及深色背景对照。
- 用户随后选定01；已生成正式PNG/ICNS/ICO/单色托盘并接入配置，资源解析与macOS cargo check/fmt通过。未重启后台，没有模型请求；实际Dock/托盘待用户批准下次启动后确认，仍未启用打包。

## 最新：主页极简整理
- 顶栏仅项目切换和⋯；项目概览、历史、设置、添加/隐藏/退出集中进菜单，扫描/收据/依据/观点默认折叠，输入区缩为对话与发送。
- 类型、29 UI测试、Vite构建通过；Chrome合成页面已验证菜单入口、概览关闭/焦点返回、390px无横向溢出及深浅主题。截图与JSON见 `EVIDENCE/r1/home-minimal.md`，不是Native/真实模型验收。
- 仍使用原双终端开发命令；本轮已由1420 Vite热更新9e0c7bb，Native PID未变；主线再次通过类型/29测试/build，不触碰本次运行Key。

F1 Core 仍未产品放行。父会话审查原文仍在 `f1-parent-review.md`。

## 本段

- 分支 `dev/r1-desktop`，未推送。先合入 Host `2b9ac8c`/`40dae61` 与 Native `ca0efb3`/`8ca7617`，再提交首次开场 stdio。
- 文档冲突按段落保留 F1 与两边修复，没有整文件覆盖 parent-review 或 AGENTS。
- Unix 上真实 Node + Pi SDK 1.5.0 + Core stdio 已跑通首次开场：合成目录 README 字节、Core 收据、sessionBinding 重启、取消/撤权/超时/跨 run、进程组清理。transport 是 scripted，不是 StepFun。
- 未配置时不启动 Sidecar。Windows Job Object 未实现，Sidecar 默认关闭。常规对话 run、Memory、搜索、安装包、窗口点击未做。

## Bridge 生命周期收口

- 取消后重试不再被旧 sessionBinding 挡住。同 run 仍不能任意换 session。compaction 有显式 Core 路径，不扩 chat。
- EOF/kill/关 stdin 后 `sidecar_status` 与 snapshot 为 `connected=false`，不依赖手动 stop 刷新。
- Rust frame ingress cap=64，真实 Node flood 证明，不是只新建队列类。停滞 worker 的 stop 有界，超时不报 `exited=true`。
- 不是整 R1，不是窗口交互，不是 StepFun。证据 `handoff/EVIDENCE/r1/f4-bridge-lifecycle-fix.md`。

## 主会话最终本机复核与下一步
- `9f9bb01`：Core48、Native16项已由主会话复跑通过，独立Session重试probe由失败变成功，接受首次开场本机底座。
- StepFun脚本来源 `882a723` + `9e5fd43` 已串行合入；主会话复跑bash语法、strict TS、离线安全18、Host14、SDKsmoke1通过。没有真实Key/StepFun请求。
- 后续真实调用已结束：通用API2次402，正确套餐 `/step_plan/v1/messages` 最后1次HTTP200/OK（输入21/输出130tokens），见stepfun-plan-direct-check.json。原3次预算用完，Key已由用户撤销。
- 这仅是正确套餐协议的直接HTTP文本成功，不是PiSDK流式/Tool/Rust闭环通过。用户叫停了续测脚本扩建；当前主线clean，继续复用PiSDK接套餐messages协议，再补连续对话。
- 普通对话Core已合入8197ec0，主会话复跑55测试。用户React前端已合入3c6289a，主会话复跑21UI测试、UI构建/类型、Host类型与Tauri check通过。前端原目录保持不动，Native真实适配默认启用。
- Native普通聊天发送/流式/状态/取消已合入3b9dee7，UI时序收口d74ba9f。主会话复跑Core56、Native17、UI23、UIbuild/类型和桌面build通过。transport仍scripted，不是应用真实模型通过。
- 已按用户要求启动Vite（HTTP200）与开发Tauri进程，并激活桌面到前台；启动证据见desktop-startup.md。未做窗口控件点击/截图。随后模型配置已合入a8deffb，主会话复跑Host14+2/UI24/Native18/SDKsmoke与构建后再次重启并激活窗口。应用设置可存本次运行Key、工作空间可独立启用；配置不自动发请求，未提供真实Key所以尚无应用真实模型验收。
- Core v4记忆/观点修订/FTS已合入，69项通过；认知Native/UI读/反馈/撤销/检索已合入6da36be，Native20/UI27与构建通过。用户选择现在部署，已重启并确认窗口可见；这不是控件点击验收。
- Pi记忆/观点提议与recall已接并部署376d75e，普通对话可返回Core真实收据，UI重启能重载；Core69/Native21/Host16+2/UI29通过。用户批准更新后新窗口已正常重启/前置，尚无真实模型效果验收，opening写入与自动L0/L1未支持。
- 联网搜索/Observer、双平台安装与完整用户价值验收仍未交付。开发启动须先Vite再另终端cargo，详见README。
