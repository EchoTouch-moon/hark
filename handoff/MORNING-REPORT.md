# 重建交接（2026-11-03）

**2026-11-04 真实项目接入准备**：用户已明确授权一个具体本机项目的文件只读分析，但本轮未读取该项目或启用 connector。旧句柄复用与打开前目录替换已完成合成回归，底层句柄移动出授权根后仍可读取，P0 与 M1→M2 Gate 未通过；详见 `handoff/qa/M1-A-C3-TARGETED-FIX-2026-11-04.md`。当前页面仍只有合成数据。
**2026-11-04 本机合成产品**：在仓库根运行 `pnpm demo`，浏览器打开 `http://127.0.0.1:4173/`，点击“盘点预置项目”；Ctrl-C 停止服务。演示数据库独立保存在 `data/m1-synthetic/`。M1-R01～R06、截图及逐项旧验收适用性见 `handoff/qa/M1-SYNTHETIC-ACCEPTANCE-2026-11-04.md`；158 项测试和构建见 `handoff/EVIDENCE/m1-integrated-checks-2026-11-04.txt`。Mock 追问、回复、反馈和版本均可恢复；独立复审未完成，M1→M2 未通过。旧目录读取的 A-C3 问题未修复，不能接入服务。
**2026-11-04 合成 API**：`pnpm demo` 构建 TypeScript 并启动仅绑定 `127.0.0.1:4173` 的演示服务，状态保存在独立 `data/m1-synthetic/`。三项 API 集成测试及 lint/typecheck 见 `handoff/EVIDENCE/m1-d-c1-api-2026-11-04.txt`；页面联调和浏览器验收仍待完成。
**2026-11-04 合成观点与反馈**：内部服务支持有来源观点、标注 Mock 的追问、持久质疑与保留 v1 的 v2；双 worker 冲突及局部检查见 `handoff/EVIDENCE/m1-c-c1-dialogue-2026-11-04.txt`。页面及本地 API 仍在接入。
**2026-11-04 合成盘点投影**：逐项目查询授权与覆盖状态，不拼接未授权项目材料；局部检查见 `handoff/EVIDENCE/m1-c-c2-inventory-2026-11-04.txt`。可信服务端接入尚未完成。
**2026-11-04 预置理解层**：复用 Chronicle 存储合成目标、成果及待办，授权与来源失效时保守处理；局部证据见 `handoff/EVIDENCE/m1-b-c1-understanding-2026-11-04.txt`。服务、对话、界面集成及实际 M1 验收仍待完成。
**2026-11-04 静态界面**：`web/index.html` 可打开查看合成外壳；本地预览可用 `python3 -m http.server 18765 --bind 127.0.0.1 --directory web`。它不连接服务、不保存反馈；浏览器复查与静态检查见 `handoff/EVIDENCE/m1-ui-shell-2026-11-04/`，后改来源文字未再次浏览器复验，截图未保存。
**2026-11-04 A-C3 复审及范围调整**：复审发现跨项目目录替换与撤权后描述符复用两项可复现问题，A-C3 BLOCKED。用户批准 M1 使用受控预置合成项目，旧目录读取不接入服务；A-C4 局部测试已通过，产品闭环与浏览器验收尚未完成。详见 `handoff/qa/M1-A-C3-REVIEW-R2-2026-11-04.md` 与 `handoff/EVIDENCE/m1-a-c4-catalog-2026-11-04.txt`。
**2026-11-04 M1 执行原则**：已将最小必要实现、分级安全边界和以可操作合成闭环为中心的调度写入 `AGENTS.md` 和两份 M1 任务文档。仅修改文档，未复审 A-C3、实现 UI 或运行 M1-R01～R06；现有阻塞和运行说明继续见 `handoff/BLOCKERS.md`。文档检查见 `handoff/EVIDENCE/m1-occam-docs-2026-11-04.txt`。
**2026-11-04 A-C3 修复待复审**：首轮审查五项缺陷已在实现和 `tests/fixture-discovery-ac3.test.ts` 中处理，138 项测试与复现脚本 exit 0，见 `handoff/EVIDENCE/m1-a-c3-fix-2026-11-04.txt`。A-C3 未勾选，M1-A 不关闭，复审前不进入 B-C1/B-S1。

