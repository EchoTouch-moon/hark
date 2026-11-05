# F1 Reader 修复证据：FIFO 阻塞与枚举预算

范围只含审查项 #2 与 #4。#1 中间 symlink 重叠绕过、#3 取消后开场收据、#5 撤权/Workspace fd 复验仍未修，Host 仍不得开始。

## 失败负例（修复前）

`set -o pipefail`
`cargo test --manifest-path crates/hark-core/Cargo.toml --offline --test f1_disk -- --test-threads=1 fifo_without_writer_does_not_block_scan_or_read`

退出码 **101**。自建临时目录中的无 writer FIFO 使 `run_initial_scan` 在 3 秒内不返回。测试进程在断言后退出，没有保留编译进程。

## 修复后命令

均使用 `set -o pipefail`。

| 命令 | 退出码 |
|---|---|
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline --test f1_disk -- --test-threads=1 fifo_without_writer raced_fifo enumeration_budget` | 0 |
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |

全量结果：2 单元 + 20 磁盘集成 + 3 IPC 合同，全部 ok。新增 3 个磁盘负例：无 writer FIFO、打开前检查后换成 FIFO、`readdir`/`open` 计数证明预算与中途取消。计数断言不是只看 `files_seen`。

## 实现要点

- 打开前用 `fstatat(AT_SYMLINK_NOFOLLOW)` 拒绝 FIFO/socket/设备；`openat` 带 `O_NONBLOCK`；打开后再 `fstat`，类型变了就拒绝。预检查不能代替打开后复验。
- 目录枚举在每次 `readdir` 前检查剩余条目和取消，不再先收集完整 `Vec` 再打开。`run_initial_scan` 与 `selective_key_read` 都传入该边界。
- 线程局部计数 `reader_readdir_steps` / `reader_open_attempts` 只给回归证明用，不是产品指标。

## 未验证

- Windows 目标未编译。
- #1/#3/#5 没有在本段修复或复测为通过。
