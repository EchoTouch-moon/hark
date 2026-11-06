# F2 Host seam fix

这不是 Rust↔Host 桥接，也不是 StepFun 真机或产品通过。合成 Core 与拦截 transport 都标了合成。未改 Rust、migration、IPC envelope、AGENTS、Pi/Hermes。未 merge，未 push。未读真实 Key，未联网。

上一轮 reviewer 因 403 没有最终 verdict。本文件只记录本轮定向负例和修复后的复跑。

## 修法

1. Host 全局只接受一个活跃 run。其他 Workspace 的 `run.start` 返回 `correlation_rejected`，message 含 `host busy`。不覆写当前 gate。不新增错误码，不建队列或多 worker。
2. overview 带来新 revision/sourceVersion 但没有新正文时，不发送，也不回贴 run.start 的旧 identity/overview。
3. stdin EOF、stdout error、解析失败会幂等关闭：abort 活动 run、拒绝 pending、清计时器、丢掉 stream 队列。堵住的 write 不再 kick 空转。
4. 每个新 Pi Session 一次有界 handoff。去重只看目标 Session。原 Session 恢复不重复灌。
5. `providerId: stepfun` 不再被型号字符串拒绝，也不改名。未启用、无显式配置或无凭据时仍关闭。`faux` 仍拒绝。非配置 URL 拒绝，注入 fetch 带 `redirect: error`。真实 StepFun 协议未验证。

## 命令

仓库根，`set -o pipefail`，退出码单独记录。

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm run test:pi-sdk-smoke` | 0 |
| `npm run test:host` | 0（13 项，含 5 个新负例） |
| `npm run probe:host-stdio` | 0 |

Node `v22.23.2`。Pi `1.5.0`。

复跑：`npm run typecheck`、`npm run test:pi-sdk-smoke`、`npm run test:host`、`npm run probe:host-stdio`。

## 未验证

- 真实 StepFun endpoint、流式、工具方言、计费。本轮没有请求 `api.stepfun.com`。
- OS pipe 内核容量未被故意填满。活动 run 的 stdin EOF 和暂停 stdout 已由拉起的 sidecar 在 3 秒内退出证明。
- Rust Core 未连接。`synthetic: true` 不是 Core 收据。
