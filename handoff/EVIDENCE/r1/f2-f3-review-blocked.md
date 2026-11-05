# Host / Native 候选审查中断与恢复

## 候选与实际验证
- Host：`dev/r1-host-runtime` / `2b9ac8c`，base `2dc8570`。父会话实跑 `npm run typecheck`、`npm run test:pi-sdk-smoke`、`npm run test:host -w @hark/agent-host`（8 项）、`npm run probe:host-stdio -w @hark/agent-host`，全部退出 0。Probe 标注 Rust Core 未连接、StepFun unverified。
- Native：`dev/r1-native-shell` / `ca0efb3`，base 同上。父会话在 `apps/desktop` 实跑 `cargo test --offline -p hark-native-shell`（7 项）与 `cargo check --offline -p hark-desktop -p hark-native-shell`，退出 0。
- Native writer 构建 macOS arm64 调试二进制并短暂启动的证据在其分支，父会话未把该记录当窗口点击、托盘、完整退出或安装包验收。
- 两个分支尚未合入主线；主线 F1 与隔离 SDK smoke 已通过的结论不受额度故障影响。

## 中断
两位 fresh-context Grok 4.7 high reviewer 因当前 xAI 路由返回 403（额度耗尽或需要订阅）失败。Workflow `d0946ef4-5bfd-4006-a0ba-4ff32b932de6` 已终结，两个 child `ok=false`。没有最终 review verdict，不可用外层 completed 推断通过。

失败后核验主线与两个候选工作区均 clean，无 reviewer partial source diff。保留所有提交，不清理 worktree，不切换模型/CLI，不循环重试。

## 父会话源码疑点：尚待定向回归，不冒称独立 reviewer 结论
1. `packages/agent-host/src/runtime.ts` 的 `providerGate/currentAbort/runtimePromise` 为 HostRuntime 全局状态，而 active Map 只禁止同一 Workspace 并发；executeRun 改写 gate.recheck。不同 Workspace 同时运行可能混用授权/上下文/取消。最小替代可先明确全局单活跃 run，而不是建设多 worker。
2. `recheck` 在读到新的 revision/sourceVersion 后，若 overviewText 缺失仍使用 run.start 的旧 identity/overview；旧内容不能只贴上新版本标签和 stale 提示就当当前事实。需返回可信完整新快照或拒绝/清空旧内容。
3. `input.end` 只设 stopped，未完成 active/pending 仍可能存活；drain 在 stopped 且 stream queue 非空时的 kick/while 条件可能形成反复调度。需实际 EOF/背压/取消探针，不只测队列类。
4. openSession 只有 compaction fallback 调 applyHandoff；其他全新 Session 是否丢最近对话需以新 manager/空索引负例检查，去重按目标 Session 证明。
5. `provider.ts::assertProviderSlot` 与 `runtime.ts::loadProviderConfig` 硬拒绝 stepfun/faux。禁止 faux 冒充真实产品合理，但 StepFun 应为未授权默认关闭、配置后待真实验证，而不是永久被型号字符串拒绝。不得用改名隐藏实际接收 Provider。

这些问题范围限当前 Host 路径及 PRD 已定约束，不要求补全未来 MCP/Windows 或另建治理平台。Native reviewer 只留下过程观察，没有最终发现，不据此编造 Native blocker。

## 最小恢复顺序
1. 用户恢复当前 Grok 路由或明确批准替代模型。
2. 验证候选 HEAD/工作区，原协议下完成上述 Host 定向审查与必要修复；Native 只读审查一次，修复再针对性复核。
3. 候选通过后串行集成，消费精确 DTO，让 Rust 构造当前授权对象、persist session refs、管理 sidecar 生命周期，跑真正 Rust↔Pi SDK 本地管道。
4. 真实 StepFun/私人项目/搜索、完整 UI、Windows 和安装包仍分别需授权/平台条件与证据，不由本次本地测试代替。
