# Pi SDK 隔离 smoke

这不是正式 Core 读取 Host 接入，也不是 F2 产品通过。F1#3 未修。F1#1/#5 未经父会话复跑。正式 Host 仍受 Core 合并复核阻塞。

范围：`packages/agent-host/**`、根 workspace、精确 lock、strict TS、本证据。未改 Rust、migration、contracts、Tauri、前端、AGENTS、Pi 或 Hermes。未 merge、cherry-pick 或 push。未调用模型，未读全局 auth/models/settings 或私人目录。

## 环境

- Node `v22.23.2`，npm `12.0.2`。开发保底是 Node `>=22.19.0`。
- Bun 仍只是候选。本段不宣布打包选择。
- 依赖安装使用 npm registry。安装进程不属于 SDK smoke，也不计入下面的零外网断言。

## 锁定

直接依赖：`@earendil-works/pi-coding-agent@1.5.0`、`@earendil-works/pi-ai@1.5.0`、`typebox@1.3.27`、`zod@3.24.2`。
lockfile 中每个 `@earendil-works/*` 包均为 `1.5.0`，包括未直接 import 的 `pi-agent-core`、`pi-mcp`、`pi-codemode`、`pi-tui`、`pi-schema`、`pi-telemetry`。测试断言了这一点。

## 构造

`createIsolatedPiSession` 同时传入：

- 自建临时 `cwd` / `agentDir` / `sessionDir`，不是用户项目，也不是 `~/.pi`
- 内存 `CredentialStore`：`read` 恒为空，`modify`/`delete` 拒绝写盘
- `ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`
- `fauxProvider` 经 `registerNativeProvider` 注册。这不是 StepFun，也不是 OpenAI 线协议
- `SettingsManager.inMemory`：`compaction.enabled=false`、`retry.enabled=false`、`cacheWarming:"off"`、`enableInstallTelemetry=false`
- 空 `ResourceLoader`，不调用 `DefaultResourceLoader.reload()`
- 纯名字 allowlist `tools: ["hark.smoke_noop"]` 加一个无能力 custom tool
- 不调用 `bindExtensions`，不开放 Core 路径

已核实并写入测试，而不是只引用侦察报告：

- `noTools: "builtin"` 不能当隔离。`getAllTools()` 仍含 `read` 和 `bash`，custom tool 仍在。
- `noTools: "all"` 会滤掉 custom tool。`hark.smoke_noop` 不在 `getAllTools()`。
- 生产构造只用纯名字 allowlist。allowlist 会话的 `getAllTools` / `getActiveToolNames` / `getCallableToolNames` 都只有 `hark.smoke_noop`。不含 `read/bash/edit/write/grep/find/ls/powershell`，也不含 `mcp__`。

## 实际命令

均 `set -o pipefail` 语义下退出码 0。脱敏副本：

- `handoff/EVIDENCE/r1/pi-sdk-sandbox-smoke-typecheck.txt`
- `handoff/EVIDENCE/r1/pi-sdk-sandbox-smoke-test.txt`

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm run test:pi-sdk-smoke` | 0 |

复跑：仓库根执行上述两个 npm script。测试用 `node --experimental-strip-types --test`。

## 通过的边界

- 临时项目里的恶意 `.pi/extensions/evil.js` 没有写出执行标记。`AGENTS.md` sentinel 没有进入 system prompt。空 loader 的 extensions/skills/agentsFiles 为空。测试层记录的项目资源读取为 0。
- 一次 faux `prompt` 后，JSONL 写在自建 `sessionDir`，header `cwd` 是该临时目录。用户 prompt 只出现一次，assistant provider 是 `faux`，不是 `stepfun`。
- `SessionManager.open` 恢复同一文件后，没有再次注入用户消息。JSONL 字节数不变，prompt 仍只出现一次。
- 测试层拦截了 `fetch`、socket/HTTP/DNS 和 `child_process`。SDK smoke 期间这些外向尝试为 0。拦截不靠会被 SDK 吞掉的 hook throw。自检确认 ESM `spawn` 和 `fetch` 会被该层拒绝。
- 全局 `~/.pi` 与私人 vault 探测记录为 0。受控 `agentDir` 没有生成 `auth.json` / `models.json` / `settings.json`。

## 明确未测，不伪 PASS

- Provider 最终 HTTP payload。faux stream 不产生 OpenAI 线协议 body，也没有用自定义 `fetch` 捕获 `onPayload`。字段标 `untested`。
- 真实 StepFun、MCP、stdin/stdio 宿主、Rust 双向 Tool/服务授权、L0/L1、compaction 大测试。本段关闭了自动 compaction，但没有测量压缩摘要。
- Bun 动态插件与打包选择。
- F1#3 取消后开场收据，F1#1/#5 父会话复跑，正式 Host 接 Core。

## 残留

`registerNativeProvider` 会在 SDK 内安排一次离线 availability refresh。该刷新对内置 `google-vertex` 调用 `fileExists("~/.config/gcloud/application_default_credentials.json")`。本段测试记录 6 次该 basename，测试层拒绝且没有打开文件。这不是网络请求，也不是 `~/.pi` auth/models/settings。不能据此声称 Host 永远不会探测环境凭据路径。构造参数无法关掉这次 SDK 内部刷新。
