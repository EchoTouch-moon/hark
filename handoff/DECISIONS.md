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
