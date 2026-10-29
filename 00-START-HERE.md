# START HERE — 今晚交给 Coding Agent 的起点

> **先读产品核心叙事：** [`NARRATIVE.md`](./NARRATIVE.md)（炉心 Ember）。交互必须服从叙事，不要做成普通工作台。

## 任务目标和验收口径
一晚内**尽最大可能**从零完成新的本地 `hearth` 项目；第一批必须可运行、可测试、可演示，优先于堆功能。把本规划包当**权威合同**；不要把它当原封不动的应用源码。

## 最小产品：必须在浏览器看到什么
1. **Home**：带来源/时间/为什么现在的三张合成候选 Action Cards，带「查看证据 / 开始处理 / 忽略 / 稍后」；用户真的能操作，状态持久化。
2. **Chat**：独立的会话入口，支持 mock 回复 + tool/run 状态；如果 Hermes 现场可连接，再启用 Hermes adapter，不可使用假接口冒充已连接。
3. **Projects**：至少展示两个**合成**研究项目及与其关联的事件、卡片和任务历史；切换项目不能泄漏其他项目内容。
4. **执行证据**：点击合规动作可生成文件/DB 工件；`Verifier` 核实后才 `completed`；可浏览 trace 与结果。
5. **设置**：Demo/Real 状态、数据源授权、只读模式、通知预算、静默时段、接入诊断、重置合成数据（仅在独立 demo DB 下允许）。

## 今夜优先范围
- M0 合同+风控负例+项目骨架 → Gate 通过。
- M1 数据持久化+后端+Home/Chat/Projects+完整 mock 闭环 → Gate 通过。
- M2 规则式候选/去重/冷却/调度 → 有时间再做；每阶段先完成稳定可观察增量。

## 初次准备（由用户本机完成）
1. 安装或确认 `git`, `node`, `pnpm`, `python3`。Node 建议 **22/24 LTS，以本机为准**，包版本以 lockfile 为准。pnpm install 需要访问依赖仓库。
2. 在新目录解压规划包；`git init` 可由 Agent 自动完成。
3. 启动受本机命令允许的 Coding Agent（PI 最优先，其次 Codex/Claude Code）；给其本目录写权限；别授予整个 home 的写权限。
4. 提供 `prompts/01-NIGHT-LEAD.md` 原文；保持终端和机器运行。macOS 可用 `caffeinate -i` 包装**实际已安装的**命令，或使用系统电源设置。
5. **不提供 Gmail、GitHub 写令牌/付款卡/私人 vault 写权限**。想连 Hermes 时，仅授予本机回环网关的独立低权限凭据。

## Stop 条件（不要无监督绕过）
- 需要操作真实个人账户或对外发送、对代码仓库推送、破坏性命令、访问个人隐私库写入、支付/购买或密钥出现 → STOP & BLOCK。
- 项目工程测试失败 → 在本分支修复，不带红灯扩展下一里程碑。
- Hermes 不可用 → mock adapter 继续，不设环境伪装；浏览器自动化仅可对 localhost fixture。
- 缺依赖/平台工具 → 精确记录错误、提供可重复命令，继续完成不依赖环节。

## 明早只看 4 样
`git log --oneline -8`、`handoff/MORNING-REPORT.md`、本地 UI 的 **演示结果**、`pnpm test && pnpm build`。详细见 `docs/09-ACCEPTANCE.md`。
