# Hark R1 决策

- 用户明确批准隔离新建 `dev/r1-desktop`，PRD v0.5.1 替代旧 M0/M1 产品/实施合同，保留安全红线；PRD 原 DRAFT 状态不擅改。
- 原工作区有未提交修改，不覆盖、不 stash、不代为提交；新 worktree 从本机 origin/master 7fa37df 建立，未 fetch，不声称远端最新。
- 前端主体暂缓；Grok 4.7 分 Core → Host → integration 三个独占串行 seam 实现，主会话负责规划与代码/证据审查，不额外消耗 OpenAI 规划子 agent。
- 只为当前纵切增加必要表/依赖，不做旧库迁移、兼容层、Node native addon、全套空基础设施或 Mock 产品验收。

## F1 Core 实现选择（不是产品验收结论）

- 父子 Workspace 排除未安全实现。任何路径包含、相同 inode 或无法证明不相交的授权/确认都返回 `overlap_refused`，detail 含 `parent_child_exclusion_not_implemented`。不称 AT-05 或 WS-OVERLAP-01 通过。
- 非重叠的同级候选可以在用户显式选择后各建一个 Workspace。默认确认模式仍是单项目。
- 普通文件硬链接策略：`nlink != 1` 拒绝。目录 link count 不用于该判断。
- 别名策略：不解析 Finder alias / bookmark。macOS `kIsAlias` 拒绝；检测失败则 fail-closed。Windows 安全读未实现，调用直接 `reader_unsupported_platform`。
- 本地 Reader 使用 `lstat`/`fstatat(AT_SYMLINK_NOFOLLOW)` 加 `openat(O_NOFOLLOW)`，从已检查的 fd 读字节。不先解析路径再普通打开。
- 扫描预算是可覆盖的工程默认值，不是 O-13 冻结：2000 项、深度 6、单文件 256 KiB、总计 2 MiB。
- IPC v1 上限冻结为 frame 1 MiB、控制/流式队列各 64、默认超时 30 s、最大 120 s。本阶段只交付 codec、schema 和关联门禁，不启动 Sidecar。
- Core 不调用模型。`agent_opening_message` 只有外部成功收据且模型授权启用时才写入，并在同一事务折叠本地卡。
- 撤销不删除历史对话，也不复活旧 Workspace。同一路径重新授权产生新 root id。隐私删除仍属 O-18。
- 授权持久化使用用户路径加打开后的 dev/ino，不是 security-scoped bookmark。路径被替换后 fail closed。
- 重叠判断使用已打开目录 fd 的物理祖先 dev/ino，不使用调用方路径字符串前缀，也不先 canonicalize 再普通 open。最终组件仍 `O_NOFOLLOW`。macOS `/var`→`/private/var`、`/tmp` 这类中间系统别名由内核在打开真实最终组件时解析，不因此拒绝所有测试或用户目录。
- 非撤销授权或 Workspace 若不能按存储 inode 重新打开，不能当成与新范围不相交。新的 `authorize_directory` / `confirm_import` 返回 `overlap_refused`，detail 仍含 `parent_child_exclusion_not_implemented`。用户需先撤销陈旧授权，才能授权另一个目录。这不是父子排除。
- Workspace 文件读取绑定验证过 inode 的目录 fd，子路径用 `openat` 从该 fd 打开，不从 root 重走 Workspace 路径。
- 每次新的 open/读取/来源插入前复查授权，不在整次扫描或整个文件读期间持有 Core 锁。单独的 `get_root` / `with_conn` 不能关闭检查到系统调用的窗口：锁在回调返回时已释放。`with_tx` 是延迟事务且会提交，也不能当作 I/O 准入，嵌套再锁会死锁。
- 内容 open/read 使用 `Core::admit_active_io`：同一把 `Core.conn` 互斥锁加 `BEGIN IMMEDIATE`，只包住一次 `openat` 或一次有界 `read`，然后 rollback。同 Core 的暂停/撤权等这把互斥锁；另一连接等 rollback journal 的 reserved 锁（现有 `busy_timeout`）。不要为此改 WAL：WAL 下读者不挡写者，窗口会重新打开。未加锁表。读侧准入不改 migration。
- 暂停/撤权与读取路径的来源提交用 `Core::with_immediate_tx`，避免延迟事务升级共享锁时和等待中的写者死锁。撤权或暂停成功返回后，不再开始新的 open、read 或成功来源提交。已开始的单次系统调用可以结束，但不能开始下一次 read。结果返回前再查授权；已撤权则不外发字节。历史 source 行保留，但 `content_available=false` 且摘录清空。

## 审查 #3 开场收据（实现选择，不是产品验收）

现有 onboarding 字段不能复用为受信 run/授权版本：

