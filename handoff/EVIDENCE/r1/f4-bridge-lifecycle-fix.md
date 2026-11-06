# Bridge 重试 / 状态 / 队列 / 有界 stop

状态：verified-local。不是产品通过，不是 StepFun，不是窗口交互，不是整 R1。

父会话复核原文仍在 `f4-parent-review.md`，本文件不覆盖它。修复前负例已复现：`bind_opening_session` 在 cancel → retry → 新 run 时返回 `CorrelationRejected` / `opening run already has a different sessionRef`。

## 修法

- 当前 Core run 可以替换已结束旧 run 的 `sessionBinding`。旧/伪 run 仍是 `RunMismatch`。同 run 同 sessionRef 重放幂等；同 run 换 session 仍拒绝。compaction 只走 `replace_opening_session_for_compaction`，不扩常规对话。旧引用留在 `retiredSessionBindings`。不删对话，不删 Pi JSONL，不把 `active_run_id` 改回旧 run。
- Sidecar `status()` 与 worker 共用同一 `Arc<Mutex<SidecarStatus>>`。EOF/kill/关 stdin 后不必先 `stop()` 才看到 `connected=false`。未配置与 Windows 仍 fail-closed。
- stdout→worker 使用容量 `MAX_CONTROL_QUEUE`（64）的 `sync_channel`。满则 `try_send` 失败、发 `queue_overflow`、关闭管道和受影响 run，不把丢掉的 tool/result 当成功。stop/cancel 走独立命令通道，不被 frame 队列堵住。不是通用 bus。
- `stop`/`Drop` 同一路径：先杀进程组，reply 最多 5 秒，worker join 最多 2 秒。worker 未结束则 `exited=false`、`worker_stopped=false`、`reason=stop_timeout`，并拒绝再次 `start`。已退出的 Node 用 `waitpid(WNOHANG)` 回收，避免僵尸被 `kill(pid,0)` 当成存活。测试 hook 在 `thread::scope` 内 RAII 释放。

## 本机命令

`set -o pipefail` 后实跑，退出码 0：

- Core `cargo fmt --check`、`cargo test --offline`：48 项（单元 3、磁盘 32、IPC 3、开场 10）。原 47 项仍在，新增 ended-run rebind 1 项。
- Native `cargo fmt -p hark-native-shell --check`、`cargo check --offline -p hark-native-shell -p hark-desktop`、`cargo test --offline -p hark-native-shell`：lib 2 + bridge probe 5 + flow 9。原 9+3 仍在。新增：取消后 retry 真子进程重绑、停滞 hook 的有界 stop、真实 Node flood 证明 ingress cap=64。
- `npm run typecheck`、`test:pi-sdk-smoke`（1）、`test:host`（14）、`probe:host-stdio`：通过。Host 未改。stdio probe 的 `coreBridge=not-connected` 不与 Rust 联合 probe 混淆。

联合 retry probe 使用合成目录和 scripted SSE，不是 StepFun。stderr 断言不含合成 key。没有私人目录，没有外网。

## 残留

- Rust ingress cap 证明的是 `start()` 使用的同一个 `read_stdout`，外加真实 Node 子进程写 200 帧。没有把活动 Pi run 故意灌满 64 帧。不能把这写成整份 IPC 合同已由实机会话灌满。
- 已进入内核且不返回的单次 read/open 仍不可打断。停滞证据是测试 hook，不是真实卡住的 syscall。超时 stop 不宣称 `exited=true`，也不并发复活同一 Core 任务。
- Windows Job Object 未实现。窗口点击、托盘、安装包、常规对话、Memory、真实模型未验。
