# Hark R1 阻塞与验证条件

## 当前派发阻塞：Grok 额度 / 订阅 403

- Workflow `d0946ef4-5bfd-4006-a0ba-4ff32b932de6` 的两个 Grok 4.7 high 审查均失败：`xai API error (403): You have run out of credits or need a Grok subscription`。Host reviewer `cfd78851-678e-4a88-9b14-5eb456d67901`；Native reviewer `e11922e9-815b-4d63-bcda-11d1066a362c`。外层 workflow complete 不代表审查通过，两个结果 `ok=false`。
- 失败后已核验三个 worktree 均 clean：主线 `2dc8570`，Host `dev/r1-host-runtime` / `2b9ac8c`，Native `dev/r1-native-shell` / `ca0efb3`。无审查写入的 partial diff，未合并候选，未推远端，未切换模型或 CLI/前台协议。
- 主会话已实际复跑：Native 服务 7 项 + cargo check；Host strict TS、SDK smoke 1 项、Host/IPC 8 项与 stdio probe，均通过。它们不等于代码审查、真实 StepFun、Rust↔Host 接通、窗口交互或安装验收。
- 父会话源码发现仍待定向负例/修复：Host providerGate/currentAbort 跨 Workspace 共用；新 sourceVersion 却回退旧快照内容；EOF 后 active/pending/输出队列清理；新 Session 的非 compaction 衔接；代码硬拒绝 `stepfun`，与 PRD 指定模型的接入目标不符。详见 `handoff/EVIDENCE/r1/f2-f3-review-blocked.md`。不得将未完成 reviewer 的过程文字当最终裁决。
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

## 仍阻塞或未验证

- AT-05 / 父子排除未实现。物理重叠拒绝不是排除流程。WS-OVERLAP-01 不得标通过。恢复条件仍是单独设计并测试排除、回滚和链接/别名。
- Windows 安全读未实现，源码 fail-closed。本机未安装/未编译 Windows target。恢复条件是 Windows 上的真实编译和目录负例。
- 真实私人项目读取、付费 StepFun/搜索调用：未授权，unverified。合成 provider/model 与合成收据不是真实 StepFun。恢复条件为用户指定合法目录、系统凭据机制与发送范围。
- UI 与整 R1 未通过。
- F2 仅隔离无网络 SDK smoke 正在进行，未接真实 Core 目录/模型。SDK scout 已指出正式 Host 所需工具白名单、ContextPack、session-ref、credential 槽仍需实现与证据。实际发送前 Host 必须再次检查当前目录与模型授权，不能从 Reader 或开场局部测试推导外发通过。
- 开场提交仍是延迟事务。与撤权写者重叠时可能返回 SQLite busy，而不是 `root_revoked`；busy 时不提交新开场。撤权已经返回之后，读侧与开场侧都拒绝。
- 已经进入内核且不返回的单次 `read`/`openat` 不能被打断。另一连接最多等到现有 `busy_timeout`（5 s）；超时是 SQLite busy，不是撤权成功。
- Pi JSONL、网页 Reader、FTS、记忆修订：未进入本切片。
- macOS security-scoped bookmark、安装包签名、托盘/退出回收：留给后续集成，本切片不声称完成。
- Bun/Node 分发选择：保留 PRD O-01 未决状态。
- 旧架构画布目标配置未迁入新 worktree。本轮只维护仓库内架构状态。