**2026-11-04 A-C2/A-S2**：合成发现与用户可见场景测试已在 macOS 跑通，133 项测试、lint、类型检查、构建见 `handoff/EVIDENCE/m1-a-c2-fixture-discovery-2026-11-04.txt`。后续 A-C3 发现问题，结果见上；Windows 适配器仍为 `unavailable`。

**M1 分工细化并启动首批工作**：`tasks/M1-AGENT-WORK-PACKAGES.md` 为不同 LLM 划分核心与辅助任务；`tasks/m1-work-items.json` 是细项状态源。合成样本 A-S1 已审查，见 `handoff/EVIDENCE/m1-a-synthetic-fixtures-2026-11-04.txt`；发现合同 A-C1 已复审，见 `handoff/qa/M1-A-DISCOVERY-CONTRACT-2026-11-04.md`；实际发现和安全读取尚未实现。

**2026-11-04 方向调整**：M1 优先合成只读项目发现、项目记忆、观点修订及对话体验；A～D 拆分和验收见 `tasks/M1-REDISCOVERY-2026-11-04.md`。执行链安全条件在接入执行能力前完成；真实 connector 的 P0 Gate 未通过。

**远端 CI**：`c69250e` 的 Linux、macOS 和 Windows 工作流均通过，见 `handoff/EVIDENCE/m0-ci-c69250e-2026-11-04.md`；不代表产品 E2E 或真实 Windows 路径安全已通过。

**2026-11-04 策略加固已完成本地验证**：动作策略容器、能力数组及限制在运行时冻结；补充审批字段注入与写类动作缺来源版本负例，观察授权遇到无效时钟返回独立原因。macOS 合成数据的 122 项测试、lint、类型检查、构建及文档检查见 `handoff/EVIDENCE/m0-policy-hardening-2026-11-04.txt`。该证据对应 `cf29ec2` 基线及当时未提交修改，并非精确提交 SHA；真实执行仍关闭。

**M0 Gate R2 独立只读复审 PASS（仅限基础合同门禁）**：117 项测试、lint、类型检查、构建与文档检查绑定提交 `46ab047`，见 `handoff/EVIDENCE/m0-gate-r2-2026-11-03.txt`；复核记录见 `handoff/qa/M0-GATE-REVIEW-R2-2026-11-03.md`。M1 未启动；真实 connector 的 P0 安全门槛未通过，执行器、身份认证、grant 事务占用和真实来源未实现；后续 CI 结果见上。

M0-REBUILD-01 合同复核和 M0-REBUILD-02 合成验收设计经独立只读复核完成，见 `handoff/qa/M0-CONTRACT-REVIEW-2026-11-03.md`；两项任务的完成不等于 Gate 通过，Gate 判定以 R2 记录为准。

最新（R2 前）：动作参数合同与执行前二次校验已实现为纯预检（`src/action-policy.ts`）。四类动作的可选严格参数、风险下限、效果、能力与零成本上限已冻结；执行前按固定顺序核验 25 项绑定、状态、时效、风险、能力与摘要，任何不符即拒绝，全部通过仍停在 `action_disabled`。R2 前 115 项本地测试、lint、类型检查和构建见 `handoff/EVIDENCE/m0-action-policy-gate-2026-11-03.txt`；身份认证、grant 事务占用、执行器与 verifier 未实现。

最新（R2 前）：独立 M0 Gate 审查为 NOT PASS；新增全禁用动作提案注册表和标准证据索引，97 项本地测试、lint、类型检查和构建见 `handoff/EVIDENCE/m0-disabled-action-check-2026-11-03.txt`。执行、真实 connector、M1 产品纵切和远端/Windows 验证均未通过。

审批绑定和旧 E2E 的逐项映射已写入 `docs/architecture/M0-EXECUTION-AND-E2E-MAPPING.md`；这不是执行器实现或 E2E 通过记录。

已添加基础 TypeScript 编译器规则级 lint 并加入 CI 配置，证据见 `handoff/EVIDENCE/m0-lint-check-2026-11-03.txt`；后续远端 CI 结果见上。

