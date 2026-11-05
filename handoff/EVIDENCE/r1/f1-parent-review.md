# F1 主会话审查 · 第一轮

审查 HEAD：9c79f81。父会话复跑 `cargo test --manifest-path crates/hark-core/Cargo.toml --offline`（pipefail）：2 单元+17磁盘+3 IPC 全通过。这只证明已有覆盖，不构成 F1 放行。

## 实际复现
父会话以临时 Rust probe 链接本次构建的 hark_core，所有对象为自建合成临时目录，不读真实私人数据。probe 不混入生产源码。

1. **P1：物理重叠通过中间 symlink 别名绕过**。建立 `base/parent/child` 与 `base/alias -> parent`；先授权 parent，再授权 alias/child，实际 `nested_alias_authorized=true`。reader::open_root 只对最终组件 NOFOLLOW，relation::nested 依赖字符串前缀，导致当前声称的 overlap_refused 可绕过。修复应基于打开目录身份/物理祖先，或明确拒绝不安全中间链接，不能只补字符串规范化。需注意 macOS 系统 /var、/tmp 正常别名，不能随意破坏测试/产品选择目录行为。
2. **P1：FIFO 使扫描阻塞，无法按预算/取消返回**。在已授权目录放一个无 writer FIFO，run_initial_scan 在 3 秒外部 deadline 内无返回；父会话已 kill 自己的 probe 并清理临时目录。reader::open_child 在 fstat 分类前 O_RDONLY 打开特殊对象，不能依赖事后 classify 拒绝。应在实际打开与复验处均有安全拒绝策略，竞态换成 FIFO 也不能阻塞。
3. **P1：取消与指定模型约束未执行于首次消息提交**。启用 stepfun/expected-model，cancel_onboarding 后提交同 provider/different-model 的 success receipt（空 source ids），实际 `cancelled_wrong_model_empty_sources_accepted=true`。目前只比 provider，不比 model，也不检查 cancelled/root 状态。迟到结果不可把取消任务标 presented；需受信运行关联与当前状态校验，重放已提交收据可保留幂等。未指定 Provider/Model 不应成为任意 Provider wildcard 的真实运行许可。

## 源码证明，需定向回归
4. **P1：枚举先无界收集/打开，再执行外层预算/取消**。reader::list_names 收集整个目录 Vec，inspect_directory 打开/分类所有子项后，scan::walk_scan 才检查 max_entries/CancelFlag；selective_key_read 同样先全列目录。预算应传入实际枚举/分类边界，大目录与取消不能先全量遍历/打开。用可观测计数或可控测试证明预算，不只断言最后 files_seen。
5. **P1：运行中的撤权与 Workspace 目录身份存在复验缺口**。walk_scan 使用一次授权快照，整个扫描后才再查 grant；selective_key_read 全程使用同一 root；read_checked 先 identify_relative 验证 ws inode，随后另从 root 重走 full_rel，二者间 Workspace 可被换成另一兄弟目录。需让实际读操作绑定已验证 Workspace descriptor，避免检查对象与实际读取对象不同；每次新读取前持久授权复查，撤权返回后不再新开文件，已有结果不能继续外发/提交。不要用覆盖整次慢扫描的大锁把撤权无限阻塞。补自建目录竞态/同步屏障测试，不扩大到通用权限平台。

## 裁决
**返工，尚不放行 Host。** 父子排除、Windows、Memory/FTS/网页 Reader 等不扩入本次。保持当前安全关闭与诚实未验状态；只修当前 Reader/scan/receipt 可达问题，更新证据与合同，再提交下一轮审查。

## 第一段返工复核（HEAD 7db1958）
父会话检查 FIFO/枚举 diff，并实际复跑 `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8`：2 单元 + 20 磁盘 + 3 IPC，25 项全部通过。重新链接新库运行原父会话 writerless FIFO probe，实际立即返回 `starting_fifo_scan / returned=true`，不再卡在 open。