- `onboarding_runs.id` 必须在 `workspace_id + generation` 上保持稳定，否则两种首消息幂等会被拆开。retry 需要新 run、并继续拒绝旧 run，所以 onboarding 行 id 不能兼作 run id。
- `state` 与 `model_status` 有 CHECK，放不进 `run_` id 或授权版本。`error_code` 会被 retry 清空，也不能当绑定。
- `evidence_json` 是初扫笔记。把安全绑定塞进这份自由 JSON，后续扫描说明更新可以丢掉它。这正是“前端 success 即完成、重启可绕过”的验收缺口。
- `service_grants` 的 provider/model/`updated_at` 只是当前配置，不是发放 run 时的快照。只在提交时比较当前 grant，取消后仍能收下迟到 success。

最小替代：不改已提交的 `0001_init.sql`。显式 v2 只给 `onboarding_runs` 增加 `active_run_id`、`auth_provider`、`auth_model`、`auth_grant_updated_at`、`auth_root_updated_at`、`initial_read_requested`。不新建通用审批表或执行框架。

行为：`mark_analyzing` 由 Core 发放并持久化当前 run，并快照模型授权与目录版本。确认页初读开关只保存意向，不 enabled、也不 wildcard。未同时配置明确 Provider 与 Model 不能开始真实 run。`commit_agent_opening` 的 success 不是完成状态。伪 run、跨 workspace、不同 Provider/Model、取消、目录/模型撤权或暂停、配置切换（含切回）以及空证据都拒绝。失败不折叠本地卡，也不把 `model_analyzed` 置真。显式 retry 清除旧绑定；之后新的 `mark_analyzing` 才发新 run。已提交开场重放返回原消息。空证据的最小策略是：成功开场必须引用至少一条本 workspace 的 source，且目录授权仍为 active。不解析正文，不把本地卡伪装成模型分析。

## F3 Native shell（实现选择，不是产品验收）

- 目录选择结果只在 Rust 里保存 120 秒、单次使用的 `pick_` token。确认命令不接受路径。`enable_model_initial_read` 固定 false。没有 `set_service_grant`、`mark_analyzing` 或 `commit_agent_opening` 命令。
- Dialog 插件只给 Rust picker 使用，capability 不授予 `dialog:*` / `fs:*` / `shell:*` / `core:default`。应用命令权限由 `tauri-build` 2.7.4 的 `AppManifest::commands` 生成；构建脚本必须列出命令名，否则 capability 在编译前找不到 `allow-*`。
- SQLite 放在 Tauri `app_data_dir`，不放进被授权的项目目录。关闭按钮隐藏窗口；只有显式 quit 才退出。没有 sidecar，因此不建进程框架，Windows Job Object 标未验证。
- 开发 UI 只是中文测试表单。frontend-design skill 已读，但不做产品视觉，也不加外部署名链接。
- 同一 root/workspace 的进行中扫描或读取不覆盖取消标志。同一把 map 锁里若 key 已占用则返回 `scan_already_running` / `read_already_running`。拒绝重复后单 key 只有一条，结束时按 Arc 指针删除自己的条目，不建 generation 表。busy 不是成功，也不是没任务。

## 串行集成（不是产品验收）

- 当前 Core 保留读侧物理范围、fd 绑定、FIFO、预算和短事务 I/O 准入。开场 lane 只带入 schema v2、run 绑定和开场负例。不把 `c69ade2` 的 base Reader 或旧 handoff 状态合进来。
- 来源目录撤权后，读侧与开场侧使用同一 `require_active` 结果：不再新读，摘录不可用，旧 receipt 不折叠、不创建开场。开场写路径不改成整次扫描锁，也不新建权限表。它仍是延迟事务；重叠撤权可能 busy。Host 发送前必须再查当前授权。
- 串行集成当时没有实现 F2 工具白名单、ContextPack、session-ref 和 credential 槽。随后的 Host worktree 单独实现了这些运行时边界，见下一节。那不是当时 Core 提交的一部分。

## F2 Host 实现选择（不是产品验收，也不是 Rust 接通）

