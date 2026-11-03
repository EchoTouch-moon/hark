# G1-A 项目作用域与恢复：本机合成证据

基线 `bot/hearth-g0-contract@6ef6fe00c90545749f8beef25ac5753e13ccc8e9`；测试在隔离工作区、临时 SQLite 和临时产物目录运行，Mock adapter、无真实模型和私人项目。路径、进程号已脱敏。表征测试按实际旧行为断言，不表示安全验收通过。

| 检查 | 结果 | 日志 |
|---|---|---|
| 项目/线程行为表征 | 3/3：分别观测到项目不匹配写入、未知线程自动创建、未知项目线程被接受 | `scope-characterization.txt` |
| 执行/验证中断恢复 | macOS：合成状态写入子进程后 SIGKILL，再用另一进程恢复；两例均 pending_verification，Fake Executor 0，evidence 不增加，新增一条 legacy-disabled 审计，第二次恢复无动作 | `recovery-characterization.txt` |
| 已有 G1-A、storage 和 orchestrator 测试 | `pnpm exec vitest run apps/server/src/http/g1a-security.test.ts packages/storage/src/storage.test.ts packages/core/src/orchestration/orchestrator.test.ts`：50/50 | `baseline-targeted.txt` |
| 类型检查 | `pnpm typecheck`：exit 0 | `typecheck.txt` |

`code-review.md` 记录内部证据复核及独立复跑 50 项测试；其结论不代替后续正式安全验收。

恢复测试是在**预置状态之后**杀死等待中的合成子进程，不是在运行中的执行器中断，不覆盖 completed→evidence 窗口，不覆盖真实数据、真实 Provider 或 Windows 进程终止。项目表征是单主体下数据上下文行为，不证明多租户越权。项目详情、卡片/run、SSE、并发多窗口及其他路径未完整验证。

## 源码与复现

为避免把“旧的不安全行为”固定为长期安全测试，实验源码作为文本保存，不纳入默认测试。仅在干净、隔离的相同基线工作区运行，先检查以下目标路径不存在；测试只创建临时目录和合成数据，结束后删除这些临时测试文件。注意 SIGKILL 验证仅在 macOS 上运行过。

```sh
cp handoff/EVIDENCE/g1a-scope-recovery-2026-11-02/scope-characterization.test.txt apps/server/src/http/g1a-scope-characterization.test.ts
pnpm exec vitest run apps/server/src/http/g1a-scope-characterization.test.ts
cp handoff/EVIDENCE/g1a-scope-recovery-2026-11-02/recovery-characterization.test.txt tests/unit/g1a-recovery-characterization.test.ts
cp handoff/EVIDENCE/g1a-scope-recovery-2026-11-02/recovery-characterization-fixture.txt tests/unit/g1a-recovery-characterization-fixture.ts
pnpm exec vitest run tests/unit/g1a-recovery-characterization.test.ts
```

正式修复须先明确作用域合同和旧数据策略，再将期望的拒绝行为写成长期回归；此证据不能替代 G1-A 的完整安全认证。
