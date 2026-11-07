# Hark R1

正在从保留完整历史的同一仓库建立 **Tauri 2 + Rust Core + TypeScript Pi SDK Host + SQLite** 新产品工程。当前不是可安装 R1 成品。

- 产品基线：[PRD v0.5.1](Hark-R1-Desktop-Personal-Agent-PRD-v0.5.1.md)（保留原 DRAFT 标记；已获批准用于本轮开发）
- 开发指令：[AGENTS.md](AGENTS.md)
- 实施计划/边界：[docs/r1/IMPLEMENTATION-PLAN.md](docs/r1/IMPLEMENTATION-PLAN.md)
- 实际交付状态：[handoff/STATUS.md](handoff/STATUS.md)

已实现并在本机验证：Rust/SQLite受控读取与授权、Pi SDK/stdio开场与普通聊天、用户React界面的真实Native接入、页面模型配置、记忆/观点修订、反馈/撤销与历史检索。普通对话可通过Pi工具提交记忆/观点并显示Core收据，重启可恢复。

联合测试模型响应是明确合成transport；真实StepFun接口曾仅做直接文本连通验证，用户新Key下的应用流式/工具/体验尚未验收。opening记忆写入、自动L0/L1、联网研究、Observer与双平台安装成品仍未交付。认知工具说明见 [MEMORY-HANDOFF](docs/r1/MEMORY-HANDOFF.md)。

## 开发运行
```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:host
cargo test --manifest-path crates/hark-core/Cargo.toml --offline
cargo test --manifest-path apps/desktop/Cargo.toml --offline -p hark-native-shell
npm run typecheck:ui
npm run test:ui
npm run build:ui
```
现有React初版已迁入 `apps/desktop/ui`，保留原有界面并默认使用真实Native适配。开发启动需两个终端（均在仓库根目录）：
```bash
# 终端1：保持Vite运行在127.0.0.1:1420
npm run dev -w @hark/desktop-ui
```
```bash
# 终端2：启动Tauri开发窗口
cargo run --manifest-path apps/desktop/Cargo.toml -p hark-desktop
```
直接 `cargo run` 不会代为执行Tauri CLI的 `beforeDevCommand`；不能只开Native就假定Vite已启动。这是开发入口，不是安装包。默认模型关闭；普通聊天Native接线与页面模型配置已实现。桌面「应用设置」填写新Key并选择「仅本次运行保存」，再到「工作空间设置」启用模型后主动发送。Key重启需重填，Workspace授权会保留；保存不自动测试。未完成功能不回退为预览数据。不要为测试选择私人vault。尚无本轮窗口点击验收。

## StepFun 当前接入
正确套餐接口为 `https://api.stepfun.com/step_plan/v1/messages`、模型 `step-3.7-flash`，直接HTTP曾实测200/OK。PiSDK anthropic-messages驱动与页面配置已接入，合成流式/工具回归通过；用户新Key下的真实应用闭环尚未验证。详见 [MODEL-SESSION](docs/r1/MODEL-SESSION.md)。

旧独立验收脚本使用通用API，不适用于此次套餐，不再扩建。原3次真实调用许可已用完，Key已撤销；不要重新运行旧脚本。后续真实请求需单独批准，不自动使用聊天历史Key或全局凭据。

## 历史参考
旧 `docs/01-PRD.md`、`docs/04-CONTRACTS.md`、`docs/05-SECURITY.md`、`docs/mvp/`、`tasks/REBUILD-PLAN.md`、`tasks/manifest.json` 与旧 handoff/证据保留研究价值，不是新 R1 的施工基线或验收通过记录。不要求旧 Schema、接口与 fixture 服务兼容。

当前分支 `dev/r1-desktop` 从本机已有 `origin/master` 建立。未推送、未合并/关闭 PR；原开发工作区及未提交改动保持不动。