- 不新增 IPC method。每次 provider 请求前复用反向 `workspace.overview`，要求 `tool.result` 带可信 authorization 对象。形状冻结在 `packages/agent-host/docs/host-dto.md`。`current` 必须由调用方给出，Host 不按模型名填 true。启动快照不是发送许可。
- `ModelRuntime.create` 没有 `authContext`。在任何 native refresh 之前用 `registerProvider("google-vertex", { apiKey: "hark-closed-ambient" })` 跳过继承的 ADC `fileExists`。Sidecar 入口在 import SDK 前只拒绝 ADC、`~/.aws`、`~/.pi/agent` 凭据文件和私人 vault 路径，普通 session 文件仍走原 fs。
- 远程 Provider 默认关闭。显式配置必须给出 provider、model、baseUrl、apiKey 和 `wire: "openai-completions"`。没有该配置或未 enabled 时不发送，也不读环境凭据。`faux` 与 `stepFunCompatible: true` 拒绝。faux 不是产品 fallback。`providerId: stepfun` 保持原名，可进入显式槽，但不把 OpenAI-completions 构造器说成已验证的 StepFun 协议。非配置 URL 拒绝，注入 fetch 使用 `redirect: "error"`。
- Host 进程同一时刻只接受一个活跃 run。另一个 Workspace 的 `run.start` 返回已有错误码 `correlation_rejected`，message 含 `host busy`。不新增 IPC 错误码，不建队列或多 worker。被拒绝的 run 不改写当前 gate。结束后可重试，Session 仍按 Workspace 保存。
- overview 若给出新的 revision 或 sourceVersion，但没有非空 `overviewText`，发送前失败关闭。不把 run.start 的旧 identity/overview 贴上新版本。有新正文时只用该正文，不保留旧 identity。
- 旧 compaction 或 branch summary 不能可靠过滤时，不改 SessionManager，改为官方新 Session。任何新创建的 Session 都可以有一次最多 10 条的近期消息衔接。`handoffId` 只相对目标 Session 去重。原 Session 恢复不重复灌入。另一个新 Session 不因工作空间里已经出现过同一个 id 而被跳过。
- `context_with_system` 异常会被 SDK 吞掉。真正的发送边界在 provider stream：重新核对授权并重建当前 pack；重建失败则不调用 fetch。
- Host 返回 `pi:<sessionId>`。不发放 Core `conv_` id，不写业务库。正式归属由后续 Rust 集成保存。

## 首次开场 stdio 集成（不是常规对话，也不是产品验收）

- 不新增 migration。`onboarding_runs.evidence_json` 已按 workspace+generation 持久化，并已有 scan 元数据。typed `sessionBinding`（workspace、conversation、run、sessionRef）作为业务引用写入同一对象，不覆盖 scanId，也不成为授权权威。授权仍是 service grant、root 状态和 Core 发放的 active run。跨 session 查询或唯一约束不是本切片验收，所以不加列、不建 agent/session 平台。
- `run.start.userMessageId` 对 `purpose: opening` 必须缺省。conversation 仍要求真实已存 `msg_` id。不为对齐 DTO 向 Hark 插入虚假用户发言。首轮 `userText` 是内部初读指令。Pi JSONL 仍可能把该指令记成 session prompt；那不是 Hark `user_message`。
- 开发 Node 路径只来自 Rust `DevSidecarConfig`，不注册为前端命令。合成模型许可只走 `dev_set_synthetic_model_grant`，不进入 Tauri IPC。未配置时 `connected=false`，不读 Key，不发请求。Windows 无 Job Object 时拒绝启动。
- 已结束 opening run 的当前 `sessionBinding` 可被 Core 新发放的 run 替换。同 run 不能任意换 session。compaction 新 session 只走显式 `replace_opening_session_for_compaction`，不扩常规对话，不删 Pi JSONL，不复活旧 run。
- Sidecar 状态只有一份 `Arc`。stdout frame ingress 上限等于 IPC control queue 64；过载关闭受影响 run 和管道。`stop`/`Drop` 有界；worker 未结束时返回 timeout，不允许并发复活同一任务。已 SIGKILL 的子进程用 `waitpid(WNOHANG)` 回收。已进入内核的单次 syscall 仍不可打断。

## 下一阶段 StepFun 真实验收授权（尚未执行）

用户已单独批准下一阶段只做 StepFun 真实验收，边界如下。本段 bridge 返工没有使用该许可：未读任何真实 Key，未发任何真实请求，未加 live 脚本，也未从父进程环境查找 Key。

- 模型只允许 `step-3.7-flash`。最多 3 次真实模型请求。每次输出上限 512 tokens。用户后续已确认国内平台，唯一目标为 `https://api.stepfun.com/v1/chat/completions`，不自动改用国际域名或其他模型。
- 用户亲启首次请求返回HTTP402，已用1次；再次默认启动被已有摘要拦下，0次发送。用户表示计费已处理。续测只可使用剩余2次，直接Tool请求→流式最终回复，不另加单独text请求，不覆盖原402证据。任何额外预算需用户另行批准。
- 只发送合成材料。不读取真实私人项目或私人目录。
- Key 只由后续独立验收进程的临时环境变量提供。不粘贴到聊天，不读取现有全局 Key，不写入源码、SQLite、JSONL 或证据。
- 该许可不扩大为后台自动调用、搜索、通知，或其他模型/次数/材料范围。用户会在后续本地独立脚本中隐藏输入 Key；当前进程不得代为查找。
