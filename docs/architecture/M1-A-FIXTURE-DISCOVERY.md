# M1-A 合成发现实现（A-C2）

本模块只枚举测试代码创建并登记的隔离合成根。它不是真实目录 connector，也不启用 Git、模型、网络或执行通道。公开结果只含不透明 ID、相对路径和合成标记，不含主机绝对路径或根 locator。

`src/posix-dir-handle.ts` 在 Darwin/Linux 上编译 `src/native/hearth_posix_dir.c`，用逐层 `openat`、`O_NOFOLLOW`、`O_DIRECTORY` 和 `fstat` 取得目录句柄。句柄不可序列化，操作结束、取消或撤权后释放。Windows 没有已验证适配器，登记与枚举返回 `unavailable`，不回退到 `realpath` 加普通打开。`inspectPathCandidate` 仍只是预检，发现读取不走该函数。

`src/fixture-discovery.ts` 用 v6 表 `fixture_roots` 保存合成根枚举授权（内部 owner、epoch、设备/inode 绑定、暂停/撤销/过期）。每次枚举和读取前后在事务中复核授权和句柄身份。重启只能按持久绑定重新打开 locator；路径相同但 inode 变化时失败关闭。同名或嵌套候选默认 `needs_confirmation`，不自动合并。

**边界**：适配器证明的是当前打开的对象仍通过相对 `openat` 从登记根到达，不能声称所有目录替换竞态在任意平台均已消灭。持有句柄不等于外部 I/O 与数据库事务原子。fixture 文本仍是不可信数据。真实用户目录、Windows 安全读取和 P0 Gate 均未通过。

验证命令见 `handoff/EVIDENCE/m1-a-c2-fixture-discovery-2026-11-04.txt`。
