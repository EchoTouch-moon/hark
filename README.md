# Hark R1

正在从保留完整历史的同一仓库建立 **Tauri 2 + Rust Core + TypeScript Pi SDK Host + SQLite** 新产品工程。当前不是可安装 R1 成品。

- 产品基线：[PRD v0.5.1](Hark-R1-Desktop-Personal-Agent-PRD-v0.5.1.md)（保留原 DRAFT 标记；已获批准用于本轮开发）
- 开发指令：[AGENTS.md](AGENTS.md)
- 实施计划/边界：[docs/r1/IMPLEMENTATION-PLAN.md](docs/r1/IMPLEMENTATION-PLAN.md)
- 实际交付状态：[handoff/STATUS.md](handoff/STATUS.md)

已交付并在本机验证：Rust/SQLite 受控读取与授权、嵌入式 Pi SDK Host、Tauri 开发壳、首次开场的真实 Rust↔Node stdio 与持久化恢复。当前模型响应仍为明确合成 transport；正式 React 前端、常规连续对话、Memory/研究与双平台成品尚未交付。

## 开发运行
```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:host
cargo test --manifest-path crates/hark-core/Cargo.toml --offline
cargo test --manifest-path apps/desktop/Cargo.toml --offline -p hark-native-shell
cargo run --manifest-path apps/desktop/Cargo.toml -p hark-desktop
```
桌面命令是开发启动，不是安装包。默认模型关闭；不要为测试选择私人 vault。前端接入见 [FRONTEND-HANDOFF](docs/r1/FRONTEND-HANDOFF.md)。

## StepFun 当前接入
正确套餐接口为 `https://api.stepfun.com/step_plan/v1/messages`、模型 `step-3.7-flash`，直接HTTP已实测200/OK；现正接入PiSDK的anthropic-messages协议。SDK流式/工具与桌面模型闭环尚未通过。

旧独立验收脚本使用通用API，不适用于此次套餐，不再扩建。原3次真实调用许可已用完，Key已撤销；不要重新运行旧脚本。后续真实请求需单独批准，不自动使用聊天历史Key或全局凭据。

## 历史参考
旧 `docs/01-PRD.md`、`docs/04-CONTRACTS.md`、`docs/05-SECURITY.md`、`docs/mvp/`、`tasks/REBUILD-PLAN.md`、`tasks/manifest.json` 与旧 handoff/证据保留研究价值，不是新 R1 的施工基线或验收通过记录。不要求旧 Schema、接口与 fixture 服务兼容。

当前分支 `dev/r1-desktop` 从本机已有 `origin/master` 建立。未推送、未合并/关闭 PR；原开发工作区及未提交改动保持不动。
