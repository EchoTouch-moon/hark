# 开发进度与协作看板

此文件是重建工作的本地协作入口。认领任务时写明负责人；完成一项后立即标记 `[x]`，附可复核的文件或证据；未实现、未验证或仅有计划一律不标完成。核心合同和数据库迁移串行处理；并行任务不得修改同一文件。门槛状态以实际证据为准。

## M0：底层合同与验证基础 [Gate PASS·基础合同，残余项转 M1]

- [ ] M0-C 合成观点与反馈持久化基础（主 Agent，串行迁移）。
  - [x] 在事务中追加合成观点版本、修订原因和不可执行计划，以期望版本防止旧版本覆盖（`src/fixture-opinion-store.ts`）。
  - [x] 保存与具体版本关联的用户反馈，并对重复请求保持幂等。
  - [x] 每次使用合成观点都复核合成观察来源、项目隔离和当前授权；失效来源不可读。
  - [x] 完成迁移、版本、重启、撤权和来源失效的合成测试及独立源码审查，见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。
  - [x] 两个真实 worker 同时竞争同一期望版本：仅一个成功，失败方无孤儿记录（`tests/fixture-opinion-concurrency.test.ts`）；本机 macOS 单场景，非压力测试。
  - [ ] 并发压力测试、真实项目生命周期、真实研究来源与用户决定的可信核验。
  - [x] 合成用户决定：版本身份、持久授权及撤回/替代后禁用其观点引用（`src/fixture-decision.ts`、`tests/fixture-decision.test.ts`、`tests/fixture-opinion-store.test.ts`）。
  - [x] 合成项目状态为删除中或已删除时，来源记录、观点及用户决定均不可用（fixture 测试；不代表正式项目生命周期已实现）。
  - [x] 版本化反馈支持用户明确拒绝，保留旧记录兼容且不改变观点或视为事实证伪（`src/domain-contracts.ts`、`tests/fixture-feedback-v2.test.ts`）。
- [ ] M0-B 项目来源与事实持久化基础（主 Agent，串行迁移；仅合成数据）。
  - [x] 新增 v2 迁移，保存项目绑定的合成来源与不可变观察，约束来源 epoch 和重复写入（`src/storage.ts`）。
  - [x] 合成记录每次读写核对持久授权；撤权、暂停、过期或来源 epoch 更新后拒绝使用旧记录（`src/fixture-chronicle.ts`）。
  - [x] 完成合成 A/B 项目的跨项目、幂等、撤权、来源重置、升级和重启测试及独立源码审查，见 `handoff/EVIDENCE/m0b-fixture-chronicle-check-2026-11-03.txt`。
  - [ ] 完整可信来源、项目生命周期及真实读取权限边界；上述 fixture 不证明真实内容或文件读取安全。
- [ ] M0-A 项目理解核心合同（主 Agent；合成测试由协作 Agent 编写、主 Agent 审查）。
  - [x] 定义项目、类型化证据、观点版本、计划、反馈与修订关系（`src/domain-contracts.ts`）。
  - [x] 验证自包含对象的项目绑定、证据类型、反馈和版本跨字段负例（`tests/domain-contracts.test.ts`、`tests/contracts-state.test.ts`）。
  - [x] 记录合同适用范围、尚未实现的来源核实、存储与权限检查（`docs/architecture/M0-A-PROJECT-KNOWLEDGE-CONTRACT.md`）。
  - [ ] 完成现行合同逐字段冲突裁决、可信来源存在/授权/epoch 复核与独立验收；结构有效不等于来源可信。
- [x] M0-REBUILD-01：产品、安全合同逐条复核与保守冲突裁决；仅文档合同任务完成，见 `handoff/qa/M0-CONTRACT-REVIEW-2026-11-03.md`。
  - [x] 首轮产品/安全合同与门槛映射，保留未决冲突（`docs/architecture/M0-CONTRACT-REVIEW.md`）。
  - [x] Event TTL 的兼容裁决及纯预检：无期限/过期/未来时间/模型推断 withheld，通过时仍须核验来源（`src/event-freshness.ts`）。
  - [x] 形成审批绑定和 E2E-01～12 的逐项合同映射（`docs/architecture/M0-EXECUTION-AND-E2E-MAPPING.md`）；全部相关产品 E2E 尚未运行。
  - [x] 形成旧接口和新项目理解合同的字段对照（`docs/architecture/M0-CONTRACT-FIELD-MAP.md`）。
  - [x] 字段裁决及合成验收映射经独立只读复审；不代表安全或实现 Gate 通过。
