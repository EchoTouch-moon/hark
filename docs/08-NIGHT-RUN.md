# 08｜无人值守连续开发运行协议

## 本文的重要现实边界
本规划包不能自己在今晚自动运行。必须由用户**在本机开启并保持在线**的 Coding Agent 会话执行。我们不预设 AI 平台具备定时继续、自动绕过工具授权、后台常驻能力。

## 模式
- `MODE=OVERNIGHT_SAFE`：仅写新仓库，允许依赖安装、lint/test/build、UI 调试、fixture 演示；不访问真实账户/私人 vault；不 push。
- `MAX_ACTIVE_HOURS=8`：软上限（人为指定，可改），实际由执行 Agent/终端运行状况决定；无可靠时钟时仅把它当提醒，不声称系统已自动计时停止。
- `MAX_REPAIR_ATTEMPTS=3`：每一独立 root cause 修复三轮仍不通过，记录 Blocker，转独立任务。
- `MAX_PARALLEL_AGENTS=2`：subagents 不能同时改相同文件；主 Agent 负责合并测试。
- `PROVIDER_BUDGET_USD=0`：不做主动付费模型 API 假设。Coding Agent 自身套餐用量无法由本程序准确监控，须由用户平台限额控制。

## 逐任务循环
```
for task in topological_sort(manifest) where overnight=true:
  if dependencies not DONE: mark BLOCKED_DEPENDENCY; continue
  print task + acceptance + allowed files
  implement tests first / before declaring done
  implement minimal code
  run targeted tests && typecheck && build (if possible)
  on success: evidence path, local commit, STATUS
  on failure: classify; 3 retries then BLOCKED and continue another independent task
  if security violation/permission prompt requiring user: STOP dangerous action; mark blocked
```

## 机器可恢复任务队列
`python3 scripts/next_task.py --next` 返回仅依赖已完成的下一项；`python3 scripts/next_task.py --summary` 显示全部状态。完成某项必须先写真实证据文件，然后 `python3 scripts/next_task.py --mark <ID> DONE --evidence <路径>`；阻塞项用 `--mark <ID> BLOCKED --note <原因>`。工具只检查依赖与证据文件存在，**不证明内容真的通过测试**，明早仍需独立审核。

## 每阶段快照
在 M0 完成、M1 API 完成、M1 UI 完成、M1 E2E 完成各写一段 `handoff/STATUS.md`，包含 HEAD、完成率、原始 test exit codes、下一任务、阻塞；必要时本地 commits（`feat(m0):...` 等）。不要在夜间自动 merge 远程 PR。

## 真实账号接入
仅在用户明早审计并明确批准后进入 live provider 或读取个人 vault。Hermes 如果已经运行，可**仅做 API capabilities/health 的非敏感 probe**；启动带工具权限的真实 Agent Run 是另一层授权，不属于默认允许范围。

## 失败恢复
- 没网 → 不要无尽安装依赖；给出 lockfile/依赖安装失败日志，继续实现 docs/代码草稿和 Python 可验证检查。
- CI/工具异常 → 不要用 `|| true` 掩盖退出码；保留尾日志，检查当前能力，替代测试不等同原测试。
- Test flake → 先固定随机种子/时间/fixture；禁止直接跳过关键风控测试。
- 子 Agent 崩溃 → 从 git HEAD 与 STATUS 继续，已有审计与重放结果不要当成已经跑完 E2E。
- 用户明早接手 → 不用口头总结替代 `MORNING-REPORT.md`；显式列出 `DONE/PARTIAL/BLOCKED`。

## 运行方式示意（不要假定 CLI 开关）
1. 打开**新项目目录**，运行用户实际装好的 PI/Codex/Hermes Coding Agent。
2. 复制 `prompts/01-NIGHT-LEAD.md` 粘贴作为任务；Agent 内部按 manifest 调度。
3. 会话必须存活才能继续；睡眠/终端退出/权限等待会中断。不要在无人时选择完全免审计的权限模式。
4. 明早重新进入项目目录验证 `pnpm test`、`pnpm build` 和 UI；按报告对照。

## 暂停/停止
编排器日志必须可以 stop；若开始产生重复有副作用动作、可能泄露隐私或改变真实账户状态，立即中止；已经产生的未知远端结果置 `pending_verification` 并等待人类，不自动重复。