历史（R2 前）：反馈 v2 新增独立拒绝选项，保持 v1 历史兼容且不改变观点；91 项本地测试见 `handoff/EVIDENCE/m0-feedback-v2-check-2026-11-03.txt`。真实认证、真实项目和用户交互仍未实现。

历史（R2 前）：Event 时效预检及模型推断负例已完成，82 项本地测试见 `handoff/EVIDENCE/m0-event-freshness-check-2026-11-03.txt`。该预检尚未接入可信来源/权限消费路径，该项单独结果不代表 M0 Gate 通过。

合成场景、失败反例及当前证据映射见 `tasks/M0-SYNTHETIC-ACCEPTANCE.md`；发现器、真实目录读取、完整安全矩阵仍未完成，不能把合成存储测试当成 Gate 通过。

CI 工作流已加入 Mac/Windows 分支触发与平台任务，保留原有 `ci-gate`；YAML 本地解析及后续远端运行结果见上。

历史（R2 前）：两个真实 worker 同时竞争同一合成观点版本，只有一个成功、无孤儿记录；79 项本地测试见 `handoff/EVIDENCE/m0-concurrent-revision-check-2026-11-03.txt`。这是 macOS 单场景，不是并发压力测试或 Windows 验证。

历史（R2 前）：v4 合成用户决定可版本化、撤回，并作为观点的独立来源；替代或撤回后旧观点 withheld。fixture 项目状态控制覆盖来源、观点和决定。78 项本地测试、类型检查和构建见 `handoff/EVIDENCE/m0d-fixture-decisions-check-2026-11-03.txt`；当时真实身份、项目、研究与 M0 Gate 尚未完成。

历史（R2 前）：增加 v3 合成观点草稿、版本原因、方案和反馈存储；本地 64 项测试、类型检查及构建通过，证据见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。仅支持合成观察证据；当时正式身份、生命周期、真实来源和 M0 Gate 未完成。

历史（R2 前）：v2 迁移与合成 Chronicle 已建立来源/项目绑定、授权重检、重置 epoch、不可变和幂等基础；19 项局部测试及类型检查见 `handoff/EVIDENCE/m0b-fixture-chronicle-check-2026-11-03.txt`。当时真实项目未观察，M0 Gate 尚未通过。

历史（R2 前）：按 Mac 分支审查新增项目理解合同首版和跨项目结构负例，详见 `docs/architecture/M0-A-PROJECT-KNOWLEDGE-CONTRACT.md`；36 项本机测试、类型检查与构建见 `handoff/EVIDENCE/m0a-project-contract-check-2026-11-03.txt`。当时未实现真实来源核验或观点持久化，M0 Gate 未通过。

历史（R2 前）：官方 DeepSeek 原型的参考记录见 `docs/architecture/DEEPSEEK-PROTOTYPE-2026-11-03.md`。新增路径预检和中断恢复；当时真实读取的竞态安全边界、Windows 验证和安全 Gate 尚未完成。验证见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。一次测试收集意外及缓解见 `handoff/BLOCKERS.md`。

历史（R2 前）：增加本地进度看板、合同/摘要、观察权限、状态转换和数据库迁移的基础实现。`handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt` 记录测试、类型检查、构建和文档检查；架构图见 `docs/architecture/hearth-foundation-v2.html`。当时未通过 M0 Gate；当前结果及未完成项见首段和进度看板。

历史（R2 前）：新增 M0 子任务与合成验收草案 `tasks/M0-FOUNDATION-2026-11-03.md`；首轮合同冲突已记录，当时尚未完成逐字段复核或 Gate 验证。历史文档检查见 `handoff/EVIDENCE/m0-plan-doc-check-2026-11-03.txt`；历史证据不能证明新实现。

请从 `README.md` 和 `tasks/REBUILD-PLAN.md` 开始。旧前后端和相关构建、测试已从重建版本移除；安全合同、计划、参考资料与历史证据保留。未实现、运行或验收新的产品。

原工作区的未提交改动保持原样。用户已授权将本次重建推送到 GitHub，并处理相关 PR 和分支；`master` 和 G0 的分支保护继续生效。当前清理详情应以 GitHub 实际 PR、分支与提交为准。