#2：打开前拒绝特殊对象，O_NONBLOCK 打开后 fstat 复验，新增 regular→FIFO 可控竞态覆盖；本机此修复接受。#4：readdir/分类处已应用 entry/cancel 预算，初扫与 selective read 均传入，有实际工作计数负例；本机此修复接受。公开测试 hook/counter 非产品指标，后续可收敛为测试专用，不因此扩建运行基础设施。

**仍阻塞：#1 物理别名重叠；#5 Workspace descriptor 与运行中撤权；#3 首次开场运行/模型/取消收据。** 接下来先修 #1/#5 同一目录读取边界，再修 #3。本段接受不代表 F1 整体或 R1 产品通过。

## 第二段返工复核（HEAD 643be34）
父会话复跑 2 单元 + 27 磁盘 + 3 IPC，32 项全通过；重新链接库运行原中间 alias/child 探针，实际 `nested_alias_authorized=false`。已检查物理祖先 dev/ino 关联与 Workspace fd 直接读路径，本机接受 #1 与 #5 中 fd 绑定部分。

#5 尚有明确小窗口：reader::open_child 的 `grant_check()` 返回后释放 Core/SQLite 查询锁，随后才调用 `openat`；read_within_workspace 的读前检查返回后才调用 read_fd，read_fd 内多次 read 没有同一准入边界。另一线程/连接可在检查后提交撤权并返回，再被旧操作 open/read。已有同步测试在检查之前撤权，未覆盖检查已成功后的窗口，因此“撤权返回后不再新开/新读”的强声明仍不能成立。需要只在短 I/O 准入处协调授权状态变更，不能锁住整次扫描；补检查成功后与实际 open/read 之间的可控竞争证据。#3 由隔离 high lane 并行处理。

## 撤权准入收口复核（HEAD 0b17b6b）
父会话检查短 IMMEDIATE 事务与单 syscall/16 KiB 分段读边界，并复跑 `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8`：2 单元 + 32 磁盘 + 3 IPC，37 项全通过；`cargo check --offline --tests` 退出 0。新增覆盖查询成功后撤权/暂停、第二段读及另一连接等待已准入 syscall 的同步竞争。本机这部分 #5 定向修复接受，不再要求重建权限平台。

限制仍有效：已进入内核的单次 syscall 不能打断；SQLite busy 不等于撤权成功；最终远程发请求前仍须由未来 Host/桥接再次核验当前授权，不能从 Reader 局部测试推导外发通过。Windows/真实私人项目/安装包均未验。

## 收据分支独立复核（c69ade2，尚待集成）
父会话读 diff/最小 v2 迁移必要性并在隔离分支复跑：3 单元 + 20 磁盘 + 7 开场 + 3 IPC，33 项全通过。Core 绑定 run/provider/model/授权快照，取消/撤权/配置切换与旧 run 负例有覆盖。接受为待集成候选，不继承该分支旧 Reader 代码或旧 handoff 状态。合入最新 Core 后必须再跑联合回归；scope 与收据 API 的交界仍未验证。

## F1 集成最终本机复核（0771ebe）
主会话已检查集成 diff，reader/grant/scan 与 v1 migration 相对 c60279b 无变化，未丢掉已验修复。实际复跑 `cargo fmt -- --check`、`cargo check --offline --tests` 与 `cargo test --offline -- --test-threads=8`，均退出 0：3 单元 + 32 磁盘 + 3 IPC + 8 开场，共 46 项通过，含同 Workspace 撤权/来源/开场联合负例。

裁决：五项当前本机定向修复接受，**F1 本机工程底座放行**，允许继续 F2/F3 开发；不是产品阶段关闭，也不证明真实模型、私人项目、UI、Windows 或安装包通过。后续实际请求前再次核验授权、出处新鲜度与 Provider 兼容性仍是启用路径的交付条件。
