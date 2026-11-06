# F2 Host sidecar

这不是 Rust↔Host 桥接，也不是 StepFun 或产品通过。另一 lane 的 Native 壳不在本 worktree，本文件不记录它的结果。

范围：`packages/agent-host/**`、根 `package.json` scripts、本段 handoff/架构状态。未改 Rust、migration、`contracts/ipc-v1` envelope、AGENTS、Pi/Hermes 全局配置。未 merge、未 push。未读真实 Key，未外发模型或搜索。

## 环境

- Node `v22.23.2`。开发保底仍是 Node `>=22.19.0`。Bun 仍只是候选。
- Pi 精确锁 `@earendil-works/pi-coding-agent` / `pi-ai` `1.5.0`。
- `ModelRuntime.create` 的公开选项没有 `authContext`。已核对 `CreateModelRuntimeOptions` 与 `model-runtime.js`。

## 实际命令

均未用管道吞掉退出码。脱敏副本：

| 命令 | 退出码 | 副本 |
|---|---|---|
| `npm run typecheck` | 0 | `f2-host-typecheck.txt` |
| `node --experimental-strip-types --test packages/agent-host/test/sandbox-smoke.test.ts` | 0 | `f2-host-sdk-smoke.txt` |
| `node --experimental-strip-types --test packages/agent-host/test/ipc.test.ts packages/agent-host/test/host-runtime.test.ts` | 0 | `f2-host-tests.txt` |
| `node --experimental-strip-types packages/agent-host/scripts/stdio-probe.ts` | 0 | `f2-host-stdio-probe.txt` |

复跑：仓库根执行 `npm run typecheck`、`npm run test:pi-sdk-smoke`、`npm run test:host`、`npm run probe:host-stdio`。

## 已验证的本机行为

- Sidecar 嵌入 SDK，不调用 Pi CLI。stdout 为 NDJSON。stderr 不包含合成 key `synthetic-key-do-not-log`。
- 真实 SDK 的 all/active/callable 只有 `workspace.read_file` 与 `workspace.overview`。没有 read/bash/edit/write/grep/find/ls/powershell，没有 `mcp__`，没有 memory/opinion 工具。
- 模型工具参数不含 workspace/run/operation。Host 绑定这些字段。
- `run.start` / `stream.delta` / `stream.done` 与反向 `tool.request` 可交错。读循环不阻塞等待 tool.result。
- 取消后的成功 `stream.done` 不出现。跨 workspace/run、重复 id、迟到成功由同一 correlation gate 拒绝。
- 队列 64 的 overflow 由 sidecar 使用的 `SideQueues` 单测证明。拉起的进程会在活动 run 上关闭 stdin，并暂停 stdout。没有把 OS pipe 堵到内核容量。
- 关闭的 provider 槽、`current: false`、pack 重建失败都不会调用 fetch。
- hook 抛错后，最终 OpenAI 兼容 payload 仍是当前 revision，不是旧 pack。重建失败则不发送。
- 10 轮 JSONL 不把 revision 写入 user 消息。快照变化后 payload 使用新 revision。原 Session 恢复不重复灌入同一条 user 消息。
- 无法过滤的 compaction 走官方新 Session。旧摘要不在 provider payload。新 Session 的近期消息按目标 Session 的 `handoffId` 注入一次。原 Session 恢复不重复灌。另一个新 Session 不会被工作空间里已有的同一个 id 挡住。
- Provider HTTP body 来自 Pi `openai-completions` `streamSimple`，由测试 fetch 拦截，不走 global fetch。faux 没有冒充这条线协议。
- SDK smoke 仍通过。Vertex ADC 探测计数为 0，因为刷新前注册了字面 closed key，不再只靠测试 guard。

## 接口

- 不新增 IPC method。授权复查复用 `tool.request` `workspace.overview`。
- DTO：`packages/agent-host/docs/host-dto.md`。
- 运行：`node --experimental-strip-types packages/agent-host/src/sidecar.ts --app-data <dir> [--provider-config <file>] [--scripted-transport <file>]`。scripted transport 必须在 app-data 内，只用于开发 probe。
- Host 响应含 `sessionRef`（`pi:<uuid>`）、`sendPermit: false`、`committedByHost: false`。开场仍要 Rust `commit_agent_opening`。

## 未验证

- 真实 Rust Core、真实目录、真实 Key、StepFun endpoint/stream/tool/billing。显式 stepfun 槽不再被字符串拒绝，但仍未真机验证。
- Memory Engine、FTS、MCP、搜索、进程监督、Windows Job Object、安装包。
- OS 级 stdout 背压下的队列溢出。codec 上限已测，pipe 堵满未测。
