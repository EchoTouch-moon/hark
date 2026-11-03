# 开发进度与协作看板

此文件是重建工作的本地协作入口。认领任务时写明负责人；完成一项后立即标记 `[x]`，附可复核的文件或证据；未实现、未验证或仅有计划一律不标完成。核心合同和数据库迁移串行处理；并行任务不得修改同一文件。门槛状态以实际证据为准。

## M0：底层合同与验证基础 [进行中]

- [ ] M0-C 合成观点与反馈持久化基础（主 Agent，串行迁移）。
  - [x] 在事务中追加合成观点版本、修订原因和不可执行计划，以期望版本防止旧版本覆盖（`src/fixture-opinion-store.ts`）。
  - [x] 保存与具体版本关联的用户反馈，并对重复请求保持幂等。
  - [x] 每次使用合成观点都复核合成观察来源、项目隔离和当前授权；失效来源不可读。
  - [x] 完成迁移、版本、重启、撤权和来源失效的合成测试及独立源码审查，见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。
  - [ ] 真正并行竞争压测、真实项目生命周期、研究来源与用户决定的可信核验；本轮 CAS 测试仅两连接顺序模拟冲突。
  - [x] 合成用户决定：版本身份、持久授权及撤回/替代后禁用其观点引用（`src/fixture-decision.ts`、`tests/fixture-decision.test.ts`、`tests/fixture-opinion-store.test.ts`）。
  - [x] 合成项目状态为删除中或已删除时，来源记录、观点及用户决定均不可用（fixture 测试；不代表正式项目生命周期已实现）。
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
- [ ] M0-REBUILD-01：产品、安全合同逐条复核与冲突裁决（主 Agent）。
  - [x] 首轮产品/安全合同与门槛映射，保留未决冲突（`docs/architecture/M0-CONTRACT-REVIEW.md`）。
  - [ ] 逐字段裁决 Event TTL、审批绑定与旧 E2E 适用性并独立复审；不能因首轮矩阵标记任务完成。
- [ ] M0-REBUILD-02：合成目录闭环与完整失败验收（主 Agent）。
- [ ] 核心合同：输入校验和基础领域结构（主 Agent）。
  - [x] 主要数据结构的 Zod 严格校验首版，见 `src/contracts.ts` 和 `tests/contracts-state.test.ts`。
  - [x] 动作与目标摘要、稳定幂等键的计算及负例，见 `src/digests.ts` 和 `tests/digests.test.ts`。
  - [ ] 动作类型对应的参数约束和执行时强制校验上述摘要。
- [ ] 权限：默认拒绝、作用域、撤权、暂停与副作用审批边界（主 Agent）。
  - [x] 观察授权纯判断及默认拒绝未实现通道，见 `src/policy.ts` 和 `tests/policy-storage.test.ts`。
  - [x] 持久观察授权按次读取，撤权及重启后仍拒绝，见 `src/storage.ts` 和 `tests/policy-storage.test.ts`。
  - [ ] 真实路径边界、审批执行前二次校验；执行与外发通道保持关闭。
  - [x] M0 合成路径预检：验证越界与符号链接拒绝（`src/path-check.ts`、`tests/path-check.test.ts`）；不能作为安全文件读取的声明。
- [x] 官方 Super Agent 原型源码对照：锁定版本并记录可采用机制和安全差异（`docs/architecture/DEEPSEEK-PROTOTYPE-2026-11-03.md`）。
- [x] 中断恢复：事务内将中断的执行状态转为待核验，禁止自动重放（`src/storage.ts`、`tests/policy-storage.test.ts`）。
- [x] 测试收集限定到项目自身 `tests/**/*.test.ts`；本次意外收集原型测试的经过见 `handoff/BLOCKERS.md`。
- [x] 状态转换规则与非法转换拒绝；执行和完成在未接入准入及验证器时关闭（`src/state-machine.ts`、`src/storage.ts`，两份测试）。
- [ ] 数据库：版本迁移、重放与重启、幂等和只追加审计（主 Agent）。
  - [x] 第一版显式迁移、外键、WAL、唯一键及审计不可更新删除；已覆盖重复迁移和重启。
  - [ ] 执行入口强制动作幂等、审计脱敏入口、项目记忆及观点版本持久化。
- [x] 工程基础：本机 TypeScript、测试及构建配置（外部 Agent 实施，主 Agent 审查；Windows 尚未验证）。
- [ ] 完成测试、类型检查和全部适用安全反例（主 Agent）。
  - [x] 本轮 21 项局部测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt`；完整安全反例仍待补充。
  - [x] 路径预检和恢复后共 26 项本地测试、类型检查、构建、文档检查及测试收集范围，见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。
  - [x] 项目理解合同与旧动作跨项目负例后，共 36 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0a-project-contract-check-2026-11-03.txt`。
  - [x] 合成来源、观点、修订和反馈后，共 64 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。
  - [x] 合成用户决定和生命周期约束后，共 78 项本地测试、类型检查、构建和文档检查，见 `handoff/EVIDENCE/m0d-fixture-decisions-check-2026-11-03.txt`。
  - [ ] 为 Mac 分支建立远端 CI 验证；补齐适用的 lint 与 Windows 检查。E2E 尚无可运行产品，不伪造通过。
- [x] 依据现有实现生成底层架构图（`docs/architecture/hearth-foundation-v2.html`）；图中明确标注尚未接入的能力。
- [ ] M0 Gate：完成所有既定门槛和独立审核（未通过）。

## M1：合成数据纵切 [未开始]

- [ ] M1-REBUILD-01：仅在 M0 Gate 通过后进行。

## M2：受控研究与真实体验 [未开始]

- [ ] M2-REBUILD-01：仅在 M1 Gate 通过且取得对应授权后进行。

任务定义见 [M0 计划](M0-FOUNDATION-2026-11-03.md) 和 [任务清单](manifest.json)；历史记录见 `handoff/`。本地 Mac 与 Windows 分支不会自动同步；分支间采用经过审查的共同提交。
