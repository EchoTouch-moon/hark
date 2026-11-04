# M1-A 合成发现实现（A-C2）

本模块只枚举测试代码创建并登记的隔离合成根。它不是真实目录 connector，也不启用 Git、模型、网络或执行通道。公开结果只含不透明 ID、相对路径和合成标记，不含主机绝对路径或根 locator。

`scripts/build-posix-dir.mjs` 在 `pnpm pretest`/`pnpm prebuild` 时把 `src/native/hearth_posix_dir.c` 编进仓库内 `build/`。运行时只加载该预编译模块，不调用编译器，也不从临时目录取 `.node`。缺失或路径逃出包根时失败关闭。适配器用逐层 `openat`、`O_NOFOLLOW`、`O_DIRECTORY` 和 `fstat`；普通文件 `nlink != 1` 视为不能证明来源在根内，拒绝读取。Windows 没有已验证适配器，登记与枚举返回 `unavailable`，不回退到 `realpath` 加普通打开。

`src/fixture-discovery.ts` 用 v6 表 `fixture_roots` 保存合成根枚举授权。内容读取另需 v7 `fixture_candidate_grants` 绑定的、服务端签发的项目观察 grant；根枚举授权不能代替项目 grant。句柄不暴露 `fd`，撤权后释放并关闭底层描述符；v7 禁止把已撤权记录改回启用。同一 inode 的候选移出后再返回时恢复原 ID，不抛异常。

**边界**：适配器证明的是当前打开的对象仍通过相对 `openat` 从登记根到达，不能声称所有目录替换竞态在任意平台均已消灭。持有句柄不等于外部 I/O 与数据库事务原子。fixture 文本仍是不可信数据。真实用户目录、Windows 安全读取和 P0 Gate 均未通过。

验证命令见 `handoff/EVIDENCE/m1-a-c2-fixture-discovery-2026-11-04.txt`。
