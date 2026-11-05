# Hark R1 实施计划

## 1. 已批准的工程切换
- 同一 Git 仓库与共同历史，`dev/r1-desktop` 从本机 `origin/master` (`7fa37df`) 开始，不创建孤儿分支。
- 原 dirty 分支和旧代码不动；不合并 PR #57、不推远端、不关闭 PR。旧材料只筛选参考，不要求兼容旧接口、Schema 或前端。
- PRD v0.5.1 为当前 R1 目标；用户明确批准替代旧 M0/M1 产品与实施合同，安全红线继续生效。详细协调见根 AGENTS。
- 首轮仅工程底座，不冒称完整 R1。前端主体留给其他 agent；付费外发、真实私人目录授权、公开发布、签名与 Windows 实机验收另需条件。

## 2. 完整 R1 交付 DAG（不以时间推定完成）
| 切片 | 依赖 | 可观察交付 | PRD/AT | 关闭条件 |
|---|---|---|---|---|
| F0 当前基线 | 无 | 新分支、唯一指令、任务与历史索引 | §14 | 文档/授权冲突消除，历史保留 |
| F1 Rust Core | F0 | Workspace 授权、真实受控文件初扫、SQLite 对话/首次运行恢复 | FR02–05/09/14，AT09/12/13 | 自建真实磁盘目录集成与越界/撤权负例；不等于用户项目验收 |
| F2 Pi Host | F1 IPC 合同 | 嵌入式锁版 Pi、白名单工具、双向请求/事件/取消、隔离 Session | FR05/06/20，AT06/14/21 | SDK 实例工具清单、真实 JSONL 与无网络集成证据；真实 StepFun 未获授权不得执行 |
| F3 Desktop 纵切 | F1+F2 | Tauri 启动 Core/Sidecar、目录确认至本地卡、模型开场调用接口、重启恢复、最薄 UI 入口 | FR01/13/14，AT02/06/09/11 | 可构建 macOS 宿主、反向 Tool 不死锁与退出回收实测；模型开场与安装验收分列 |
| R1-A 首条真实价值 | F3+用户模型/项目授权+正式 UI | 用户目录→StepFun 真实开场→正常对话→重启恢复 | Memory-A，AT02–06/09/14/17 | 真实项目/Monorepo/多项目导入确认；用户体验审查 |
| R1-B 记忆与修订 | R1-A | 普通笔记/决定、独立结构化观点、反馈、来源核验/修订/FTS | Memory-B，AT08/15–20 | MEM-11/SEARCH-01/CTX-01 与真实纠正回忆；无模型伪造来源 |
| R1-C 研究与注意力 | R1-A+服务授权 | Pi 原生搜索+安全 Reader、Rust 增量观察、通知/低打扰 | Memory-C，AT07/10/16/22 | READER-01，真实搜索原文、缺口与授权测试 |
| R1-D 双平台成品 | A+B+C+正式前端 | 自含运行时安装包、托盘/隐藏/退出、资源/隐私清理 | AT01/11/21+全部覆盖 | Mac/Windows 各自真实证据与用户批准，不以 Mac 代替 Windows |

F1–F3 是本轮委派范围；不在本轮用 Mock 宣称关闭 R1-A–D。只为已启用路径修必要问题。安装包、模型和搜索的未验证状态不得隐藏。

## 3. 当前拓扑与串行所有权
分类 **multi-seam**：Rust 业务权限与 TS Pi runtime 各有独立可测试边界，最终 Tauri/进程集成需消费两者合同。为减少冲突与复杂度采用串行独占 writer（不为并行制造分支合并）。

