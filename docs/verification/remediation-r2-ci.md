# R2 · README 与最小 CI 交付记录

日期：2026-10-29。执行基线：R1 `1642215`；这里只负责 README/CI，不替代 R2 的模型隐私、反馈和人工建议评分验收。

## 变更

- 首页改为已实现的项目观察 → 确定性 Insight → 用户预览确认后 Pi 分析的真实路径；明确只读、有限文档上下文、Chat 仍 Mock、旧 Demo 需显式开启、数据库/凭证不跨设备同步。
- 明确当前分析不是代码审计，引用身份匹配不证明模型结论，真实分析可能外发预览内容并产生费用。文件排除和敏感检测不是保密保证。
- 原首页字节不变地归档至 `docs/archive/README-planning-v1.md`，不删除最初规划。
- 新增 `.github/workflows/ci.yml`：master push、pull_request、手动触发；Ubuntu、Node 22、pnpm 11.9.0；锁定安装、typecheck、lint、test、build、Chromium Mock E2E。单 job 20 分钟，contents 只读权限，同一 ref 的过时运行自动取消。现有 lint 警告不会被额外升级为失败。
- 测试环境显式 `HEARTH_ANALYSIS_PROVIDER=mock`、`HEARTH_PI_BIN=/nonexistent/live-provider-disabled`；现有 Playwright 配置进一步固定 Mock、合成数据和独立 e2e 数据库。CI 不引用任何模型凭证或用户仓库路径。

## 官方版本核验

通过本机已登录的 `gh api` 读取官方仓库，不读取或输出凭证。2026-10-29 实际取得：

| 组件 | 版本 / commit | 依据 |
|---|---|---|
| checkout | v7.0.1 / `3d3c42e5aac5ba805825da76410c181273ba90b1` | [官方 commit](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1) |
| setup-node | v7.1.0 / `949feb2413d6458794dcd2491c4babbbce0c15c1` | [官方 commit](https://github.com/actions/setup-node/commit/949feb2413d6458794dcd2491c4babbbce0c15c1) |
| pnpm/action-setup | v6.1.0 / `ea17c68df8912ef543352723c149a84f56e3d413` | [官方 action.yml](https://github.com/pnpm/action-setup/blob/ea17c68df8912ef543352723c149a84f56e3d413/action.yml) |
| pnpm | 11.9.0；Node `>=22.13` | [官方版本 package.json](https://github.com/pnpm/pnpm/blob/v11.9.0/pnpm11/pnpm/package.json) |

Action 以完整 commit SHA 引用。pnpm setup 的自身运行时为 node24，与 job 中由 setup-node 安装并用于项目检查的 Node 22 是两个概念；使用 GitHub 托管 `ubuntu-latest` runner。pnpm setup 官方输入含 version/run_install/cache，均已核对。Node 22 选择该主版本最新维护版，满足项目和 pnpm 11.9.0 的最低 22.13 要求。

## 本次真实检查

| 检查 | 结果 |
|---|---|
| YAML 解析 | PASS，Ruby 标准库 YAML；PyYAML 在本机不可用，未安装额外工具 |
| Workflow 合同断言 | PASS：触发器、只读权限、固定 SHA、Mock 环境、命令顺序 |
| README 本地链接 | PASS，所有本地 Markdown 链接存在 |
| 归档保真 | PASS，归档字节与基线 HEAD:README.md 一致 |
| 所属文件 diff-check | PASS |
| actionlint | NOT_RUN，本机无此工具；YAML 解析不等同于完整 Actions 语义验证 |
| GitHub 实际 CI | **NOT_RUN**，本子任务不提交/推送；须由主线提交后触发并监测，不能将本表当远端通过 |

本任务没有改动源码、package、锁文件或测试配置，没有执行真实模型请求。全仓检查、远端运行与平台差异由主线统一收口。首次 Linux 运行可能揭示 macOS 本地检查未覆盖的差异；如果失败，应保留错误并修复后再报告通过。

## 主线远端验收结果

PASS：[GitHub CI Run 40836527163](https://github.com/EchoTouch-moon/hark/actions/runs/40836527163)，提交 `00121a273d594107fbcf337ef9ee48949b79278d`，Ubuntu托管runner / Node22，job 2m31s。frozen install、typecheck、lint、unit/integration、完整build、Chromium依赖和Mock E2E全部通过；6个既有lint warning未升级为error。结构化实际结果见handoff/EVIDENCE/r2-ci-run.json。此处更新覆盖上面子任务交付时NOT_RUN状态。

R2人工价值门禁仍未通过；远端绿色不等于建议质量达标。后续文档记录提交不改变已验收源码。
