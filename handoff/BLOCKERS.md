# Hark R1 阻塞与验证条件

## 主页极简整理
- UI类型、29测试、build及Chrome合成页面检查通过，无当前实现阻塞；Native WebView实际效果待用户查看，不拿合成IPC页面当Core/模型验收。
- 本段不需重启后台或读取Key，不增加真实模型请求。未配置外部架构画布目标，不扫描个人笔记、不阻塞界面整理。

## 认知接线进度与Grok容量（当前）
- 认知Core v4与Native/UI读/反馈/撤销/检索已合入。主线6da36be，Native20/UI27与构建通过，用户确认新窗口可见；不再把FTS或这些读接口标成未实现。
- Grok run07e5404c连接中断；重试e3540a70明确返回模型容量不足。隔离worktree当时HEAD d0c148c、clean，无partial改动。用户明确批准主会话直接完成该段，未换CLI/关闭保护或购买优先服务；ee9ddc4→主线6da36be为实际实现证据。
- Pi三个认知工具已在376d75e接入普通对话并按用户批准部署；Core69/Native21/Host16+2/UI29回归通过。用户新Key下的实际调用/遗漏率与认知体验仍未验收，opening写入及自动L0/L1未做。联网研究/Observer/父子排除/安装包继续未实现。

## Grok 403 历史阻塞与恢复尝试

- 2026-11-06 用户要求继续后，原 subagent 协议已实际完成两个 Grok 4.7 high child：Host `40dae61` 修复与 Native 只读审查。当前不再由 403 阻塞；历史失败记录保留。主会话已复跑 Host TS/SDK smoke/13 项测试/probe 并定向放行其进入集成；见 `f2-parent-review.md`。
- Native 同 root/workspace 重叠取消 P1 已由 `8ca7617` 合入。首次开场 Rust↔Host stdio 已接通，证据 `f4-core-host-bridge.md`。这不是常规对话 run，也不是 StepFun。

- Workflow `d0946ef4-5bfd-4006-a0ba-4ff32b932de6` 的两个 Grok 4.7 high 审查均失败：`xai API error (403): You have run out of credits or need a Grok subscription`。Host reviewer `cfd78851-678e-4a88-9b14-5eb456d67901`；Native reviewer `e11922e9-815b-4d63-bcda-11d1066a362c`。外层 workflow complete 不代表审查通过，两个结果 `ok=false`。
- 失败后已核验三个 worktree 均 clean：主线 `2dc8570`，Host `dev/r1-host-runtime` / `2b9ac8c`，Native `dev/r1-native-shell` / `ca0efb3`。无审查写入的 partial diff，未合并候选，未推远端，未切换模型或 CLI/前台协议。
- 主会话已实际复跑：Native 服务 7 项 + cargo check；Host strict TS、SDK smoke 1 项、Host/IPC 8 项与 stdio probe，均通过。它们不等于代码审查、真实 StepFun、Rust↔Host 接通、窗口交互或安装验收。
- 父会话当时的 Host 源码发现（跨 Workspace gate、旧快照回贴、EOF 空转、新 Session 衔接、stepfun 名字硬拒）已由 `40dae61` 修复并合入。`f2-f3-review-blocked.md` 保留当时状态，不是当前未修清单。未完成 reviewer 的过程文字仍不是最终裁决。
- 恢复条件：用户恢复当前 xAI 路由额度/订阅后，通过原 subagent 协议继续 Grok 4.7 high，或由用户明确指定替代模型/范围。不要无修改循环重试，不擅自消耗其他 Provider。

## F1 本机五项已串行合入，仍未产品放行

- Core 库与 IPC v1 合同已有本机 `cargo test` / `cargo check` 证据。早期 22 项记录见 `handoff/EVIDENCE/r1/f1-core-limits.md`。联合回归见 `handoff/EVIDENCE/r1/f1-core-integrated.md`。
- 主会话第一轮审查不放行的原文保留，不覆盖：`handoff/EVIDENCE/r1/f1-parent-review.md`。该文件记录的是审查当时的缺口，不是当前代码仍全部未修。
- Workflow `2742fe5d-687b-487c-a216-906d501096b6` 的 child `9a5b3d9c-5c22-463a-a925-a8780488b83b` 在 2400000ms 总时限后失败。失败后核验当时 HEAD 仍为 `9c79f81`，没有返工 diff。未消费的 follow-up 不能作为落实证据。
- #2 FIFO/特殊对象、#4 枚举预算：resolved-local。证据 `handoff/EVIDENCE/r1/f1-reader-fifo-budget.md`。当前 Core 保留这些测试。
- #1 物理别名重叠、#5 Workspace fd 绑定：resolved-local。证据 `handoff/EVIDENCE/r1/f1-scope-repair.md`。
- #5 检查成功后到 open/read 的准入窗口：resolved-local。证据 `handoff/EVIDENCE/r1/f1-revocation-admission.md`。读侧仍用 `IoGate` + `admit_active_io` / `with_immediate_tx`。
- #3 取消后开场收据：resolved-local。隔离提交 `c69ade2` 已 cherry-pick 进当前 Core，不带回该分支过期 Reader。证据 `handoff/EVIDENCE/r1/f1-opening-receipt.md` 与联合场景 `f1-core-integrated.md`。
- 主会话已在集成提交 `0771ebe` 检查合并范围，并复跑 fmt/check/46 项测试通过；五项当前本机修复放行，允许后续底座开发。不是 F1 产品通过，跨平台/真实产品验收仍需后续证据。
- 早期 workflow 未能启动 child 的记录保留在 Git 历史；与本次已运行 child 的超时区分。

