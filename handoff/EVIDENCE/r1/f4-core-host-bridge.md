# 首次开场 Core ↔ Host stdio

状态：verified-local。不是产品通过，不是 StepFun，不是常规对话 run。

## 合入

- Host `2b9ac8c`、`40dae61`，base `2dc8570`。
- Native `ca0efb3`、`8ca7617`，同一 base。
- 文档冲突按段落保留 F1 与两边修复。未覆盖 AGENTS 或 parent-review。未推送。

## 本段实现

- Rust 发放 `mark_analyzing`，构造 `run.start`。opening 不带 `userMessageId`，不插入 Hark 用户消息。
- 每次 `workspace.overview` 从当前 Core 授权生成 `authorization.current`。Core `enabled` 映射 Host `active`。
- `workspace.read_file` 先复查授权，再走 Core 受控读取。source id 只来自这次真实读取，有每 run 预算。
- 合法 `stream.done` 后才 `commit_agent_opening`。取消、撤权、超时、跨 workspace/run、迟到消息不提交、不折叠。
- `sessionBinding` 写在现有 onboarding `evidence_json`。无新 migration。重启后同一 sessionRef，不重复开场或用户消息。
- Unix 进程组：关 stdin、SIGTERM、SIGKILL、wait。完全 stop 或 drop 后本切片受管理进程不在。Windows 无 Job Object，Sidecar 默认不启用。
- 未配置时不启动、不读 Key、不发请求，`connected=false`。合成许可只在 Rust 内部测试接口，未注册为前端命令。

## 本机命令

- `cargo fmt -- --check` 与 `cargo test --offline`（hark-core）：47 项通过。原 46 项仍在，新增 sessionBinding 1 项。
- `cargo fmt -p hark-native-shell -- --check`、`cargo check --offline -p hark-native-shell -p hark-desktop`、`cargo test --offline -p hark-native-shell`：服务 9 项 + 联合 probe 3 项通过。
- `npm run typecheck`、`npm run test:pi-sdk-smoke`、`npm run test:host`、`npm run probe:host-stdio`：通过。Host 测试 14 项，其中 1 项是 opening 可空 userMessageId；原先 13 项仍通过。SDK smoke 网络/子进程尝试为 0。

联合 probe 脱敏输出：

```text
BRIDGE_EVIDENCE {"nodePid":35331,"runId":"run_0ce4c13d48e84529887aee5a849f65d7","sessionRef":"pi:01a1aeb0-79d1-751d-8d9e-647a34f73169","sourceId":"src_06b972321afd4b1da4a1f9665b3399ef","transport":"scripted","stepFun":"unverified","userMessages":0,"openingCount":1,"groupAliveAfterStop":false}
```

README 字节与 Core source sha256 在测试内比对。transport 是本地 scripted SSE，不是 StepFun。没有真实 Key，没有私人目录，没有外网调用。

## 未验

窗口点击、托盘、安装包、Windows、真实模型、常规对话 run、Memory/FTS/搜索。Node 是本机预装开发路径，不证明可安装无预装运行时。

父会话随后复现取消后重绑、状态源和有界 stop/队列缺口。本机收口见 `f4-bridge-lifecycle-fix.md`，不把本节原 PASS 当成那些缺口已覆盖。