- [x] M0-REBUILD-02：合成目录闭环与失败验收**设计**完成，见 `handoff/qa/M0-CONTRACT-REVIEW-2026-11-03.md`；实际目录纵切属于 M1。
  - [x] 建立 A/B 合成场景、失败用例和现有证据矩阵（`tasks/M0-SYNTHETIC-ACCEPTANCE.md`）；未实现的目录发现与真实读取明确标为 NOT RUN。
  - [x] 在 M0-REBUILD-01 完成复核基础上审查验收映射；M1 纵切与 P0 安全验证未通过前不启用真实 connector。
- [ ] 核心合同：输入校验和基础领域结构（主 Agent）。
  - [x] 主要数据结构的 Zod 严格校验首版，见 `src/contracts.ts` 和 `tests/contracts-state.test.ts`。
  - [x] 动作与目标摘要、稳定幂等键的计算及负例，见 `src/digests.ts` 和 `tests/digests.test.ts`。
  - [x] 动作类型对应的参数约束已冻结；执行前重算动作/目标摘要并比对 grant，摘要不符即失败关闭（`src/action-policy.ts`、`tests/action-policy.test.ts`）。纯预检，执行通道仍关闭。
- [x] 动作提案入口采用全禁用的服务端注册表，拒绝客户端注入风险、效果、审批、完成状态与未审参数（`src/action-registry.ts`、`tests/action-registry.test.ts`）。这不等于动作可安全启用。
  - [x] R2 审查 N2/N4/N5：冻结策略注册表、策略对象、能力数组与限制对象；补充审批模式注入和三类写动作缺来源版本的负例。Zod schema 未递归冻结，所有动作与执行通道仍关闭（`tests/action-policy.test.ts`）。
- [ ] 权限：默认拒绝、作用域、撤权、暂停与副作用审批边界（主 Agent）。
  - [x] 观察授权纯判断及默认拒绝未实现通道，见 `src/policy.ts` 和 `tests/policy-storage.test.ts`。
  - [x] R2 审查 N3：时钟无效时独立返回 `invalid_clock` 并拒绝，不再误报授权过期（`src/policy.ts`、`tests/policy-storage.test.ts`）。
  - [x] 持久观察授权按次读取，撤权及重启后仍拒绝，见 `src/storage.ts` 和 `tests/policy-storage.test.ts`。
  - [ ] 真实路径边界、审批执行前二次校验；执行与外发通道保持关闭。
  - [x] M0 合成路径预检：验证越界与符号链接拒绝（`src/path-check.ts`、`tests/path-check.test.ts`）；不能作为安全文件读取的声明。
  - [x] 执行前二次校验纯预检：按 run→card→candidate→action→grant→来源版本顺序重读绑定、卡片状态与期限、风险、效果、能力、预算与摘要，任何不符即拒绝，全部通过后仍停在 `action_disabled`（`src/action-policy.ts`、`docs/architecture/M0-ACTION-POLICY-GATE.md`）。未接身份认证、事务内 grant 占用与执行器。
- [x] 官方 Super Agent 原型源码对照：锁定版本并记录可采用机制和安全差异（`docs/architecture/DEEPSEEK-PROTOTYPE-2026-11-03.md`）。
- [x] 中断恢复：事务内将中断的执行状态转为待核验，禁止自动重放（`src/storage.ts`、`tests/policy-storage.test.ts`）。
- [x] 测试收集限定到项目自身 `tests/**/*.test.ts`；本次意外收集原型测试的经过见 `handoff/BLOCKERS.md`。
- [x] 状态转换规则与非法转换拒绝；执行和完成在未接入准入及验证器时关闭（`src/state-machine.ts`、`src/storage.ts`，两份测试）。
- [ ] 数据库：版本迁移、重放与重启、幂等和只追加审计（主 Agent）。
  - [x] 第一版显式迁移、外键、WAL、唯一键及审计不可更新删除；已覆盖重复迁移和重启。
  - [ ] 执行入口强制动作幂等、审计脱敏入口、项目记忆及观点版本持久化。
