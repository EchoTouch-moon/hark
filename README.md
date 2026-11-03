# Hearth：项目重建入口

Hearth 是本地优先的项目智能同行者：在用户授权范围内理解项目、研究问题，提出有依据、可反驳和可修订的观点与计划；真实执行必须由用户审阅具体方案并明确发起。

## 我们要做什么

核心体验是：**授权目录 → 发现多个新旧项目（不限 Git）→ 分项目记忆与只读理解 → 在许可范围内研究公开资料 → 提出有来源的观点与建议 → 用户对话、反馈和选择 → 在新证据下修订观点**。用户可以全局盘点，也可以深入单个项目。目标包括电脑忙时让路、空闲时恢复，以及经许可的低打扰本机提醒；这些均尚待实现与验证。没有新价值时保持安静。权限、预算、来源、暂停与失败都要能看见；不能把模拟结果说成真实成果。

从 [重建计划](tasks/REBUILD-PLAN.md) 开始；需要产品背景时，读 [MVP 产品合同](docs/mvp/01-PRODUCT-CONTRACT.md) 与 [验收场景](docs/mvp/03-ACCEPTANCE-SCENARIOS.md)。现有文档描述产品意图或历史方案，不表示功能已实现。

## 安全底线

项目指令 [AGENTS.md](AGENTS.md)、[安全合同](docs/05-SECURITY.md) 和 [接口与执行合同](docs/04-CONTRACTS.md) 仍适用。观察、研究授权不等于修改项目、运行实验或向外写入的授权。不得访问禁用的真实私人目录；真实研究和外发需要对应权限、范围和预算。

## 文档怎么读

- 当前重建入口：[重建计划](tasks/REBUILD-PLAN.md)。
- 产品方向：[MVP 总览](docs/mvp/00-START-HERE.md)、[产品合同](docs/mvp/01-PRODUCT-CONTRACT.md)、[项目重新发现](docs/mvp/04-PROJECT-REDISCOVERY.md)、[定位参考](docs/mvp/04-PRODUCT-POSITIONING.md)。
- 设计提案：[心智与项目生命架构](docs/mvp/02-MIND-LIFE-ARCHITECTURE.md)、[验收场景](docs/mvp/03-ACCEPTANCE-SCENARIOS.md)。技术方案与阈值仍待重新评估。
- 研究参考：[研究基线](RESEARCH-BASELINE.md)、[调研](docs/00-RESEARCH.md)、[DeepSeek 对照研究](docs/reviews/)。这些是参考，不是开发命令。
- 历史计划、旧视觉规范、交付和测试证据保留在 `docs/`、`tasks/`、`handoff/`。其中的旧里程碑、实现状态、运行命令和引用可能不适用于本次重建；不要将其当作当前待办或验收证据。

此重建版本移除了旧前后端实现及其构建和测试文件。现已开始重建底层合同、权限判断、状态机和 SQLite 迁移；仍无可运行的完整产品。当前任务和实际验证见 [开发进度](tasks/DEVELOPMENT-PROGRESS.md)。原工作区的未提交内容没有纳入此版本，也没有被删除。
