# Hearth

> **产品定位（目标，不代表已实现）**：Hearth 是一个本地优先、以可信项目历史为基础、能形成可反驳且可修正观点的长期项目智能同行者。它适度主动提出有依据的建议，真实行动须由用户明确决定。  
> **产品主张**：让项目的生命，被看见、被理解、被延续。

## 我们为什么做 Hearth

不再把“项目专属聊天、长期记忆、任务自动化、多 Agent 编码”视为独占价值。与 TRAE 宝等更侧重任务组织和交付的助理相比，Hearth **优先证明**：项目事实与决定可以长期追踪；观点能解释依据、反例和改变理由；在适当时机主动呈现而不过度打扰；研究与模型有独立授权，**计划不等于执行权**。这是一项待真实验收的产品目标，而非竞品不具备相同能力的断言。

- [产品定位与 TRAE 宝差异化原则](docs/mvp/04-PRODUCT-POSITIONING.md)：产品边界、取舍、竞品证据与可复现验收
- [MVP 产品与行为合同](docs/mvp/01-PRODUCT-CONTRACT.md)：已讨论的目标、权限与体验要求
- [G0 需求及技术合同](docs/mvp/g0/02-contract-and-decisions.md)：待审的工程约束及分阶段实现

## 核心叙事 · 炉心 Ember

**一座主炉心，多段项目故事。** 对话是主要空间；火光由可信的项目事实和 `NarrativeState` 投影决定，交流只产生短暂回应，不能制造项目进展、完成度或已执行状态。没有可用项目证据时保持中性并说明原因。

视觉与交互说明见 [NARRATIVE.md](./NARRATIVE.md)；完整能力边界仍以本 README 的“当前能力与边界”为准。

---

Hearth 是本地优先的个人项目观察与分析工具。它读取用户登记的 Git 仓库和显式声明的 JUnit 报告，在本机记录事实、运行确定性洞察规则；用户需要时，再预览上下文并主动调用 Pi 获取建议。

当前主路径是 **项目 → 观察事实 → 洞察 → 人工触发分析**。它不自动修改被观察仓库、不自动运行项目测试、不自动调用付费模型，也没有主动通知。现有分析只使用有限的项目元数据与文档摘录，**不是代码级审计**。

## 当前能力与边界

| 能力 | 当前行为 |
|---|---|
| 项目观察 | Git 状态、HEAD、工作区摘要、已声明 JUnit 报告；只读、可暂停 |
| 后台洞察 | Observer → Signal Inbox → 确定性规则；使用持久化检查点，重启恢复、重复去重、断流冻结 |
| 项目分析 | 默认 Mock；显式配置 Pi 后，用户预览并确认本次上下文才发送；失败不会回退 Mock |
| 建议卡 | 结论、来源引用、风险和下一步；引用匹配不等于结论已被独立核实 |
| 对话 | 仍是离线 Mock 演示，不连接真实模型 |
| 旧 Demo | 需显式启用，使用合成事件演示发现、审批、执行、核验闭环 |
| 多端同步 | GitHub 同步源码和文档；数据库、登录凭证和项目登记不跨设备同步 |

R0 正确性修复、R1 后台规则消费的验证记录见 [R0](docs/verification/remediation-r0.md) 与 [R1](docs/verification/remediation-r1.md)。R2 的远端 CI 和真实建议人工评分是独立验收项；历史真实 Pi 请求成功不能代替当前质量门禁。

## 快速启动

需要 **Node.js ≥22.13、pnpm 11**；macOS 优先，CI 使用 Linux。SQLite 使用 Node 内置 `node:sqlite`，不需要 Docker。

```bash
git clone https://github.com/EchoTouch-moon/hark.git
cd hark
pnpm install --frozen-lockfile
pnpm build
pnpm dev:server
```

