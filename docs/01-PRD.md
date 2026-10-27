# 01｜产品需求合同（PRD）

## 1. 定义
代号 Hearth：macOS-first、Windows-compatible、local-first 的个人智能体。目标是“发现 → 解释 → 建议 → 执行 → 验证”，支持用户以一眼可懂的 Home 主动接受建议。默认使用**合成演示数据**，用户授权以后才读真实来源。

## 2. 用户群和 Jobs-to-be-Done
最初服务**唯一使用者**：研究/开发/日程较多、已使用编码 Agent、想少操心琐碎事项的人。
- 当研究 PR 或目标计划发生有意义变化时，我想收到**可操作建议**，而非需要再次分析的通知。
- 当我在 Home 看一张卡片时，我要知道“为什么现在”“依据是什么”“点击将做什么”“是否会改外部状态”。
- 当 Agent 代表我做事时，我希望能看到状态、每步证据、失败原因；未完成就明确未完成。
- 当我忽略它，我希望系统学会减少打扰，不把忽略当成再次提醒。
- 当我讨论一个项目，我希望只访问该 Project 被授权的数据。

## 3. 产品原则
P-01 Zero false claims；P-02 Local-first state；P-03 Silent unless useful；P-04 Verification over fluency；P-05 Least privilege；P-06 Human handoff for side effects；P-07 One useful closed loop before many integrations。

## 4. 信息架构
- **Home** 主动工作台（摘要 + 至多 3 张新动作卡 + 研究/Agent 状态 Panel）。
- **Chat** 常驻会话、运行流、工具步骤、用户 steer/停止；Demo 模式显示 Mock 标识。
- **Projects** 项目列表、资源边界、事件时间线、卡片历史、产物。
- **Activity**（Home 可折叠区）任务列表 + 执行日志/证据。
- **Settings** 全局模式、数据源授权、静默时段、预算、存储位置及测试工具。

## 5. P0 功能合同（今晚）
| 需求 ID | 输入 | 用户行为 | 可观察输出 | 守卫 / 错误 |
|---|---|---|---|---|
| R-01 模拟数据 | `fixtures/events.json` | 初始化 Demo | 事件、项目与 3 张 Cards | 禁止混入真实文件 |
| R-02 主动发现 | 合成事件 | 运行发现 | 有 source_ref、occurred_at、why_now 的候选 | 重复 dedupe_key 不重复上屏 |
| R-03 Card 交互 | 待处理 Card | 查看证据/忽略/稍后 | 证据可见、状态更新、刷新后保留 | 过期卡不可执行 |
| R-04 闭环执行 | L0/L1 ActionSpec | 点击执行 | queued→executing→verifying→completed/failed，trace | verifier 不通过不 completed |
| R-05 Chat | 用户文本 | 提交消息 | 实际回显/Mock Agent 回复，并保留历史 | 明示 Demo，连接失败不伪装在线 |
| R-06 Projects | 项目 ID | 切换项目 | 仅同项目事件、卡片与 Runs | 项目边界服务端过滤 |
| R-07 Persistence | SQLite | 重启服务 | 卡片、运行、忽略状态都还在 | migration 可反复运行 |
| R-08 Safety | 未授权 L2 Action | 请求执行 | awaiting_approval/blocked | 不触发执行器 |
| R-09 Settings | 日预算/quiet hours | 保存 | 新建议展示服从规则 | 时区可配置，DST 测试 |
| R-10 Evidence | 某 TaskRun | 展开详情 | 完整状态/验证结果、时间和作用目标 | 不吐敏感 payload |

## 6. P1/P2 功能合同
- P1（M2）：授权仓库只读 connector、文件 watcher（单独 allowlist）、规则+可选 LLM 候选审查、同主题 cooldown、事件过期、反馈排序、重启恢复。
- P2（M3）：隔离的 Playwright only-on-demo-site、批准哈希、只读网页摘要、截图与恢复；Tauri 封装；真实外部操作需另行安全评审。
- P3（M4）：白名单 PanelSpec 生成/编辑、轨迹产生候选 SpecialtyDraft，审核后才能安装 Skill。

## 7. 明确不做
- 不自行训练 computer-use 模型；不承诺像 Hark 一样买票/支付；不支持真实社交帐号代操作；不支持首晚全系统 GUI 自动控制；不迁移或编辑用户现有记忆仓库。
- 不自动关联邮箱/日历/私人项目；没有账户授权不尝试伪装登入。

## 8. UX 质量要求
- Home 从启动到合成 Action Card 可见；desktop 视口 1440×900 与 1280×800 无水平滚动。
- 所有状态有 empty/loading/error；键盘可聚焦的操作控件；对 reduced-motion 做降级。
- 每个动作用人类语言列出**将要产生的外部影响**；人工批准必须绑定具体参数。

## 9. 设计目标（不是事实）
- 合成 fixture 重放：≥ 10 次 idempotent，不出现重复完成。
- 演示动作 100% 带 verifier 回执。
- 未授权副作用 0 次；跨项目信息泄漏 0 次。
- P1 50 条固定 fixture 的 Precision@3 ≥ 0.75；去重率/误报有日志和置信区间报告，而非自我评价。

## 10. 场景故事（不可省略）
**A 研究任务**：观察 Project-R 的 `build_failed` 事件 → 生成“检查测试失败” Card → 点击 → Mock Executor 在 `./.hearth-demo-artifacts` 写诊断 JSON/MD → Verifier 核对 hash/schema → completed；刷新仍在。
**B 学习计划**：某研究 Decision 明确下一步尚未完成 → Card「生成实验清单」→ 写受控 demo-artifact → 验证存在+非空。
**C 邮件冲突**：合成会议冲突事件 → Card「草拟调整邮件」→ 保存 draft 本地文件 → 试图直接发送邮件被 deny；完成只表示 draft 已生成。

## 11. Success / Failure 定义
- **成功**：从可追溯事件生卡 → 人点击 → 被允许的动作 → 真实执行器给出结果 → 独立 Verifier 成功 → 审计可复验。
- **失败**：页面空壳、仅客户端改状态、缺文件/数据证据、无保护时执行 L2、用假图/假结果替代运行、测试通过未能复现。
