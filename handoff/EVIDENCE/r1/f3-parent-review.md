# Native 壳取消修复复核 · 2026-11-06

候选分支 `dev/r1-native-shell` / `8ca7617`，修复前 `ca0efb3`。

独立 Grok high 只读审查确认 P1：同 root/workspace 并发调用用 HashMap::insert 覆盖原 CancelFlag，先结束者还可能删除另一任务的条目。父会话采纳修复，不因 reviewer 的 OK with notes 尾注忽略该问题。

父会话检查实际 service.rs diff：同锁下 occupied 返回 scan_already_running/read_already_running；以 Arc 标识的 FlagLease drop 只删除自己的条目，正常/Err/unwind 不清掉其他任务；拒绝重复不会消耗预武装取消。

在 apps/desktop 实际执行：
- `cargo fmt --all -- --check`：exit 0。
- `cargo check --offline -p hark-native-shell -p hark-desktop`：exit 0。
- `cargo test --offline -p hark-native-shell -p hark-desktop`：exit 0，9 项 flow 测试全部通过（Desktop lib/bin 无测试，不虚报数量）。

新增两个 condvar 同步负例覆盖重复任务 busy、cancel 命中原任务、结束后可重试。接受当前本机定向修复，**放行 Native 壳进入串行集成**。未把测试注入 hook 作为前端命令开放。

未验证：真实窗口点击/托盘/隐藏/完整退出、安装包/签名、Windows、Sidecar 与模型；不以当前测试证明这些能力。目录权限仍 Native picker token → Core 根授权，模型完成与服务授权写入未暴露给前端。