| Lane/key | 唯一写范围 | 合同/目的 | 隔离/权限 | 下一 gate/交接 |
|---|---|---|---|---|
| r1.core | `crates/hark-core/**`、`contracts/**`；该阶段证据/任务 | Core SQLite/Reader、瘦 IPC v1 | 新 R1 worktree，local commit，禁止 remote | cargo test/check；提交+IPC 合同供 Host 消费 |
| r1.host | `packages/agent-host/**`、必要 JS 根 workspace/锁文件；该阶段证据 | 锁版 SDK、受控资源、反向 Tool/流式/取消、Session | 同 worktree，Core 完成后才开始；不得改 migration | strict TS/test；SDK API/JSONL/tool 清单证据，提交供集成消费 |
| r1.integration | `apps/desktop/**`、scripts、CI、根运行说明与 handoff | 仅消费 Core/Host，Tauri 接线/进程管理 | 同 worktree，前两者完成后才开始；不重写 Core/Host | cargo/npm 相关检查、真实 stdio probe、Mac 构建；阻塞需明确记录 |
| 主会话 review | 只读各阶段 diff/证据；裁决后返工仍交该 seam writer | 当前启用风险、PRD 符合度 | 节省 OpenAI，不另起 OpenAI 常规规划 agent | 仅针对实际问题最多三轮修复；不因测试通过宣称产品完成 |

所有 child 用 `xai/grok-4.7`，不得再委派。每段完成必须有持久交接与实际命令证据。遇新架构/隐私/外发选择问主会话。若缺必要工具或平台条件，做可运行的独立部分并记录 blocker，不猜接口、不虚报。

## 4. 首轮最小合同（Core 先写并冻结可用部分）
- Rust SQLite 单写入；最少授权根、Workspace、conversation events、onboarding run、source refs 与服务授权。暂未使用的领域不建空表。
- 首次扫描先返回候选，确认后才创建 Workspace；候选不会产生 Agent/长期记忆。默认单项目；重叠配置拒绝，父子新建排除流程若尚未实现则明确拒绝，不可静默重叠。
- 本地扫描/读取有数量、深度、单文件与总预算，可取消；敏感/产物路径忽略，拒绝链接/不安全别名与路径逃逸，校验实际打开对象；授权存储重启后保留，调用前复查暂停/撤销。
- `local_scan_card` / `agent_opening_message` 按 workspace+generation+kind 各自幂等；后者成功收据后本地卡变为折叠证据。模型未授权/不可用返回明确状态，不能生成伪智能开场。
- IPC v1：request/response/event/error，ID、run/workspace 绑定、取消、超时、最大 frame、队列预算；stdout 无日志；双向调用交错非阻塞，拒绝跨请求/跨空间回复。
- Host 工具的 workspace/run/user message 由可信上下文绑定；Pi tools 默认全部关闭，仅显式 Hark 工具。禁止自动项目/全局扩展/凭据发现；sdk 实际 API 与精确版本以源码/导出验证。
- Context Pack 不重复当作用户消息；真实 Pi JSONL/请求变换/compaction 证据未完成则列阻塞，不写空测试假 PASS。Rust 为模型授权来源；远程模型、搜索、后台模型分别检查。任何真实请求必须另有用户批准的凭据/发送范围。
- UI 交接提供命令、事件、DTO、错误、状态与演示恢复步骤，后续前端无需理解旧 fixture 服务。

## 5. 验收与停止规则
每项状态使用 implemented / verified-local / unverified / blocked / deferred。区分自动回归、真实磁盘集成、真实 Pi SDK 无网络测试、真实付费 Provider、桌面交互、安装包、跨平台、用户价值验收。

六项 PRD 补丁 CTX-01 / MEM-11 / SEARCH-01 / WS-OVERLAP-01 / ONBOARD-01 / READER-01 均必须出现在覆盖矩阵，暂未进入切片的标 pending/deferred 而非通过。工程每次三次连续修复后仍失败，记录命令、错误与恢复条件，换独立任务；重大可达风险关闭能力。

## 6. 回滚与历史
新代码独立于旧运行体系；本地小提交可单项 revert。保留原仓库所有历史与旧 worktree。旧未提交改动不在新分支快照中，不声称已备份/已推送。本轮不创建旧数据迁移器、不复用 Node native addon，也不改全局 Pi/Hermes 配置。
