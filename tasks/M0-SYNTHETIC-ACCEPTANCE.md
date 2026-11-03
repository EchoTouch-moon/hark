# M0-REBUILD-02 合成场景与验收矩阵

状态：验收设计及现有证据映射；**不是目录发现器、真实研究或 M0 Gate 通过证明**。当前代码只提供合成存储及路径预检，尚无目录发现、项目对话或完整用户界面。各项应随实现独立运行，记录提交、平台、命令和脱敏输出；未运行不得标 PASS。

## 合成输入约定

测试仅在测试创建的临时根目录 `R` 和独立临时 SQLite 中进行，不复制用户项目、不扫描 HOME。创建以下**虚构**材料：

- 项目 A：合成 Git 项目，包含用于观察的普通说明文件和受控的仓库元数据；测试可以在临时目录初始化 Git，但不调用网络，须显式隔离系统/用户 Git 配置及 hooks。
- 项目 B：没有 Git 元数据的合成项目，包含普通说明和笔记，用于验证非 Git 不被忽略。
- 根内排除目录、超出根目录的另一处临时目录、指向根外的符号链接及包含指令注入的文本均为合成负例。平台不支持链接时写明 BLOCKED，不以跳过冒充通过。
- 授权只允许指定主体、根及处理范围内的本地只读观察。A/B 分配不同持久项目 ID、来源及 epoch；未经单独许可，研究、模型、网络、执行器计数均应为零。

现有 `fixture_*` 表中的 A/B 是虚构数据库记录，并非上述目录已被发现或 Git 已被识别。

## 核心闭环及负例

| ID | 输入/操作 | 预期及实际断言 | 当前证据 |
| --- | --- | --- | --- |
| D01 | 授权根 R，扫描 A 与 B | 发现两个独立候选；非 Git B 不被过滤；不越根、不读取排除项 | **NOT RUN**：发现器未实现。 |
| D02 | 同名项目、嵌套目录、边界不清 | 保持各自 ID 或标记待确认；不猜测合并；允许用户校正 | **NOT RUN**：发现/校正接口未实现。 |
| D03 | A/B 对应不同来源与 grant | A 不能查询 B 的事实、决定、观点和反馈；错误 scope 失败关闭 | **FIXTURE PASS**：`tests/fixture-chronicle.test.ts`、`tests/fixture-decision.test.ts`、`tests/fixture-opinion-store.test.ts`。 |
| D04 | 观察事实、公开资料、用户决定及模型推断 | 来源类别、项目、时间、适用版本可追溯；外部材料不能冒充本地观察；模型推断不成为已验证事实 | **PARTIAL**：结构与 fixture 观察/决定见 `tests/domain-contracts.test.ts`、`tests/fixture-decision.test.ts`；可信公开来源与内容核验 **NOT RUN**。 |
| D05 | A 的可信合成事实、观点 v1、用户反驳、观点 v2 与修订原因 | 每条引用匹配项目和来源；反馈不等于事实证伪；v1 保留，v2 有前版和原因，计划不可执行 | **FIXTURE PASS**：`tests/fixture-opinion-store.test.ts`；仅合成存储，并非产品对话或价值验证。 |
| D06 | 对同一观点同时提交两个期望版本为 1 的 v2 | 仅一个成功，另一个冲突，版本与方案无孤儿；旧历史不变 | **FIXTURE PASS**：`tests/fixture-opinion-concurrency.test.ts` 双 worker 单场景；压力测试及 Windows **NOT RUN**。 |
| D07 | 撤权、暂停、过期、来源停用或 epoch 改变 | 此后不读取或写入对应记录；重启后仍如此；旧历史保留但 withheld | **FIXTURE PASS**：`tests/fixture-chronicle.test.ts`、`tests/fixture-decision.test.ts`、`tests/fixture-opinion-store.test.ts`。真实在途读取和缓存策略 **NOT RUN**。 |
| D08 | 用户决定被新版本替代或撤回 | 旧决定及依赖其的观点不再作为当前可用内容；历史不删除 | **FIXTURE PASS**：决定与观点测试；真实身份和用户操作 **NOT RUN**。 |
| D09 | `../`、绝对路径、符号链接越根 | 不打开或读取根外内容；不能因预检通过绕过真正读取边界 | **PARTIAL**：`tests/path-check.test.ts` 只验证预检拒绝；竞态安全打开、在途替换及 Windows junction **NOT RUN**。 |
| D10 | 中断写入/迁移，重启；重复请求 | 事务回滚无半条记录；迁移可重复且保留旧数据；相同键相同内容幂等，冲突拒绝 | **FIXTURE PASS**：迁移、重启、幂等及并发测试；真实进程崩溃注入和所有提交窗口 **NOT RUN**。 |
| D11 | 空来源、损坏 JSON、跨项目引用、旧 epoch、缺少期限/过期 Event | 失败关闭，不伪造结论；历史不得因一次失败覆盖 | **PARTIAL**：合成存储、合同与 `tests/event-freshness.test.ts` 时效预检通过；真实来源与 API 边界 **NOT RUN**。 |
| D12 | 未启用研究/模型/执行，输入伪造 approved/completed | provider、网络和执行器均不被调用；服务端不可直接写完成 | **PARTIAL**：`tests/policy-storage.test.ts` 验证当前入口拒绝；完整服务/API 副作用计数 **NOT RUN**。 |
| D13 | 全局查看 A/B 并深入一个项目 | 仅展示已授权项目、数据覆盖与缺口，项目切换不串线 | **NOT RUN**：全局盘点和对话接口未实现。 |