- [x] 工程基础：本机 TypeScript、测试及构建配置（外部 Agent 实施，主 Agent 审查；后续 Windows CI 结果见下）。
- [ ] 完成测试、类型检查和全部适用安全反例（主 Agent）。
  - [x] 本轮 21 项局部测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt`；完整安全反例仍待补充。
  - [x] 路径预检和恢复后共 26 项本地测试、类型检查、构建、文档检查及测试收集范围，见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。
  - [x] 项目理解合同与旧动作跨项目负例后，共 36 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0a-project-contract-check-2026-11-03.txt`。
  - [x] 合成来源、观点、修订和反馈后，共 64 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。
  - [x] 合成用户决定和生命周期约束后，共 78 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0d-fixture-decisions-check-2026-11-03.txt`。
  - [x] 增加双 worker 实际竞争后，79 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0-concurrent-revision-check-2026-11-03.txt`。
  - [x] 增加 Event 时效与推断负例后，82 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0-event-freshness-check-2026-11-03.txt`。
  - [x] 增加反馈 v2 后，91 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0-feedback-v2-check-2026-11-03.txt`。
  - [x] 本地 CI 配置加入 Mac/Windows 分支触发和两平台测试任务；YAML 及触发分支解析检查见 `handoff/EVIDENCE/m0-ci-workflow-static-2026-11-03.txt`。
  - [x] 添加编译器规则级 `pnpm lint` 并配置 CI；规则和本机输出见 `handoff/EVIDENCE/m0-lint-check-2026-11-03.txt`。
  - [x] 补齐 QA 标准证据索引，逐项标明 PASS/PARTIAL/NOT RUN；原始输出为 `handoff/EVIDENCE/m0-disabled-action-check-2026-11-03.txt`。
  - [x] 增加动作参数合同与执行前二次校验后，115 项本地测试、lint、类型检查与构建，见 `handoff/EVIDENCE/m0-action-policy-gate-2026-11-03.txt`（R2 修复前基线）。
  - [x] R2 复核修复后（L2 一律拒绝、必需能力、写类来源版本必填），117 项本地测试、lint、类型检查、构建与文档检查绑定提交 `46ab047`，见 `handoff/EVIDENCE/m0-gate-r2-2026-11-03.txt`。
  - [x] R2 剩余问题加固后，122 项本机测试、lint、类型检查、构建与文档检查通过，见 `handoff/EVIDENCE/m0-policy-hardening-2026-11-04.txt`（`cf29ec2` 基线加本轮未提交修改）；独立代码复核见 `handoff/qa/M0-POLICY-REVIEW-2026-11-04.md`。
  - [x] 核验 `c69250e` 的远端 CI：Linux、macOS、Windows 三项成功，见 `handoff/EVIDENCE/m0-ci-c69250e-2026-11-04.md`；这不等于 Windows 真实路径安全和产品 E2E 验证。
  - [ ] Windows 真实路径安全及产品 E2E 尚未验证。
- [x] 依据现有实现生成底层架构图（`docs/architecture/hearth-foundation-v2.html`）；图中明确标注尚未接入的能力。
- [x] M0 Gate（R2，2026-11-03）：按 `docs/06-QA-BENCHMARK.md` 的基础合同标准独立只读复审 **PASS**，基线 `46ab047`；117 项测试与 lint/类型/构建/文档检查见 `handoff/EVIDENCE/m0-gate-r2-2026-11-03.txt`，复核记录见 `handoff/qa/M0-GATE-REVIEW-R2-2026-11-03.md`。PASS 仅覆盖 contracts/状态机/policy 负例/migrations/威胁模型；执行器、身份认证、grant 事务占用及真实来源仍未完成；后续 Windows/远端 CI 结果见上。

## M1：合成数据纵切 [首批进行中]

