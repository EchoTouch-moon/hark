# 当前待办（2026-11-03）

- 测试收集事故：克隆参考仓库后，旧 `pnpm test` 意外收集了其测试，运行约 10 秒后主动中断（退出码 130）；输出确认部分原型测试已结束，未显示的测试可能已并发启动。原型测试源码包含临时文件、真实子进程和 loopback 服务等行为，无法仅凭已有输出确定哪些副作用实际发生，也不能确认是否有其他外部访问或残留进程。上述结果不计入 Hearth 验收。已通过 `vitest.config.ts` 限定 Hearth 测试目录；`pnpm exec vitest list --config vitest.config.ts` 及后续测试结果见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。只读复核未发现固定访问禁用私人目录的目标，但不应将其当作完整取证结论。
- M0 Gate 未通过：基础 schema、状态机、policy 与 migration 有局部测试，但合同逐字段复核、完整策略及安全反例、独立审核尚未完成。按 `tasks/DEVELOPMENT-PROGRESS.md` 继续；不能进入 M1。
- 用户已明确授权推送和处理余下 PR/关联分支。本次重建通过 GitHub 的 PR 与必需检查落地，不改变分支保护。
- `bot/hearth-g0-contract` 受分支规则保护并禁止删除；现有规则生效时保留该分支，不通过修改保护绕过。
- 重建版本无可运行完整产品；真实路径、审批执行和验证器尚未接入，保持关闭。