## 安全合同 S01–S12 的当前映射

| 安全用例 | 当前覆盖与缺口 |
| --- | --- |
| S01 注入 README | **NOT RUN**：无目录读取/模型链；未来需断言文本作为数据且无命令执行。 |
| S02 越界路径 | **PARTIAL**：`tests/path-check.test.ts` 为预检；安全打开与真实读取 **NOT RUN**。 |
| S03 根外符号链接 | **PARTIAL**：预检负例；替换竞态与 Windows reparse point **NOT RUN**。 |
| S04 跨项目查询 | **PARTIAL**：fixture A/B 存储隔离；Card/线程/HTTP API **NOT RUN**。 |
| S05 无审批 L2 直调 | **PARTIAL**：当前执行入口关闭；实际 HTTP、审批和 executor 调用计数 **NOT RUN**。 |
| S06 批准后修改参数 | **PARTIAL**：`tests/digests.test.ts` 检验摘要与幂等键；持久批准二次校验 **NOT RUN**。 |
| S07 授权过期 | **PARTIAL**：fixture 观察授权检查通过；真实审批与真实连接器 **NOT RUN**。 |
| S08 双击/重复副作用 | **PARTIAL**：fixture 写入与反馈幂等；真实执行入口和副作用 **NOT RUN**。 |
| S09 中断重启 | **PARTIAL**：`tests/policy-storage.test.ts` 将模拟中断转为待核验；真实外部副作用崩溃窗口 **NOT RUN**。 |
| S10 来源版本过期 | **PARTIAL**：fixture epoch 失效；真实来源版本和执行前校验 **NOT RUN**。 |
| S11 伪造 verifier | **PARTIAL**：状态与存储测试拒绝无 verifier 完成；真实 verifier 和 API **NOT RUN**。 |
| S12 Panel 注入 | **NOT RUN**：无渲染器/API，不可把 schema 解析当作安全渲染证据。 |

## 当前可复核结果和门槛

`handoff/EVIDENCE/m0-concurrent-revision-check-2026-11-03.txt` 记录 79 项本地测试、类型检查和构建；仅证明其所运行的合成机制。上述目录、实际 API 和未运行安全用例不是 M0 PASS。M0→M1 仍须按 `docs/06-QA-BENCHMARK.md` 完成合同 schema、状态机、policy 负例、migrations 和独立审查，并完成 `tasks/manifest.json` 中合同与失败验收工作。M1 之前不得启动产品纵切；真实 connector 还需单独通过安全 P0 Gate。