打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)，在「项目」登记要观察的本地 Git 仓库；需要测试事实时，显式添加 JUnit 报告相对路径。没有可用报告时，测试状态保持 `UNKNOWN`。Hearth 不会替你运行该项目的测试。

默认 `HEARTH_DEMO=0`，不自动导入演示数据。服务只允许 loopback 监听；当前会话机制不是远程账户认证，不要用它公开共享服务。前端开发可另运行 `pnpm dev:web`，默认端口 5173。

要体验旧 Demo，请显式开启并使用独立本地数据库：

```bash
HEARTH_DEMO=1 HEARTH_AUTOSEED=1 \
HEARTH_DB=data/demo.sqlite \
HEARTH_OBSERVER_DB=data/demo-observer.sqlite \
HEARTH_INSIGHT_DB=data/demo-insights.sqlite \
HEARTH_ANALYSIS_DB=data/demo-analysis.sqlite \
pnpm dev:server
```

不要同时运行占用相同端口或同一数据库的实例。后续启动真实项目模式时，不沿用上述 Demo 数据库变量。

## 模型与隐私

**本地优先不等于模型调用时数据不出本机。** 后台观察与规则洞察在本机运行；只有用户明确触发的真实 Pi 分析才会把预览内容发送给所选模型服务，可能产生费用。

分析上下文包括项目的 Git/测试摘要、事件、目标洞察和允许列表内的有限文档摘录。调用前可查看内容和模型身份，排除项目敏感路径，再确认本次上下文；内容改变后需要重新确认。敏感信息检测只是有限保护，不能保证任何文档都可安全外发。不要对保密项目启用远端模型，也不要把密钥写进项目文档或提交到 Git。

默认使用 Mock，Mock 卡片会明确标识。真实 Pi 需要每台机器单独完成 Pi 登录和显式 Provider/模型配置，例如：

```bash
export HEARTH_ANALYSIS_PROVIDER=pi
export HEARTH_PI_PROVIDER=stepfun-plan
export HEARTH_PI_MODEL=step-5-preview
# 仅指定已安装且已审阅的 Provider 注册扩展；路径按本机配置。
export HEARTH_PI_PROVIDER_EXTENSION=/absolute/path/to/pi-provider-stepfun/src/index.ts
pnpm dev:server
```

Pi 调用禁用工具、MCP、自动扩展/上下文发现及会话保存；仅加载显式指定的受信任 Provider 扩展。`--offline` 仅关闭启动联网，不阻止本次模型请求。扩展本身是本地可执行代码，这些参数不是通用安全沙箱。Hearth 不复制或输出 Pi 密钥；原始模型服务错误不直接写入运行记录。

## 开发与验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

[GitHub CI](.github/workflows/ci.yml) 使用 Node 22、pnpm 11.9.0 和锁定依赖，执行类型检查、静态检查、单元/集成测试、构建和受控 Chromium E2E。E2E 仅使用 Mock、合成数据和独立数据库；CI 不持有真实模型凭证。Linux CI 结果不替代其他操作系统的本机验证，远端实际结果以 Actions 为准。

仓库主要目录：`apps/server` 为 Fastify API，`apps/web` 为 React UI；`packages/project-observer`、`project-insight`、`project-analysis` 分别负责事实、规则和人工触发的分析；`packages/contracts` 定义合同。`data/` 内的 SQLite、运行产物、凭证、依赖及构建结果均不应入库。

另一台设备先获取仓库、安装依赖并构建，随后单独登记本机项目路径和配置 Pi。已有副本先提交自己的修改，再 `git pull --ff-only`；不要强制推送覆盖其他设备的工作。

详细说明见 [开发手册](README-dev.md)、[安全合同](docs/05-SECURITY.md)、[观察器说明](docs/14-PROJECT-OBSERVER.md)、[当前交接状态](handoff/STATUS.md)。最初的规划包首页保存在 [历史归档](docs/archive/README-planning-v1.md)，其中阶段计划不代表当前运行状态。
