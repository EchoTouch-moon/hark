# 当前待办（2026-11-03）

- M0 Gate 已由 R2 独立只读复审**通过**（仅限基础合同范围，基线 `46ab047`）：contracts schema、状态机、policy 负例、migrations 与威胁模型均通过，见 `handoff/qa/M0-GATE-REVIEW-R2-2026-11-03.md`。动作准入仍只有纯预检（`src/action-policy.ts`），未接可信持久化、身份认证、事务内 grant 占用和执行器；它们是 M1 的启动前置，不是 M0 门禁。S01/S12 与真实 API/connector 安全反例仍 NOT RUN。
- 合成观点存储支持观察和用户决定 fixture，尚不支持可信研究来源或真实用户决定；真实身份认证、正式项目生命周期、真实目录读取、并行 CAS 压测均未完成（两个 worker 的单次真实竞争已通过）。反馈 v2 已支持明确拒绝，真实用户交互尚未实现。
- fixture Chronicle 不验证真实项目事实或路径；仍需可信来源、项目生命周期、目录安全读取、观点版本与反馈持久化。不得使用其合成结果声称真实项目已被观察。
- M0-A 结构首版已实现；fixture 内的来源授权、观点版本与双 worker CAS 已局部验证。真实来源、API 边界与正式项目生命周期仍缺，模型输出不可凭 schema 升格为事实或可展示观点。后续需完善 M0-B 和安全反例。
- CI 工作流已在本地配置 Mac/Windows 分支触发及 macOS/Windows 平台任务，尚未推送或在远端运行。`pnpm lint` 是有限的 TypeScript 编译器规则检查；`pnpm test:e2e` 未配置，Windows 未实机验证；当前仅有本机测试证据。
- 测试收集事故：克隆参考仓库后，旧 `pnpm test` 意外收集了其测试，运行约 10 秒后主动中断（退出码 130）；输出确认部分原型测试已结束，未显示的测试可能已并发启动。原型测试源码包含临时文件、真实子进程和 loopback 服务等行为，无法仅凭已有输出确定哪些副作用实际发生，也不能确认是否有其他外部访问或残留进程。上述结果不计入 Hearth 验收。已通过 `vitest.config.ts` 限定 Hearth 测试目录；`pnpm exec vitest list --config vitest.config.ts` 及后续测试结果见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。只读复核未发现固定访问禁用私人目录的目标，但不应将其当作完整取证结论。
- 进入 M1 接线前必须先完成：执行前校验改为从受信任 store 在事务内读取并对 grant 做一次性占用、身份认证、结构化 verifier verdict、`runs.state`/`approvals.consumed_at` 的 DB 级约束。否则纯预检无法识别"整份基座伪造"，也不能作为授权边界。
- 用户已明确授权推送和处理余下 PR/关联分支。本次重建通过 GitHub 的 PR 与必需检查落地，不改变分支保护。
- `bot/hearth-g0-contract` 受分支规则保护并禁止删除；现有规则生效时保留该分支，不通过修改保护绕过。
- 重建版本无可运行完整产品；真实路径、审批执行和验证器尚未接入，保持关闭。
