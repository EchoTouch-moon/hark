# M0 动作参数合同与执行前二次校验

状态：纯预检已实现；**执行器、身份认证、grant 事务占用与独立 verifier 均未实现**，四类动作仍全部禁用。本文件不是 M0 Gate 通过证据；R2 复核后已修正"L2 在线授权"和"能力空集合"两处过宽语义。

## 目的与边界

- 冻结每类动作的参数、风险下限、效果、能力与预算上限，不允许用动作名称或客户端提交的 `risk`/`effect`/`status` 推定权限。
- 在外部副作用之前，按固定顺序核验 run → card → candidate → action → grant → 来源版本的绑定与时效。
- 本模块是纯函数，无 I/O、无执行、无审计写入，返回值恒为 `allowed: false`；`passedChecks` 只证明前置检查走到了哪一步。
- **输入基座由调用方提供**：通过全部检查只代表内部一致，不代表 grant 已签发、已入库或仍存在，也不代表调用者已认证。

## 参数合同

所有参数对象均为可选字段加 `.strict()`：未知键、越界值和未评审取值一律拒绝。

| 动作类型 | 参数 | 风险下限 | 效果 | 允许 / 必需能力 | 来源版本 | 步数/超时/成本上限 |
| --- | --- | --- | --- | --- | --- | --- |
| `report.generate` | `format?: 'markdown'`、`title?: 1..200` | L1 | `local_create` | `artifact.write` / `artifact.write` | 必填 | 5 / 60s / 0 |
| `checklist.generate` | `maxItems?: 1..50` | L0 | `local_create` | `artifact.write` / `artifact.write` | 必填 | 3 / 30s / 0 |
| `draft.generate` | `tone?: 'neutral' \| 'concise'` | L1 | `local_create` | `artifact.write` / `artifact.write` | 必填 | 3 / 60s / 0 |
| `repo.read_diagnose` | `depth?: 0..3` | L0 | `read` | `repo.read` / `repo.read` | 可选 | 10 / 120s / 0 |

`enabled` 均为 `false`：参数约束与风险下限只是**约束**，不是许可。`maxCostUsd` 恒为 0，任何计费动作在预算检查即失败。写类动作必须声明 `expectedSourceVersion`，只读诊断可省略。

## 执行前校验顺序

| 顺序 | 检查 | 失败原因 |
| --- | --- | --- |
| 1 | `run_identity`：run 的 id、card、action 与请求一致 | `run_identity_mismatch` |
| 2 | `card_binding`：card 与请求、run 指向同一张卡 | `card_binding_mismatch` |
| 3 | `candidate_binding`：card 指向该 candidate | `candidate_binding_mismatch` |
| 4 | `project_binding`：请求、card、candidate、action 同项目 | `project_binding_mismatch` |
| 5 | `action_identity`：action 与请求、run 一致 | `action_identity_mismatch` |
| 6 | `idempotency_key`：run 的键等于服务端重算值 | `idempotency_mismatch` |
| 7 | `card_status`：仅 `ready`/`awaiting_approval` | `card_not_ready` |
| 8 | `card_expiry` | `card_expired` |
| 9 | `run_state`：仅 `queued`/`awaiting_approval`，重复执行被拒 | `run_not_startable` |
| 10 | `parameter_policy`：按类型重校验参数 | `params_not_allowed` |
| 11 | `risk_floor`：动作风险不低于注册表下限 | `risk_below_floor` |
| 12 | `risk_ceiling`：L3 永不允许；L2 一律拒绝，直到可验证的在线审批记录存在 | `risk_l3_forbidden`、`online_approval_not_implemented` |
| 13 | `effect_policy`：效果必须等于注册表声明 | `effect_not_permitted` |
| 14 | `capability_policy`：能力不得超出允许集合，且必须包含该类型的必需能力 | `capability_not_permitted` |
| 15 | `budget_policy`：步数、超时、成本上限 | `budget_not_permitted` |
| 16 | `grant_principal` | `principal_mismatch` |
| 17 | `grant_card` | `grant_card_mismatch` |
| 18 | `grant_consumption`：一次性 grant 不得已消费 | `grant_consumed` |
| 19 | `grant_expiry`：未生效或已过期 | `grant_not_yet_valid`、`grant_expired` |
| 20 | `grant_risk`：覆盖动作风险，且 L3 grant 一律拒绝 | `grant_risk_insufficient` |
| 21 | `grant_capabilities`：覆盖动作声明的能力 | `grant_capability_missing` |
| 22 | `digests`：动作摘要与目标摘要等于服务端重算值 | `digest_mismatch` |
| 23 | `source_version`：写类动作缺版本即拒绝；声明后须与当前版本一致 | `source_version_missing`、`source_version_changed` |
| 24 | `action_enablement`：类型必须经评审启用 | `action_disabled` |
| 25 | `execution_channel`：执行通道恒为关闭的最终护栏 | `execution_not_implemented` |

`invalid_request` 表示结构不合法；`invalid_clock` 表示传入时间不可用。两者都在任何检查之前失败。

## 信任边界

- 第 1–25 项只校验调用方给出的基座是否自洽。它能发现篡改、错配、过期和跨项目引用，但**不能发现"整份基座都是伪造的"**：一个从未签发的 grant 只要字段自洽就能通过前置检查。
- 因此该函数不得作为授权判定使用。真实的授权必须来自：已认证的服务端主体 + 事务内读取的 grant/card/run + 一次性占用 + 执行前目标复核。
- `approvalMode` 之类的请求字段不再被接受：在线审批若实现，必须是持久化、绑定摘要、带 nonce 与时间窗、可被服务端验证的记录，而不是调用方自报。
- `currentSourceVersion` 同样由调用方提供；在接入可信来源前，写类动作只能用于合成场景。

## 明确未实现

1. **身份认证**：`principalId` 仍由调用方传入，不是可信服务端身份；不得据此声称已认证。
2. **事务占用**：grant 的一次性消费、并发竞争和崩溃窗口未实现，本函数不预留 grant。
3. **真实路径边界**：未做文件系统包含检查；`path-check.ts` 只是合成目录的纯预检。
4. **可信来源版本**：`currentSourceVersion` 由调用方提供，尚未从可信持久层读取。
5. **执行器与 verifier**：无外部副作用、无回读验证；即使全部前置通过也不会执行。
6. **审计与用户交互**：不写入 `audit_log`，也没有取消/暂停的 UI 通路。

## 与现有模块的关系

- `src/action-registry.ts` 复用同一份参数 schema 解析不可信提案，但仍返回 `action_disabled`；注册不等于启用。
- `src/digests.ts` 提供 `actionDigest`、`targetDigest` 与 `idempotencyKey`，本模块只做重算比对。
- `src/storage.ts` 的 `runs`、`cards`、`approvals` 与基座字段大体对应，但尚未接线：没有适配器、没有事务内重读。注意 `approvals.consumed_at` 在 DB 中用 `NULL` 表示未消费，而 `ApprovalGrant.consumedAt` 目前只接受省略；未来适配器必须把 `NULL` 映射为省略（传 `null` 会被判 `invalid_request`），该不一致留待合同修订统一。

## 证据

- 单测：`tests/action-policy.test.ts`（18 项），覆盖 24 项可达检查的失败分支，以及"内部一致仍停在 `action_disabled`"；`execution_channel` 为当前不可达的最终护栏。
- 运行记录：`handoff/EVIDENCE/m0-gate-r2-2026-11-03.txt`（全量测试、lint、类型检查、构建与文档检查，绑定提交）。
