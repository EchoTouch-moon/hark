# 11｜Architecture Decision Records

## ADR-001 复用 Hermes 而非重新发明 Agent
**Decision**：Hearth 自主负责发现/授权/验证；Hermes 通过接口负责可选执行。**Why**：避免重复记忆、工具编排；**Fallback**：MockAdapter。**Status**：已选择，真实机器集成待验证。

## ADR-002 先 Web localhost 后 Tauri
**Decision**：M1 在 Web + API 跑通，M3 再做桌面封装。**Why**：本机一夜内可测，降低 Rust/Xcode 依赖。**Consequence**：首版是浏览器本地 UI，而非 `.app`；不要在报告称已交付桌面 app。

## ADR-003 SQLite + Canonical Vault read-only
**Decision**：事件、任务、审计用 SQLite；真实个人 Markdown 权威库只读/需要授权。**Why**：低资源、可观察且不重复事实写入。**Consequence**：需 migrations/provenance/断连删除策略。

## ADR-004 Rule-first Proactive
**Decision**：先事件规则、过滤、排序，再可选 LLM 候选审查。**Why**：可控、便宜、可评测、可不使用模型；**Consequence**：无法期待初版产生神奇的开放式主动建议。

## ADR-005 Risk Gate Before Executor
**Decision**：server-side Action Registry + approval digest + verifier；**Why**：用户授权不能交给 LLM 自行理解。**Consequence**：通用 Handoff 必须推迟。

## ADR-006 No Docker / Minimal OS impact
**Decision**：原生 pnpm/node/sqlite，macOS 优先；Windows 支持命令跨平台。**Why**：磁盘限制、个人机器安全。**Consequence**：浏览器隔离强度不等于独立虚拟机。

## ADR-007 Demo ≠ Real
**Decision**：首晚合成 fixtures；所有 UI、日志、报告明示 Demo/Mock 状态。**Why**：能独立执行与验收，无真实账户和 Key 依赖。**Consequence**：业务“可演示”不等于真实互联网 Agent 可自动处理个人事务。

## ADR-008 不自动大规模改已有环境
**Decision**：不修改 Hermes / personal-vault / 其他现有项目，不自动推送远程仓库、不访问系统 keychain。**Why**：无人值守最小化不可逆操作。

## ADR-INSIGHT-001 P1 只读消费与存储隔离
详见 `docs/adr/ADR-INSIGHT-001.md`。**Decision**：P1 使用独立 `insights.sqlite`；不得把 P0 `listEvents`（`occurred_at DESC`）当作追加日志；JUnit `headBound` 恒为 false。**Status**：S0 契约冻结。

## ADR-INSIGHT-002 Observer v3 正序消费
详见 `docs/adr/ADR-INSIGHT-002.md`。**Decision**：全局 `observer_meta.append_seq` 与事件同事务发号；`listEventsForward` 按 `append_seq ASC`；项目硬删除保留 stream tombstone/`streamEpoch`；已删除事件不可回放。**Status**：S1.0 已落地。

## ADR-INSIGHT-003 S1.1 只读端口与 Signal
详见 `docs/adr/ADR-INSIGHT-003.md`。**Decision**：进程内 `ObserverReadPort` 只读；冻结 highWatermark；源重置映射 `SOURCE_RESET_REQUIRED`；Signal 身份可重放；不持久化 `proposedCursor`。**Status**：S1.1 已落地。

## 需在真机记录的 OPEN 决议
- Node 22 vs 24：以实际环境和兼容 lockfile 决定。
- pnpm/sqlite 驱动：视编译工具链与跨平台安装风险选择 `better-sqlite3` / `node:sqlite`（须评估 Node 版本支持），写 ADR。
- Hermes HTTP gateway 是否已启动、具体 capabilities、认证方式、工具批准事件。
- 由哪一个本地 HTTP server 负责 API/SSE、CSRF/Origin 防护设计。
- 是否在 M1 做 screenshot（headless browser 工具缺失时允许 BLOCKED）。
