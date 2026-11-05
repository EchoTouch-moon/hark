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
