# F1 撤权准入证据：检查成功后到 open/read 的窗口

范围只含审查项 #5 余下的授权检查到 I/O 准入竞态。#1 fd 物理隔离、#2 FIFO、#4 预算不重做。#3 取消后开场收据未修，不得标通过。Host 未开始。这不是父会话放行，也不是产品 PASS。

对象都是进程临时目录中的自建合成目录。不读真实私人目录，不调用模型，不推 remote。未改 WAL，未加锁表，未改 migration，未改 `db.rs`。

## 为什么不能复用现有短查询

`get_root` / `with_conn` 在回调返回时释放 Core 互斥锁和 SQLite 锁，随后才 `openat` 或 `read`。另一线程或另一连接可以在这中间提交撤权并返回。已有测试在检查之前撤权，覆盖不到这个窗口。

`with_tx` 也不能直接包住系统调用：它是延迟事务，会提交，且不在检查前预留写锁。在已持有 `Core.conn` 时再调用它会在非重入互斥锁上死锁。延迟事务若先拿共享锁再升级，会和正在等待的撤权写者互相卡住，并立刻返回 `database is locked`。

## 接口（便于和另一 lane 串行合并）

未改 `db.rs`。helper 在 `grant.rs`，以后可原样并入 `db.rs`：

- `Core::admit_active_io(root_id, op)`：锁 `Core.conn`，`BEGIN IMMEDIATE`，`require_active`，运行 `op`（恰好一次 syscall，不得再进 Core），然后 rollback。不写行。
- `Core::with_immediate_tx(f)`：同样预留写锁，回调后 commit。暂停/撤权，以及读取路径的来源提交和扫描落库使用它。

不要启用 WAL。rollback journal 下 reserved 锁会挡住另一连接的写者；WAL 读者不挡写者，这个保证会失效。

## 修复前负例

`set -o pipefail`

`cargo test --manifest-path crates/hark-core/Cargo.toml --offline --test f1_disk -- --test-threads=1 grant_check_then_`

退出码 **101**。3 项失败。授权检查已经成功，hook 在 syscall 前阻塞且不持锁；另一线程或另一 Core 的 revoke/pause 已经返回；随后 `openat` 或 `read` 仍开始（计数 before=0 after=1）。

## 修复后命令

均使用 `set -o pipefail`。rustfmt 与最后一次 immediate 提交调整之后复跑。

| 命令 | 退出码 |
|---|---|
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |

全量结果：2 单元 + 32 磁盘集成 + 3 IPC 合同，全部 ok。原 FIFO、枚举预算、取消、别名重叠测试仍通过。新增 5 个磁盘用例。

## 实际证明

- 同 Core 另一线程：检查成功后、`openat` 前撤权已返回，则不再 `openat`，错误为 `root_revoked`，无 canary，`source_refs` 为 0。
- 另一 `Core::open` 同一 SQLite：检查成功后、`read` 前撤权已返回，则不再 `read`，无 canary，无来源行。
- 另一连接 `pause_directory` 在检查成功后、`openat` 前返回：不再 `openat`，错误为 `root_paused`，无 canary，无来源行。
- 大于 16 KiB 的文件：第一段 `read` 已准入后，下一次 `read` 的检查与 syscall 之间撤权返回，则不再开始下一次 `read`，不外发已读 canary，不写来源行。
- 另一连接在已准入的 `read` 临界区内调用撤权：250 ms 内撤权不能返回；释放临界区后撤权完成。随后新的读取被拒绝，列表接口不含 canary。这证明协调的是 SQLite reserved 锁，不只是同一把 `Mutex`。

读路径按最多 16 KiB 分段准入，临界区之间释放锁。不锁整次扫描或整个文件。

测试 hook `set_reader_after_grant_before_syscall_hook` 在锁外；`set_reader_admitted_syscall_hook` 在准入锁内，不得调用 Core 或等待撤权。默认空，不是产品能力。

## 未验证

- #3 取消后不同 model 的开场收据。不得标通过。
- 父会话尚未复跑本段。
- 已经进入内核且不返回的单次 `read`/`openat` 不能被打断。同 Core 撤权会等到该调用结束；另一连接最多等到现有 `busy_timeout`（5 s），超时是 SQLite busy，不是撤权成功。
- 其他进程持有未结束读事务时，撤权提交可能等到 busy timeout。
- 确认导入、开场收据等仍使用延迟事务的写路径，若与撤权重叠，可能返回 busy 而不是 `root_revoked`。它们在事务内复查状态，busy 时不提交新行。
- Windows 未编译。AT-05 / 父子排除未实现。真实模型、真实私人目录、Sidecar、UI 未做。
