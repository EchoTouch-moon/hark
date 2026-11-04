# 当前待办（2026-11-03）

- **真实 StepFun 已有一次授权调用，但没有 Hark 页面闭环**：2026-11-04 用 `stepfun-plan/step-5-preview` 询问项目别名 `glm-words` 的 README 与 pyproject 摘要。没有读取 `.env`、数据库或源码，没有第二次请求，也没有预览 ID 或 `runId`。记录见 `handoff/EVIDENCE/m2-pi-01-live-glm-words-2026-11-04.md`。下一次真实调用应走页面预览和单次确认，并留下脱敏关联证据。
- **M1→M2 独立 Gate 仍未通过**：本次实现不把 M2 记为 PASS，也不打开真实目录、后台研究或自动执行。
- **M1→M2 Gate 未通过**：Mock 追问持久化已补齐，但 B-C1 独立只读复核请求被自动审查以可能涉及网络安全风险为由拦截，整体 Gate 独立复审尚未完成。恢复时由有权限的独立审阅者审查 `handoff/qa/M1-SYNTHETIC-ACCEPTANCE-2026-11-04.md`、当前差异与适用性；不得把本机自查当作独立通过。可复跑 `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`；浏览器测试依赖 Python Playwright 与可用 Chromium/Chrome。
- **2026-11-04 A-C3 独立复审 BLOCKED**：原目录替换、旧句柄复用及子目录已移出后的后续访问已有定向修复；授权根整体移动仍可用。但检查和实际读取之间的移动仍可复现，详见 `handoff/qa/M1-A-C3-MOVE-CHECK-2026-11-04.md`。该修复未通过 A-C3 或 P0；真实 connector 不得启用。原审查记录保留于 `handoff/qa/M1-A-C3-REVIEW-R2-2026-11-04.md`。
- Windows 合成发现适配器按合同保持 `unavailable`，本机未跑 Windows 实机。恢复命令：在 Windows 上 `pnpm test -- tests/fixture-discovery.test.ts`，确认 `adapter_unavailable` 且无 `realpath` 回退；POSIX 适配器曾通过的局部场景见 `handoff/EVIDENCE/m1-a-c2-fixture-discovery-2026-11-04.txt`，其安全边界未通过 A-C3。不能把 macOS 局部测试当成 Windows 路径安全。
- 历史：首轮 A-C3 修复见 `handoff/EVIDENCE/m1-a-c3-fix-2026-11-04.txt`；复审发现新问题，当前结论以上方条目为准。B-C1 改依赖 A-C4，真实用户目录、P0 connector Gate、执行通道仍关闭。
- M0 Gate 已由 R2 独立只读复审**通过**（仅限基础合同范围，基线 `46ab047`）：contracts schema、状态机、policy 负例、migrations 与威胁模型均通过，见 `handoff/qa/M0-GATE-REVIEW-R2-2026-11-03.md`。动作准入仍只有纯预检（`src/action-policy.ts`），未接可信持久化、身份认证、事务内 grant 占用和执行器；它们是接入执行能力的前置，不阻塞合成只读 M1。S01/S12 与真实 API/connector 安全反例仍 NOT RUN。
- 合成观点存储支持观察和用户决定 fixture，尚不支持可信研究来源或真实用户决定；真实身份认证、正式项目生命周期、真实目录读取、并行 CAS 压测均未完成（两个 worker 的单次真实竞争已通过）。反馈 v2 已支持明确拒绝，真实用户交互尚未实现。
- fixture Chronicle 不验证真实项目事实或路径；仍需可信来源、项目生命周期、目录安全读取、观点版本与反馈持久化。不得使用其合成结果声称真实项目已被观察。
- M0-A 结构首版已实现；fixture 内的来源授权、观点版本与双 worker CAS 已局部验证。真实来源、API 边界与正式项目生命周期仍缺，模型输出不可凭 schema 升格为事实或可展示观点。后续需完善 M0-B 和安全反例。
- `c69250e` 的远端 Linux/macOS/Windows CI 均通过，见 `handoff/EVIDENCE/m0-ci-c69250e-2026-11-04.md`。`pnpm lint` 是有限的 TypeScript 编译器规则检查；`pnpm test:e2e` 未配置，用户本机 Windows 与真实路径尚未验证。
- 测试收集事故：克隆参考仓库后，旧 `pnpm test` 意外收集了其测试，运行约 10 秒后主动中断（退出码 130）；输出确认部分原型测试已结束，未显示的测试可能已并发启动。原型测试源码包含临时文件、真实子进程和 loopback 服务等行为，无法仅凭已有输出确定哪些副作用实际发生，也不能确认是否有其他外部访问或残留进程。上述结果不计入 Hearth 验收。已通过 `vitest.config.ts` 限定 Hearth 测试目录；`pnpm exec vitest list --config vitest.config.ts` 及后续测试结果见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。只读复核未发现固定访问禁用私人目录的目标，但不应将其当作完整取证结论。
- 接入执行能力前必须先完成：执行前校验改为从受信任 store 在事务内读取并对 grant 做一次性占用、身份认证、结构化 verifier verdict、`runs.state`/`approvals.consumed_at` 的 DB 级约束。否则纯预检无法识别"整份基座伪造"，也不能作为授权边界；M1 合成只读路径仍需自己的范围、撤权及来源校验。
- 用户已明确授权推送和处理余下 PR/关联分支。本次重建通过 GitHub 的 PR 与必需检查落地，不改变分支保护。
- `bot/hearth-g0-contract` 受分支规则保护并禁止删除；现有规则生效时保留该分支，不通过修改保护绕过。
- 重建版本无可运行完整产品；真实路径、审批执行和验证器尚未接入，保持关闭。