- [ ] M1-A：受控预置合成项目盘点及稳定身份；旧目录读取 A-C3 未通过，A-C4 正在实现替代入口。
  - [x] A-C1（核心）：合成发现合同经独立上下文复审，见 `docs/architecture/M1-DISCOVERY-CONTRACT.md` 与 `handoff/qa/M1-A-DISCOVERY-CONTRACT-2026-11-04.md`；安全读取适配器仍待实现验证。
  - [x] A-S1（辅助）：隔离合成项目样本经主 Agent 审查；证据 `handoff/EVIDENCE/m1-a-synthetic-fixtures-2026-11-04.txt`；不代表发现器或真实路径安全已完成。
  - [x] A-C2（核心）：合成发现实现已交付；负责人：主 Agent，依赖 A-C1/A-S1。证据 `handoff/EVIDENCE/m1-a-c2-fixture-discovery-2026-11-04.txt`；A-C3 指出的边界缺陷已有后续修复，集成验收仍待复审。Windows 适配器保持 unavailable。
  - [x] A-S2（辅助）：补充发现的用户可见场景测试；负责人：协作 Agent，依赖 A-C1/A-C2。证据 `handoff/EVIDENCE/m1-a-s2-discovery-scenarios-2026-11-04.txt`；待 A-C3 审查。
  - [ ] A-C3（核心）：独立复审 BLOCKED，目录替换及撤权后句柄复用可复现；见 `handoff/qa/M1-A-C3-REVIEW-R2-2026-11-04.md`。旧目录读取不得接入服务。
  - [x] A-C4（核心）：受控预置合成数据入口已复核；不接收路径或调用旧目录适配器，4 项局部测试及类型检查见 `handoff/EVIDENCE/m1-a-c4-catalog-2026-11-04.txt`。服务入口尚未实现。
- [ ] M1-B：有来源的目标、成果、待办与项目记忆；区分事实、推断和未知。
  - [x] B-C1（核心）：受控预置材料投影复用 Chronicle；5 项局部测试与类型检查见 `handoff/EVIDENCE/m1-b-c1-understanding-2026-11-04.txt`。API 接入尚未完成。
  - [x] B-S1（场景并入 B-C1）：覆盖未摄取、伪造内容、来源失效、撤权、项目隔离和重启；当前不接收任意格式输入。
- [ ] M1-C：合成观点、追问、反馈和可追溯修订；明确 mock，保留 v1。
  - [ ] C-C1（核心）：实现基于来源的观点、反馈及 CAS 修订；负责人未分配，依赖 B-C1。
  - [x] C-C2（核心）：逐项目检查的合成盘点投影与覆盖范围；2 项测试及类型检查见 `handoff/EVIDENCE/m1-c-c2-inventory-2026-11-04.txt`，服务端可信 scope 尚待接入。
  - [ ] C-S1（辅助）：补充对话与修订场景；负责人未分配，依赖 C-C1。
- [ ] M1-D：带基本炉心视觉的中文对话与全局盘点，含真实错误状态。
  - [x] D-C0（核心）：展示合同已复核，见 `docs/architecture/M1-UI-DISPLAY-CONTRACT.md`。
  - [x] D-S0（辅助）：明确标示的静态外壳已复核；浏览器与静态检查见 `handoff/EVIDENCE/m1-ui-shell-2026-11-04/`。来源标签在浏览器复查后修改，尚未浏览器复验；未接入服务。
  - [ ] D-C1（核心）：建立受控合成本地服务与 API；负责人未分配，依赖 C-C1/C-C2。
  - [ ] D-S1（辅助）：串行接手静态外壳并接入合成 API；负责人未分配，依赖 D-S0/D-C1。
  - [ ] D-S2（辅助）：运行浏览器场景并记录证据；负责人未分配，依赖 D-S1。
- [ ] M1-REBUILD-01：合成闭环及适用安全/E2E 通过独立 Gate 审查。细分、依赖、责任和验证见 `tasks/M1-REDISCOVERY-2026-11-04.md`。
  - [ ] G-C1（核心）：审查交付、逐项记录安全和 E2E 证据并组织 Gate 复审；负责人未分配。

细分任务状态源为 `tasks/m1-work-items.json`，本看板是同步摘要；文件所有权、验收和并行约束见 `tasks/M1-AGENT-WORK-PACKAGES.md`。标为辅助的交付必须经主 Agent 审查后才可勾选。可信执行存储、身份认证、grant 事务占用和独立 verifier 是接入执行能力的前置，不是合成只读闭环的前置。真实 connector 仍须安全 P0 Gate 与相应授权。

## M2：受控研究与真实体验 [未开始]

- [ ] M2-REBUILD-01：仅在 M1 Gate 通过且取得对应授权后进行。

任务定义见 [M0 计划](M0-FOUNDATION-2026-11-03.md) 和 [任务清单](manifest.json)；历史记录见 `handoff/`。本地 Mac 与 Windows 分支不会自动同步；分支间采用经过审查的共同提交。
