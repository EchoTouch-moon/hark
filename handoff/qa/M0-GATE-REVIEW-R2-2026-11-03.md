# M0 Gate 复审（R2）

审查基线：`46ab047c8d071e251cf7ab3e23c0754a8c591965`（分支 `codex/macos-rebuild`），2026-11-03，本机 macOS。
命令输出：`handoff/EVIDENCE/m0-gate-r2-2026-11-03.txt`（117 项测试、lint、类型检查、构建、文档检查，均 exit 0）。
方法：独立上下文的只读复核（与实现会话分离）通读 `bfe920c..46ab047` 的 diff、源码、测试与文档，独立复跑命令并做对抗性验证（L2 注入、空能力、缺版本、L3、过期/消费 grant、跨项目、摘要篡改、时钟不可用）；主 Agent 只提交修复与记录，未参与该复核会话的判定。

独立性说明：这是一次**独立上下文的 AI 只读复核**，不是人类签核。结论只覆盖下列字面门禁标准，不得外推为执行链、身份认证或真实数据安全已通过。

## 一、门禁标准逐条结论

标准来源：`docs/06-QA-BENCHMARK.md:48`（M0→M1）。

| 标准 | 结论 | 证据 |
| --- | --- | --- |
| contracts schema 正例/缺字段/越界/未知字段 | PASS | `src/contracts.ts:10-34` 全部 `.strict()`；`tests/contracts-state.test.ts:20-52`；`tests/domain-contracts.test.ts:34-101` |
| 状态机非法转换 | PASS | `src/state-machine.ts:3-17`；`tests/contracts-state.test.ts:73-91`；`src/storage.ts:131-133` 封禁 `executing`/`completed` |
| policy 负例 | PASS | `src/policy.ts:10-17`、`src/path-check.ts:13-31`、`src/action-registry.ts:10-24`、`src/action-policy.ts:161-306`；对应 4 个测试文件 |
| migrations 版本/事务/重放/重启/幂等/审计 | PASS | `src/storage.ts:7-112`；`tests/policy-storage.test.ts:29-97` |
| `AGENTS.md` 与威胁模型存在 | PASS | `AGENTS.md:1-40`；`docs/05-SECURITY.md:3-40`（威胁模型、L0–L3、S01–S12） |
| 证据与实现一致、无伪造测试 | PASS | 117 项与证据一致；无 `.skip/.todo/.only`；所有 `it` 含断言；`src/` 无网络/子进程/真实内容读取 |

## 二、R1 复核发现与处置

R1 为 `bfe920c` 上的独立只读复核（上一轮），结论 PASS 但列出 2 项高、5 项中、6 项低风险。

