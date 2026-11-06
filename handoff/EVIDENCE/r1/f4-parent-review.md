# Core ↔ Host 首次接线主会话复核 · 7f54a2c

## 实跑
父会话在集成主线实际复跑：
- Core fmt/test --offline：47 项通过。
- Native fmt/check（含 desktop）/test：9 项服务 + 3 项真实子进程管道 probe，通过。
- npm typecheck、SDK smoke 1 项、Host/IPC 14 项、Host stdio probe：通过。Host-only probe 的 coreBridge=not-connected 不与 Rust 联合 probe 混淆。
- 联合 probe 约 15 秒完成，真实 Node/SDK/SQLite/自建磁盘目录，模型响应是明确的 scripted SSE，不是 StepFun。

## 确认需修
**P1：取消后重试会被旧 SessionBinding 阻断。** 父会话用临时 Rust probe 链接本次 Core，执行：发放 run A → bind session → cancel → retry → 发放 run B → 为 B 绑定 Session。实际 `fresh_run_session_rebind_ok=false; error=Some(CorrelationRejected)`。`bind_session_tx` 在确认请求 run 是当前 run 后，仍将 metadata 中上一 run 的 binding 当成不可更换的同一绑定。需允许 Core 合法发放的新 run 更新当前业务引用，同时拒绝旧/伪 run 与同 run 任意改 session，保持重启/幂等。

**当前可达源码缺口：异常退出后的 Native 状态可能陈旧。** SidecarSupervisor.status 为自身 Mutex；start 另建 Arc<Mutex<SidecarStatus>> 给 worker，ready 后只复制一次到自身。EOF/异常由 worker 更新的不是 status() 读取的同一对象，可能 UI 仍 connected=true。需统一同一份状态并实际 kill/EOF probe 验证。

## 必须收口的当前桥接约束
- Rust stdout reader 向 `mpsc::channel` 无界投递，不能仅用 Node SideQueues 单测就称 Rust 接口已满足有界队列；需要明确 frame ingress cap，过载可解释拒绝/暂停，取消与 stop 不能被满队列卡死。
- SidecarSupervisor.stop 在 5 秒 reply timeout 后仍无条件 JoinHandle.join，可能突破文档有界退出承诺；请对停滞 reader/worker 做受控有界验证，不能记录超时后继续无界等。已进入内核的文件 syscall 不可打断应保持限制，不因此令 UI quit 无限等待。

本轮只收口新桥接代码的重试/状态/资源边界；不扩 Observer、常规对话、Memory、Windows 或真实模型 Gate。修复后复跑受影响回归，再决定接受此本机接线切片。

## 定向收口复核 · 9f9bb01
父会话检查 SessionBinding 更新/归档、共享状态 Arc、Rust bounded ingress 与 stop/reap 边界的 diff，并以 `set -euo pipefail` 实际复跑：Core fmt/test 48 项，Native fmt/check（含 desktop）与 lib2+bridge5+flow9，共16项，全通过。原父会话独立 probe 重链新库后，实际 `fresh_run_session_rebind_ok=true; error=None`。

已接受：合法当前 run 替换已结束 run 的 Session 引用、旧/伪 run 仍拒绝；worker 与 Native 读同一状态；64-frame ingress 有真实 Node flood 证明；满队列不堵取消控制；有界 stop 不把未结束 worker 报成功，已 kill 子进程用 WNOHANG 回收；取消→重试→Core 提交探针通过。停滞测试的屏障失败清理已收口，不再用120秒 opening超时掩盖失败。

**裁决：接受此本机首次开场底座接线切片。** 已验证真实磁盘/SQLite/Node子进程/PiSDK/管道与恢复，transport仍是明确合成SSE，不是StepFun或完整R1产品通过。Native窗口点击、安装包、Windows/JobObject、真实模型和常规连续对话仍需独立交付。已进入内核的 syscall 不可打断、测试hook不等于真实磁盘永久挂起压测、未对活动Pi会话填满整条OS管道的限制继续保留。

后续本机修复记录见 `f4-bridge-lifecycle-fix.md`。本文件保留复核当时的缺口，不改写成已通过。
