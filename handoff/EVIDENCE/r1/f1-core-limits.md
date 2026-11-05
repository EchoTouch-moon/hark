# F1 Core 已验证与未验证

## 本机已跑

- `cargo test --manifest-path crates/hark-core/Cargo.toml --offline`：22 项测试通过（2 单元、17 磁盘集成、3 IPC 合同）。
- `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` 通过。
- 磁盘测试使用进程临时目录中的自建目录，不读取真实私人目录。
- 覆盖：v1 migration 与失败 DDL 回滚、授权暂停/撤销/重启、第二根目录不受影响、初扫不建 Workspace、默认单项目、Monorepo 不拆、多项目候选待确认、取消扫描不可确认、重叠拒绝且零写入、外键候选回滚、符号链接/硬链接/Finder alias/路径逃逸/敏感文件/产物目录、目录替换后的 inode 失配、两种首消息幂等、失败收据不折叠、成功收据才折叠、跨 Workspace 来源拒绝、重新授权不复活旧 Workspace、单文件/总预算。

## 不得称为通过

- AT-05 / WS-OVERLAP-01：父子排除未实现。重叠返回 `overlap_refused`，detail 含 `parent_child_exclusion_not_implemented`。
- ONBOARD-01：只验证了 Core 持久化与幂等。没有 UI，没有真实模型调用。
- READER-01：这是本地文件 Reader。网页 DNS/跳转/SSRF 不在本切片。
- CTX-01、MEM-11、SEARCH-01：未建对应表，也没有 Pi JSONL/FTS。状态 pending。
- 真实 StepFun、搜索、私人项目、安装包、Windows 实机：未运行。
- IPC sidecar 进程、stdio 实管道、Windows Job Object：只冻结了 codec/schema/队列门禁。

## Reader 小切片（#2/#4）

- 无 writer FIFO 与打开前检查后换成 FIFO 的扫描/读取在本机 3 秒内返回，并记 `special_file_rejected`。
- `readdir`/`open` 计数证明 `max_entries` 与中途取消发生在枚举边界，不是只看最终 `files_seen`。
- 命令与退出码见 `f1-reader-fifo-budget.md`。
- #1/#5 的后续本地修复见 `f1-scope-repair.md`，尚未经父会话复跑。#3 仍未修。

## 可恢复限制

- Windows 安全读在源码中 fail-closed（`reader_unsupported.rs`）。本机没有编译 Windows target，不能把源码分支当成已验证。
- 授权身份是路径加打开后的 dev/ino，不是 macOS security-scoped bookmark。目录改名或被替换后读取失败，不跟随新对象。
- 用户路径的中间系统符号链接（例如临时目录前缀）由首次 `open` 解析；授权目录自身和内部组件不跟随链接。
- 普通文件 `nlink != 1` 一律拒绝。只在项目内被硬链接两次的文件也会读失败。
- Finder alias 只拒绝 `kIsAlias`。不调用 alias 解析。未标记的 bookmark 文件不会被解析，但也不能声称覆盖所有别名形态。
- APFS firmlink、Unicode 规范化别名没有单独测试，不声称已隔离。
- 撤销停止新读取并隐藏已存摘录；不删除历史对话。隐私删除仍是 O-18，未实现。
- 扫描预算是工程默认值，不是 O-13 产品冻结：2000 项、深度 6、单文件 256 KiB、总计 2 MiB，调用方可降低，绝对上限以上拒绝。
