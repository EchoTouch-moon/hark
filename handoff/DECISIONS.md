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

## 串行集成（不是产品验收）

- 当前 Core 保留读侧物理范围、fd 绑定、FIFO、预算和短事务 I/O 准入。开场 lane 只带入 schema v2、run 绑定和开场负例。不把 `c69ade2` 的 base Reader 或旧 handoff 状态合进来。
- 来源目录撤权后，读侧与开场侧使用同一 `require_active` 结果：不再新读，摘录不可用，旧 receipt 不折叠、不创建开场。开场写路径不改成整次扫描锁，也不新建权限表。它仍是延迟事务；重叠撤权可能 busy。Host 发送前必须再查当前授权。
- F2 的工具白名单落地、ContextPack、session-ref、credential 槽本轮不实现。
