# F1 scope 修复证据：别名重叠与 Workspace fd/撤权

范围只含审查项 #1 与 #5。#2/#4 保留。#3 取消后开场收据未修。Host 未开始。这不是 F1 放行，也不是产品 PASS。

对象都是进程临时目录中的自建合成目录。不读真实私人目录，不调用模型，不推 remote。

## 修复前负例

`set -o pipefail`

`cargo test --manifest-path crates/hark-core/Cargo.toml --offline --test f1_disk -- --test-threads=1 alias_parent_child renamed_or_replaced swapped_workspace revoke_on_same_core revoke_from_reopened confirm_refuses`

退出码 **101**。6 项失败，1 项回归守卫通过（中间 symlink 的真实最终组件仍可授权）。

- `authorize(parent)` 后 `authorize(alias/child)` 成功，而 `alias -> parent`。
- 原 root 改名并在原路径放入替换目录后，授权被搬走的子目录成功。
- 验证 Workspace inode 后、打开文件前把目录换成兄弟目录，读到兄弟 canary。
- 同 Core 跨线程在第二次关键文件验证后撤权，读取仍成功并提交 canary 来源。
- 另一个 Core 打开同一 SQLite 后撤权，扫描仍继续打开其余文件。

## 修复后命令

均使用 `set -o pipefail`。在 rustfmt 之后复跑。

| 命令 | 退出码 |
|---|---|
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |

全量结果：2 单元 + 27 磁盘集成 + 3 IPC 合同，全部 ok。原 FIFO 与枚举预算测试仍通过。新增 7 个磁盘用例：别名父子拒绝、中间 symlink 仍可授权、改名/替换后不能绕过、确认时无法证明不相交则拒绝、Workspace 替换不读兄弟 canary、同 Core 撤权停止后续读取与提交、重开 Core 撤权停止扫描 open 且不写入 scan 行。

## 实现要点

- 重叠比较已打开目录的 dev/ino 祖先链。不把调用方路径做字符串前缀，也不 canonicalize 后普通 open。
- 最终组件仍 `O_NOFOLLOW`。`/var`、`/tmp` 一类中间系统别名不被单独禁止。
- 非撤销授权或 Workspace 不能按存储 inode 重新打开时，返回 `overlap_refused`，不当成不相交。撤销后才能授权其他目录。detail 仍含 `parent_child_exclusion_not_implemented`。这不是父子排除。
- `read_within_workspace` 验证 Workspace inode 后只从该 fd `openat`。测试 hook 在验证与打开之间替换目录，读到的是原文件 `safe-original`，不是兄弟 canary。
- 每次新 open、读取和来源插入前做短 SQLite 授权查询。扫描不持有整次慢扫的 Core 锁。来源插入与扫描持久化在写事务内再次检查状态。
- 撤权后 `list_source_refs` / `get_source_ref` 保留历史行，但 `content_available=false` 且摘录为空。新的本地扫描卡在撤权后不能新提交。

测试 hook `set_reader_after_workspace_verify_hook` 与既有 FIFO hook 一样：默认空，不是产品能力，不开放读取或撤权 API。

## 实际证明的并发边界

- 同一 `Core`、另一个线程调用 `revoke_directory`：撤权返回后，进行中的 `selective_key_read` 不再打开后续文件，也不成功插入这些来源。Core 锁只覆盖短查询/短事务。
- 另一个 `Core::open` 同一 SQLite 文件后撤权：进行中的 `run_initial_scan` 在下一次 open 前看到 `root_revoked`，且 `scan_sessions` 行数为 0。本机使用 SQLite 默认 journal，未改成 WAL。
- 未证明：已经进入单次 `read` 系统调用之后的中断；其他进程持有未结束读事务；Windows；暂停的单独竞态（暂停走同一 `require_active` 门，只对撤权做了屏障测试）。

## 未验证

- #3 取消后不同 model 的开场收据。不得标通过。
- 父会话尚未复跑本段。
- Windows 目标未编译。
- AT-05 / 父子排除流程未实现。
- 真实模型、真实私人目录、Sidecar、UI。
- 本文件记录时，检查成功后到 `openat`/`read` 的窗口尚未关闭。后续本地收口见 `f1-revocation-admission.md`，那也不是父会话放行。