| 编号 | R1 结论 | 处置 | 现状 |
| --- | --- | --- | --- |
| H1 | 执行基座整体可伪造，函数只校验自洽 | `src/action-policy.ts:93-96,164-169` 与 `M0-ACTION-POLICY-GATE.md` 新增"信任边界"节，明确不证明签发/存在/身份；测试名称改为"caller-supplied basis" | 文档已修复；受信任 store 接线留给 M1 |
| H2 | L2 仅凭请求字段 `approvalMode` 放行 | 删除该字段；L2 一律返回 `online_approval_not_implemented`（`src/action-policy.ts:231-233`）；测试 `tests/action-policy.test.ts:189-194` | 已修复 |
| M1 | 能力空数组恒真 | 新增 `requiredCapabilities`，要求动作声明必需能力（`:240-244`）；空数组负例 `tests/action-policy.test.ts:204-206` | 已修复 |
| M2 | 来源版本可省略 | 写类动作缺 `expectedSourceVersion` 返回 `source_version_missing`；只读可省（`:281-285`）；测试 `:277-295` | 已修复 |
| M3 | 文档称覆盖 25 项，实际 24 项 | 移除未使用的 `request_shape`；文档改为"24 项可达 + `execution_channel` 护栏" | 已修复 |
| M4 | `consumedAt` 的 null/undefined 与 DB 不一致 | 文档如实说明映射要求与合同差异（`M0-ACTION-POLICY-GATE.md:77`） | 文档已修复；合同统一待修订 |
| M5 | "独立验证"只是调用方布尔值 | 未改；`storage.transitionRun` 仍封禁 `completed` | 未修复，列为 M1 接线前置 |
| M6 | `runs.state`、`approvals.consumed_at` 无 DB 级约束 | 未改 | 未修复，列为 M1 接线前置 |
| L1 | policy 时钟分支无测试 | `tests/policy-storage.test.ts:23-25` 新增失败关闭断言 | 已修复（原因含混见 N3） |
| L2 | `path-check` 的 `outside_root` 分支被遮蔽 | 未改（冗余防御） | 未修复，低风险 |
| L3 | 证据未绑定提交 | 本记录的 `m0-gate-r2-2026-11-03.txt` 记录 commit、branch 与 status | 已修复 |
| L4 | `ActionSpec.params` 接受任意键 | 未改；安全性由 policy 参数 schema 兜底 | 未修复，低风险 |
| L5 | 并发测试在仓库内重编译 `dist/` | 未改 | 未修复，低风险 |
| L6 | `openDatabase` 接受任意路径 | 未改 | 未修复，M1 增加模式守卫 |

## 三、R2 新发现

| 编号 | 严重度 | 描述 | 处置 |
| --- | --- | --- | --- |
| N1 | 阻断记录 | 修复提交时 `M0-ACTION-POLICY-GATE.md` 引用的 R2 证据文件尚未生成，STATUS 等仍写 115 项 | 已补齐本证据并同步 117 项与新语义 |
| N2 | 低 | 无显式用例断言"在请求中注入 `approvalMode` 会 `invalid_request`"，仅由 `.strict()` 隐式保证 | 记录，后续补参数化用例 |
| N3 | 低 | 时钟不可用被归因为 `grant_expired`，原因含混但失败关闭正确 | 记录，后续拆分 `invalid_clock` |
| N4 | 低 | `ACTION_POLICIES` 注释称 frozen，但未运行时冻结；进程内改 `enabled` 仍被 `execution_channel` 兜底 | 记录，M1 前冻结 |
| N5 | 低 | checklist/draft 的 `requiresSourceVersion` 无直接负例（仅 report 被测） | 记录，后续参数化 |

## 四、判定

**M0 Gate：PASS（仅限基础合同门禁）。**

依据：四项字面标准全部经独立复跑成立；`AGENTS.md` 与威胁模型存在；117 项测试与证据一致；`src/` 无网络、子进程或真实内容读取；`revalidateBeforeExecution` 不存在 `allowed: true` 路径，L2/L3、过期或已消费 grant、空能力、缺来源版本、摘要篡改均被拒。

**该 PASS 不等于**：执行链、身份认证、审批占用、真实来源读取、真实 connector、Windows 或远端 CI 已通过。上述能力均未实现，不能据此声称产品可用或安全边界已成立。

## 五、M1 期间的前置条件

M1 可以先做合成目录发现、项目隔离与记忆纵切。但一旦要把执行前校验接到真实 store、审批或执行器，必须先完成：

1. 执行前校验改为从受信任 store 在事务内读取 run/card/candidate/action/grant，并引入身份认证；纯预检不得作为授权判定。
2. grant 的一次性占用、并发竞争与崩溃窗口；外部结果不确定时进入 `pending_verification`。
3. 结构化 verifier verdict（含证据引用/哈希）替代裸布尔；`runs.state` 与 `approvals.consumed_at` 增加 DB 级约束。
4. L2 的在线审批记录（绑定摘要、nonce、时间窗）落地后才能解除 `online_approval_not_implemented`。
5. 真实路径边界与可信来源版本；在此之前写类动作只允许合成数据。
6. 适用 E2E-01～12 与 Windows/远端 CI 证据；不能运行的项逐项注明。