## F3 Native shell 未验证项

- 窗口点击、托盘菜单、隐藏与完全退出没有人工驱动或截图。debug 进程只证明启动后 3 秒未自行退出，随后被测试进程 SIGTERM。恢复条件是人工运行 `cargo run -p hark-desktop` 并操作窗口。同 key 重叠取消的 Rust 测试不是这次点击验收。
- 安装包、签名、Windows 编译与 Windows Job Object 未跑。无 Job Object 时 Sidecar 默认关闭，不能把 EOF 写成 Windows 进程树安全。
- 真实模型、搜索、凭据 Store 仍关闭。已接通的是合成 transport 的首次开场 stdio，不是 StepFun。
- `cargo check` / `cargo build` 不是桌面交互验收。

## 仍阻塞或未验证

- AT-05 / 父子排除未实现。物理重叠拒绝不是排除流程。WS-OVERLAP-01 不得标通过。恢复条件仍是单独设计并测试排除、回滚和链接/别名。
- Windows 安全读未实现，源码 fail-closed。本机未安装/未编译 Windows target。恢复条件是 Windows 上的真实编译和目录负例。
- 私人项目读取与真实搜索仍未授权。用户另行批准一次有界 StepFun 验收：国内 `https://api.stepfun.com/v1/chat/completions`、仅 `step-3.7-flash`、最多3次请求、每次输出≤512tokens、仅纯合成材料、Key仅用户亲启独立进程临时env。真实调用已结束：通用API共2次HTTP402；用户提供正确套餐 `/step_plan/v1/messages` 后，最后1次实际HTTP200/回复OK（见stepfun-plan-direct-check.json）。旧402/续测记录是历史，不再认定为当前套餐计费阻塞。续测脚本任务已按用户要求停止，无partial diff；不再维护或扩建该验收脚本。原3次预算用完，Key已由用户撤销，不得再使用或发请求。接下来离线把正确anthropic-messages协议接入现有Pi Host；流式、工具与桌面真实闭环仍待后续实际授权验证。
- UI 与整 R1 未通过。
- 首次开场的 authorization 由 Rust 从当前 Core 构造。Host 仍不写 SQLite。普通聊天已通过scripted transport接线；当前阻塞真实体验的是模型配置与workspace启用，不是run存储/管道未实现。
- StepFun套餐endpoint基础文本已真实验证；PiSDK流式、工具调用与应用内配置仍unverified。显式 `providerId: stepfun` 不再被型号字符串拒绝，但没有启用配置、凭据和 `allowRemote` 时仍然关闭。`faux` 仍拒绝，不是 fallback。本轮只用合成 Key 和拦截 transport 看 OpenAI-completions 形状，没有联网。真实协议未臆造。
- Pi 1.5.0 `ModelRuntime.create` 没有 `authContext`。生产收口是：刷新前给 `google-vertex` 注册字面 closed key，并在加载 SDK 前只拒绝已知凭据路径。这不是全量 fs monkeypatch，也不证明所有未来 SDK 探测都已关闭。
- Rust stdout→worker ingress cap 现为合同控制队列 64，由生产 `read_stdout` 加真实 Node 子进程 flood 证明；满载关闭 run/管道，stop/cancel 不走这条满队列。没有把活动 Pi run 灌满 64 帧，不能据此称整份 IPC 合同已由实机会话灌满。Node SideQueues 单测仍在。Host stdio probe 仍会关 stdin 并暂停 stdout。没有把 OS pipe 堵到内核容量。
- 自动 compaction 关闭。遇到无法证明不含旧事实的 compaction/branch summary 时，Host 新建官方 Session，不把旧摘要当当前来源。
- sessionRef 存在 onboarding evidence_json，不是新授权表。Unix 进程组已有本机证据。Windows Job Object 仍未实现。
- 开场提交仍是延迟事务。与撤权写者重叠时可能返回 SQLite busy，而不是 `root_revoked`；busy 时不提交新开场。撤权已经返回之后，读侧与开场侧都拒绝。
- 已经进入内核且不返回的单次 `read`/`openat` 不能被打断。另一连接最多等到现有 `busy_timeout`（5 s）；超时是 SQLite busy，不是撤权成功。
- Pi JSONL/SessionRef已有本机首次开场与恢复证据；不能代替真实模型的compaction/历史回忆产品验收。网页 Reader、FTS、记忆修订仍未进入本切片。
- macOS security-scoped bookmark、安装包签名、托盘/窗口点击仍待后续；Unix退出回收已有本地管道与进程组探针证据，不等于完整桌面quit交互验收。
- Bun/Node 分发选择：保留 PRD O-01 未决状态。
- 旧架构画布目标配置未迁入新 worktree。本轮只维护仓库内架构状态。
