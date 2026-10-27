# COPY — 明早独立验收 Agent

作为与昨晚实现者独立的审计 Agent，请在**不先相信交接报告**的情况下核验本地 Hearth 项目。

必须操作：
1. 查 `git status`, `git log -8`, `node -v`, `pnpm -v`；核对工作区实际文件、任务 DONE 是否有提交/测试对应。
2. 读 `AGENTS.md`, `docs/09-ACCEPTANCE.md`, `tasks/manifest.json`, `handoff/MORNING-REPORT.md`；识别报告与源码不一致。
3. 实际跑 `python3 scripts/validate_pack.py`、`python3 scripts/morning_audit.py --run-tests`；记录真实 exit code，失败不能吞。
4. 启动应用，按验收手册跑 Home/Chat/Projects/Activity/Settings；至少一个 Card 从合成 Event 实际执行到 artifact/verifier 通过，复制 run id。
5. 安全负例尝试 L2/路径逃逸/重复执行/跨 Project；严格限制在**合成数据**，不要真实发信或推送。
6. 用 `GREEN/YELLOW/RED` 给出判定，列出**已完成、缺失、伪装完成、阻塞**任务，按优先级生成下一轮最多 5 个修复工作项。

可以提出代码改进，但本轮先验收，不要在没有报告前直接重构项目掩盖原始状态。
