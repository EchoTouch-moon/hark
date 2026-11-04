# A-C3 文件夹移动修复与剩余限制

本轮区分两件事：在句柄存活期间，用户授权的**根文件夹本身**改名或移动后，仍使用原文件夹对象，不要求重新授权；从授权根中移走的**子目录**，旧子句柄不能继续用于访问。前者与 [Go 标准库 Root 对目录移动的说明](https://pkg.go.dev/os#Root)一致。当前重启恢复仍使用旧路径，根目录移动后不能自动找回；跨重启跟随移动尚未实现，不能误称已满足。

## 已修复的可复现场景

- 已打开的子目录若已移出根，`listDirectory`、`openChild` 和 `readOpened` 拒绝使用旧子句柄；原文件被同名替换时，旧文件句柄也拒绝返回内容。授权根整体移动仍可用。
- 复用现有目录句柄与文件身份检查；对非目录使用非阻塞打开，避免特殊文件在检查类型前卡住。未增加外部依赖，也未接入真实目录。
- 新增四项纯合成测试；修改前实际出现“移出子目录仍能列出文件”的失败。`pnpm lint`、`pnpm typecheck`、`pnpm test`（25 文件、168 项）、`pnpm build` 与已更新的 `node handoff/qa/m1-synthetic-moved-directory.mjs` 均退出 0；随后保护内部身份数据的微调又复跑 18 项受影响测试、typecheck 和构建，见 `handoff/EVIDENCE/m1-moved-child-fix-2026-11-04.txt`。该脚本此前在历史提交 `be36937` 中用于展示旧行为，现已改为验证已完成移动会被拒绝。

## 尚未修复的并发窗口

身份检查和实际读取仍是两个操作，之间可能发生移动。`node handoff/qa/m1-synthetic-move-interleave.mjs` 仅用自建临时目录，将移动精确安排在最后一次检查与真实 `read` 之间；实际高层 `readSyntheticFile` 返回了移出后写入的合成内容。脚本输出 `true`、退出 0 的意思是**限制已复现**，不是安全通过。完整输出见同一证据文件。

因此本轮不能声称整个目录移动问题已彻底修复，也不能将 A-C3/P0 或 M1→M2 Gate 标为通过。真实项目 connector 仍未启用；没有读取用户真实项目。

macOS 提供 [App Sandbox 和可跨重启保存的用户选择文件访问权限](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)，但当前产品是本地 Node 服务而不是采用 App Sandbox 的签名原生应用；不能声称已经获得该系统隔离能力。后续需选择能覆盖上述并发时序的实现并验证后再接入，不能把额外一次普通路径检查当作原子保证。
