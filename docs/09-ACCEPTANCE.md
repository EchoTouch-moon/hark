# 09｜2026-10-29 明早验收手册（按实际时区为准）

## A. 自动证据检查
```
python3 scripts/validate_pack.py
python3 scripts/morning_audit.py
# 由 Coding Agent 确实创建项目后运行：
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```
用测试脚本实际退出码填表。环境缺失/命令不存在算 `BLOCKED/NOT_RUN`，不得归为 PASS。

## B. UI 现场走查（人工需能观察）
1. 启动 web/server（依 README-dev 实际命令）并访问本机地址。找到显眼的 **Demo / Mock** 标识。
2. Home 显示 3 张来自 `fixtures/events.json` 的可追溯建议；点 `查看证据` 能看到事件 ID、来源、日期、 whyNow。
3. 点 `开始诊断`，看 TaskRun 经 queued→executing→verifying→completed，展开文件证据，查看真实 artifact 和 sha256。若只变绿却无工件，**FAIL**。
4. 连点两次执行，看是否同一 Run/409，不生成重复工件；刷新页面看状态保留。
5. 点击忽略和稍后，刷新/重新 discovery 不立即出现相同卡。
6. 切换 Project Atlas/Beacon，检查两者数据分隔。打开 Chat，发送一句消息；Mock 模式应真实标明。
7. 在 Settings 改 quiet hours / daily card limit，观察后端保存后刷新依然有效。
8. 对合成 L2 外部发信任务尝试 `/execute`，应停 `awaiting_approval` 或 `blocked`，不能对外发送。
9. 停掉 backend，看 UI 是否提示网络不可用而不是继续展示伪造成功。

## C. 文件/代码复核
- Repo 独立：没有修改真实个人 vault、Hermes 全局目录、其他项目。
- 有真实 migrations、server handlers、严格合同、TS typecheck、tests；不是纯 Figma/demo 图。
- 检查 git status 没有 secrets、`.env`、真实 `.sqlite`、浏览器 Profile/cookies。
- 没有 `dangerouslySkipPermissions`、`--no-sandbox` 或直接 OS 高权限自动执行。
- 核实第三方源数据与成果真实来源链；浏览器模拟就写模拟，真实 Hermes 未启用就写未启用。

## D. 成绩判定
- **GREEN (M1 usable)**：M0 Gate + M1 垂直全链通过；测试构建通过；用户亲自完成上述关键动作。
- **YELLOW (partial)**：页面/API 已有但 1–3 项未通过，阻塞位置具体可复现。
- **RED (not usable)**：只有静态 UI、没有后端真闭环、无法运行，或任一安全红线被触犯。

## E. 交接材料最小集
`handoff/MORNING-REPORT.md`: 时间、HEAD、运行命令与端口、实现页面表、任务进展、测试与退出码、E2E 证据路径、已知 bug、账号接入状态、明日优先 5 件事、用户必须审批事项。

## F. 明早给审计 Agent 的提示词
复制 `prompts/04-MORNING-AUDIT.md`，让独立审查 Agent **重新运行实际命令**；不要仅阅读前一个 Agent 的总结。
