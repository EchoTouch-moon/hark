# 06｜QA、实验设计与可重复验收

## Test pyramid
1. **Contracts**：所有 Schema 正例/缺字段/越界/未知字段；state machine 非法转换；批准 digest；canonical hash。
2. **Core**：Event 去重、候选评分、安静时段、冷却、expired 拒执行、跨项目过滤。
3. **Storage**：migration 同时顺序/重复运行，事务重启，唯一 idempotency key，读写状态一致。
4. **API Integration**：合法/非法请求；origin/CSRF；重复 execute；并发抢跑；取消/超时；读写权限。
5. **E2E**：Home→Card→Evidence→Execute→Run→Verifier；刷新保留；Projects 隔离；Chat mock；Settings；1280/1440。
6. **Adversarial**：`fixtures/adversarial.json` 中注入/越权/重放/路径逃逸。所有关键安全用例必须断言服务端**不执行**。

## 用例主表
| Test ID | 流程 | 成功条件 |
|---|---|---|
| E2E-01 | Demo seed→discover→open Home | 3 个合成卡片，含 evidence/whyNow |
| E2E-02 | Card A → 查看 Evidence→执行 | 产生 run，有真实 artifact hash 验证 |
| E2E-03 | 刷新/关闭重启 | 历史 run state 一致 |
| E2E-04 | 同卡连续点两次 | 同一 run / 明确 409，无双副作用 |
| E2E-05 | Card 过期后点击 | denied/expired，不产生新 run |
| E2E-06 | Card ignore/snooze | 正确抑制；到期前不重现 |
| E2E-07 | Project-A→Project-B | 不返回 A 的 cards/events |
| E2E-08 | Chat Mock 发送消息 | 可保存、展示 Demo 标识，不声称真 Hermes |
| E2E-09 | 非法 L2 执行 | waiting approval / no executor call |
| E2E-10 | 造假 verification result | 不完成；`pending_verification/failed` |
| E2E-11 | 无事件 | 静默空态而非假建议 |
| E2E-12 | Server 不可用 | 页面真实错误状态，不出现成功回执 |

## 必须记录 evidence
`handoff/EVIDENCE/test-contract.txt`, `test-core.txt`, `test-integration.txt`, `test-e2e.txt`, `security.txt`, `build.txt`, `ui-home.png`, `ui-chat.png`, `ui-projects.png`, `demo-run.json`。若环境不支持截图，必须写 `NOT_CAPTURED` 和阻塞，不得空造图片。所有证据文件脱敏。

## 审查和基准
- 不能把 self-reported `completed` 当完成；必须有 `/runs/:id`、 artifact hash、verifier verdict。
- 50 条回放使用 40 正常/10 负例（含冗余、陈旧和越权），固定 seed 和评分规则；夜间可以先创建 fixtures 和 bench harness，不要求达到未来数值。
- Precision@3 计算：展示前三条中真正有参考答案标注 `useful=true` 的比例；不以 LLM 自评代替 label。
- 记录自动介入频率、用户打扰次数、去重命中率、成功运行比例、成本；未测项写 `NOT_MEASURED`。
- 对照模式：Rule-only/Rule+LLM；Mock Executor/Hermes；有无 provenance，比较效益而不是拍脑袋。

## CI / 本机 Gate 精确命令
- `pnpm install --frozen-lockfile`（有 lockfile 时）
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`（需要浏览器依赖；不可用则 BLOCKED 并记录）

以上是**预期命令合同**。AI 实现时必须在根 `package.json` 配好并真正运行，不能无脚本却在报告说通过。依赖离线缺失可先完成 static/local tests，实际执行标记未通过。

## Gate 规则
M0→M1：contracts schema、状态机、policy 负例和 migrations 测试通过； `AGENTS.md` 与威胁模型存在。
M1→M2：运行完整 E2E-01～E2E-12 的适用用例，无法运行者精确注明；`pnpm test`、`build` 不红；mock 闭环独立可见。
M2→M3：真实 connector 数据保护测试通过、错报与重复率可测；没有真实授权就不入 M3。
