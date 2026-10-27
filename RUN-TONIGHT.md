# Hearth｜今晚五步运行

1. 下载 ZIP 后解压到一个**新文件夹**（不能覆盖已有个人项目）。
2. 打开文件夹，用终端检查 `node -v`, `pnpm -v`, `git --version`；没有这些工具先安装。
3. 在本地 PI（或 Codex/Claude Code）中**打开这个目录**，把 `prompts/01-NIGHT-LEAD.md` 全文粘贴给 Agent；不是只发文件名。
4. 保持会话/电脑醒着。macOS 如果 `pi` 命令可用，可直接通过 `caffeinate -i pi` 启动 PI；Windows 请插电并设置电脑在运行期间不自动睡眠、不要退出终端。**不要启用跳过审批/全盘高权限模式。**
5. 第二天打开 `handoff/MORNING-REPORT.md`，再独立运行 `python3 scripts/morning_audit.py --run-tests`，按 `docs/09-ACCEPTANCE.md` 实际点击 Home 卡片验收。

**首晚准入**：M0+M1 Mock 真闭环，顺利后再做 M2。**禁区**：真实私人 vault、邮箱/日历发信、GitHub 推送、支付、sudo、真实网站代理操作、修改 Hermes 全局配置。

**状态声明**：此 ZIP 是开发规划包，而非已完成的应用。创建与运行程序需要你在自己的电脑上启动 Coding Agent。
