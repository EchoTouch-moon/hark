# 10｜连接器与执行器实现步骤

## Hermes（推荐由 M1 mock → M2 read-only 测试）
官方文档： https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration
- 首选 **HTTP API Server** 作为最小解耦 adapter：本机 capabilities/health 探测、`POST /v1/runs` 创建 run、`GET /v1/runs/{id}` 状态、`GET /v1/runs/{id}/events` SSE、停止/审批（具体按 capability）。
- 官方示例使用 loopback `127.0.0.1:8642`，由本机配置决定；禁止把示例凭据复制进仓库。以 `/v1/capabilities` 为实际能力权威。
- 新建 `HermesAdapter` 要区分 `not_configured`/`unavailable`/`ready`，没有凭据不能尝试“替用户连接”。
- `completed` 只表明 Hermes run 层已结束，不代表 Hearth 具体 task 完成；必须 `Verifier` 校验 artefact 或读取后端受信状态。
- API 的 `run.interrupted`, `run.failed`, `run.cancelled`, `partial` 映射必须保守处理；不能把非成功终态标成功。网络中断后优先 readback，不盲重试。
- **不要直接让 Hermes 读真实私人 vault**；在 Hearth 输入裁剪后的模拟或用户明示授权工作集。
- 需要细粒度会话/批准可未来切 `TUI gateway JSON-RPC`，由 ADR 记录取舍；API 与 gateway 不应同时对同一 run 不协调操作。

## Local vault（仅设计合同，夜间不访问）
- 真实位置来自用户 config，并且必须逐目录 allowlist，初始列表为空。
- 通过路径规范化+ realpath 限制，仅只读、单向同步到事件索引；默认屏蔽敏感字段、credentials、Policies/secret 类目录。
- 读取 `.md` 之后要保留 file URI、mtime、hash、ACL，模型推断不得回写权威文件；测试使用 `fixtures/vault-mock/*.md`。
- 撤销授权→停止 watcher → 阻止未来 retrieval；不擅自删除原文件。

## GitHub（后续）
- M2 可先用**手动导入的合成 GitHub 事件 fixture**、然后在明确授权范围内只读接入项目仓库；生产凭据 OS Keychain 或用户批准 secret store，不进 `.env.example` 真值。
- Repository scope 只读，当前仓库 PR/CI/Issue polling 要保留 cursor/ETag/observedAt 并限流；未读到数据不能说“没有 PR”。
- commit/issue/PR 写入属于 L2，首晚不允许，不作为是否完成的条件。

## Browser / Stagehand（M3）
- Browser context 使用专用不持久 profile，下载目录位于 sandbox demo 路径，allowlist 初期仅 `http://127.0.0.1` 的本项目 mock site。
- 固定站点先用 Playwright 选择器/状态断言；不确定网页才使用 Stagehand action/extract，操作全程按 step 留 trace。
- `context` cookie 隔离不等价 OS 沙箱；禁用任意终端/文件上传/跨站跳转/支付等。

## Desktop/Tauri（M3）
- 在纯 web 本地版本稳定之后封装 Tauri2；capabilities 只开放被明确用到的窗口/命令，server 仍执行核心 Policy Gate；没有本机 Rust/Xcode 工具链不阻塞 M1。
