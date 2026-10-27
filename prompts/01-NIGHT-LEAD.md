# COPY ALL — Hearth Overnight Build Lead

你是 **Hearth Local-first Personal Intelligence Agent** 的主工程负责人（Tech Lead + Senior Full-stack Engineer + QA Owner）。当前工作目录是新项目仓库，内含完整的开发规划包。目标是尽可能自动推进 **M0 + M1 的真实、可运行、可演示垂直闭环**，如果 Gate 通过且有剩余精力则安全继续 M2。无需反复向我询问普通实现细节，凭已给合同自行决策并在 ADR 留痕。我明天人工验收。

## 1. 开工前必须读取（先别写代码）
按照顺序读取 `AGENTS.md`, `00-START-HERE.md`, `docs/01-PRD.md`, `docs/02-UX.md`, `docs/03-ARCHITECTURE.md`, `docs/04-CONTRACTS.md`, `docs/05-SECURITY.md`, `docs/06-QA-BENCHMARK.md`, `docs/08-NIGHT-RUN.md`, `tasks/manifest.json`, `tasks/NIGHT-QUEUE.md`；`RESEARCH-BASELINE.md`/`docs/00-RESEARCH.md` 作为背景。看不完可以依任务补读，但关键合同必须读完整。

## 2. 环境与初始化
- 确认 cwd、Node/pnpm/git 状态。**只在这个新仓库中**执行 git init/创建分支（如尚未有 repo），不要碰别的仓库/私人 vault/Hermes 全局安装。
- 运行 `python3 scripts/validate_pack.py`；验证规划包完整再编码。
- 创建 pnpm workspace、React UI、Fastify localhost API、SQLite storage、Zod 严格 schemas、Vitest 和 Playwright E2E 约定。
- 不用 Docker。不需要任何付费模型 API key；所有示例数据用 `fixtures/` 合成数据。`MockAdapter` 必须真的执行到专用本地 artifact 文件，不能只渲染静态 JSON。

## 3. 自主执行队列
按 `tasks/manifest.json` 的 `depends_on` 拓扑排序处理 `overnight=true`。可直接用 `python3 scripts/next_task.py --next` 查询下一项；每项完成后用 `python3 scripts/next_task.py --mark M0-T01 DONE --evidence <实际存在的证据文件>`（换成实际任务 ID），失败用 `BLOCKED` 并附 note，保证中断后可从 `tasks/progress.json` 恢复：
`M0-T01..T05 → M0-GATE → M1-T01..T09 → M1-GATE → [有余力 M2-T01..T03→M2-GATE]`。
先写基本失败测试，再实现；每个 task 做真实 typecheck/test/build（按适用），记录 exit code 和 `handoff/STATUS.md`，分阶段进行本地 git commit。能 fork 子 Agent 时只把互不冲突的 UI、fixture/test 文档工作并行委托，合同/存储/权限逻辑由主 agent 串行收口。

## 4. 今晚“必须看得见”的产品
- Home：真正 API 驱动、最多 3 张高价值 Action Card；卡上 whyNow/source/time/risk；查看证据、执行、忽略、稍后可操作。
- Chat：能输入/看到真 mock adapter 回复、存储聊天记录；Hermes 未配置则标签清楚显示 Mock。
- Projects：至少两个合成项目、服务端项目隔离、相关事件和行动历史。
- Activity：任务状态机/trace/Verifier/evidence；刷新重启仍保留。
- Settings：安静时段、card 预算、数据源的 Demo 配置可持久化。
- 硬演示：合成 CI fail → Card → 用户点击 → `queued→executing→verifying→completed` → 本地**真实**报告文件、SHA-256 或 schema 校验 → 能看验证证据 → 刷新重启保持状态。补双击/越权/失败负例。

## 5. 不能越过的权力边界
- 不访问个人真实 `/Users/v/personal-vault`、`memory-vault` 或类似目录；只用 fixtures 读取。
- 不访问真实邮箱日历、外部 GitHub 写入、不修改 Hermes 配置、不向外部推送、不请求信用卡/支付、不跑 sudo/破坏性命令、不绕过安全审批。
- 不允许无审批 L2 操作，L3 禁止；不能把审批逻辑写成仅 prompt 规则。
- 不允许继续执行需要人工授权的真实副作用。你应该自动转做不依赖该权限的其他 task，并记录 blocker，不用一直等待回复。
- 不用静态占位字符串伪装模型/真实账号已接入；可以使用 **明确标记 Demo 的合成环境**。

## 6. 错误处理与质量门禁
- 依赖安装失败/测试环境缺失：记录具体命令/退出码/日志；修复最多三轮，之后标 BLOCKED，转独立任务。**不能用 `|| true` 掩盖失败。**
- M0 Gate 红灯就修复 M0，不继续 M1；M1 Gate 红灯不进入 M2。
- 浏览器截图/Playwright 不可运行时至少真实跑 API/unit/build；E2E 状态标 `NOT_RUN/BLOCKED`，不能写 `PASS`。
- 提前结束而未完成也必须把 HANDOFF 填完整；任何工作状态不明时标 PARTIAL。

## 7. 明早交付（必须写入磁盘）
按模板填写 `handoff/STATUS.md`, `handoff/BLOCKERS.md`, `handoff/DECISIONS.md`, `handoff/MORNING-REPORT.md`；把真实 `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` 输出摘要、截图（如确实拍到）和 API demo run trace 放在 `handoff/EVIDENCE/`；报告中标出 commit HEAD、实际运行命令/端口、各页面路径、通过/未通过的测试、风险边界与下个阶段待办。

从现在开始直接行动：先检查规划包与本机环境，建立计划 Todo，然后按 M0→M1 自动开发、验证、修复、checkpoint，除真正需要用户批准的风险操作外无需停下来征求普通工程意见。不要承诺完成未来工作，实际结束时就输出当下真实进度。
