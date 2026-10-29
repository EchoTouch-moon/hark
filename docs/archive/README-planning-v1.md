# Hearth · Local-first Personal Intelligence Agent

> **规划包版本** `1.0` · **编制** 2026-10-28 · **性质** AI coding-agent 可执行开发合同，**不是已实现软件**。

## 一句话目标
从用户授权的上下文中**主动发现值得解决的问题**，展示有来源的 Action Card，用户点击后按风险授权、执行、核验、记录反馈；以 `Home / Chat / Projects` 为可用入口。

## 如何使用（最短路径）
1. 在 **新建的空目录/新 Git 仓库** 解压本规划包；首次阅读 `RUN-TONIGHT.md`。不要覆盖个人 vault 或其他项目。
2. 阅读 `00-START-HERE.md`、`AGENTS.md`、`docs/01-PRD.md`、`docs/04-CONTRACTS.md`。
3. 开启 PI / Codex / Claude Code 等具备**本机文件、命令、测试**权限的 Coding Agent，复制 `prompts/01-NIGHT-LEAD.md` **全文**作为首条任务。
4. 保持会话运行并配置电脑不休眠；**助手无法在此聊天中控制你本机夜间持续执行**。运行中的本机 Agent 才能完成编码。
5. 明早阅读 `handoff/STATUS.md`、`handoff/MORNING-REPORT.md`，运行 `python3 scripts/morning_audit.py` 并按 `docs/09-ACCEPTANCE.md` 验收。

## Tonight Scope
- **P0**：M0 基础合同/测试 + M1 Mock 数据全闭环 + 真实可操作 localhost UI。
- **P1**：M2 的规则主动发现 / 去重 / 持久化（M1 通过后）。
- **延期**：真实邮箱与日历写入、账户凭据读取、通用桌面控制、支付与购物；M3/M4 仅预留适配层。
- **不会假冒**：API 凭据不存在时，演示必须显著标记 `Demo / Mock`；Hermes 不可用时仍有可测 mock adapter。

## 包索引
| 路径 | 用途 |
|---|---|
| `RESEARCH-BASELINE.md` | 此前 Hark 深度调研原文 |
| `docs/00-RESEARCH.md` | 本次核验的官方资料、证据边界与竞争启示 |
| `docs/01-PRD.md` | 完整产品合同、功能范围、故事、成功准则 |
| `docs/02-UX.md` | 页面信息架构、布局、操作路径、视觉设计 |
| `docs/03-ARCHITECTURE.md` | 分层架构、技术栈、边界、依赖、仓库布局 |
| `docs/04-CONTRACTS.md` | Event/Candidate/Card/Action/Run/Panel、API、状态机 |
| `docs/05-SECURITY.md` | 许可矩阵、注入防护、审批哈希、隐私流 |
| `docs/06-QA-BENCHMARK.md` | 单测、集成、E2E、对抗性样例和基准目标 |
| `docs/07-DELIVERY-PLAN.md` | WBS、阶段 Gate、任务时间与依赖 |
| `docs/08-NIGHT-RUN.md` | 连续开发协议，断点记录、停止规则、模型分工 |
| `docs/09-ACCEPTANCE.md` | 明早人工验收和操作演示剧本 |
| `docs/10-INTEGRATIONS.md` | Hermes、文件、GitHub、Browser Adapter 接入步骤 |
| `docs/11-ADR.md` | 已作决策/取舍、待本机验证问题 |
| `docs/12-DEV-HANDBOOK.md` | 精确开发命令、工程约定、故障排除 |
| `docs/13-PANELS-AND-SKILLS.md` | 后续阶段细节与不抢跑边界 |
| `tasks/manifest.json` | 机器可读任务 DAG、依赖、产出、Gate |
| `tasks/NIGHT-QUEUE.md` | 夜间按优先级推进的任务队列 |
| `tasks/progress.json`、`scripts/next_task.py` | 可恢复任务进度与自动选择下一个可执行任务 |
| `prompts/*.md` | 负责人、开发者、审计、UX 与次日复核提示词 |
| `fixtures/*.json` | **全部合成数据**；真实个人数据不入包 |
| `handoff/*.md` | 持续状态、变更、问题、审计、验收回执 |
| `scripts/*.py` | 规划包完整性检查及明早报告助手 |

## 交付真实性
本包包含**计划/合同/样例/脚本**，不代表 M0/M1 代码已开发完成。Coding Agent 必须在工作目录中自行创建 app、packages 并附带测试、运行证据。不得把“能启动”“能打开 UI”“有一个数据卡片”称为全部端到端完成。

## 约束
Local-first；不使用 Docker；macOS 优先 Windows 兼容；个人 vault 只读；默认不访问真实第三方账号、不推 GitHub、不发送消息、不消费未知 API 费用；无人审批时保留在 `awaiting_approval`。每一个关键结论都要对应测试/截图/终端日志或状态证据。
