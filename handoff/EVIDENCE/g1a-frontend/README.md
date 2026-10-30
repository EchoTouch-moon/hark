# G1-A 前端工程验收证据

本目录所有测试与截图均基于合成数据与本地隔离服务运行，未连接真实外部模型、不访问用户真实私人目录，日志中的本地仓库绝对路径已脱敏。

## 文本与日志证据

- `typecheck.txt`: 全仓 TypeScript 类型检查输出（`pnpm typecheck`），0 errors。
- `lint.txt`: 全仓 ESLint 输出（`pnpm lint`），0 errors、6 warnings（均为现有 packages/scripts 的未用变量，前端代码 0 警告）。
- `tests.txt`: 全仓单元测试输出（`pnpm test`），57 个测试文件全部通过、459 个用例全部通过。
- `e2e-runtime-mode.txt`: `tests/e2e/runtime-mode.spec.ts` 运行结果，7 个针对性端到端浏览器测试全部通过：
  1. 真实/未知模式失败关闭（包含直接访问 `/demo`、`/cards`），非对话页面不展示全局离线标识；
  2. 无效运行模式门禁阻断，重试恢复；
  3. `legacyDemoAvailable` 缺失或无效、或 `demoMode: false && legacyDemoAvailable: true` 时一律失败关闭；
  4. 昼夜真实时间切换（14:00 白天与 22:00 夜间真实时间注入）、1280×800/1440×900 视口无横向溢出；明确限定标识为「当前对话为 Mock · 离线演示」；
  5. 后端动作执行返回 403 时保留用户草稿，断言实际请求路径为 `POST /api/v1/threads/:threadId/actions/:actionId/execute` 且状态码 403，绝不乐观插入或伪造任何执行进度与完成态；旧本地存储 parts 不回填至服务端消息；
  6. 后端主动建议返回 null 时，等待加载完成并断言清爽主态，绝不注入虚假建议或卡片；
  7. 线程服务异常（如 503）在历史侧栏中清晰展示错误状态与重试按钮，不伪装成「无匹配线程」或正常响应。
- `e2e-hearth-chat.txt`: `tests/e2e/hearth.spec.ts` 中针对对话 Mock、持久化与视口的端到端测试输出，全部通过。

## 桌面与交互截图证据

1. `01-welcome-mock-badge-day.png`: 1440×900 视口白昼时间（14:00），首访欢迎遮罩展示「当前对话为 Mock · 离线演示」明确限定范围标识。
2. `02-welcome-mock-badge-night.png`: 1280×800 视口真实夜间时间（22:00，`data-hearth-period="night"`），深色模式高对比度「当前对话为 Mock · 离线演示」标识。
3. `03-chat-mock-conversation.png`: 对话主界面，聊天头部清晰常驻「当前对话为 Mock · 离线演示」胶囊标签；回复标注「Hearth · Mock」角色，说明由本机模拟生成。
4. `04-desktop-1280x800.png`: 1280×800 标准桌面视口无水平滚动条（overflow <= 0）。
5. `05-desktop-1440x900.png`: 1440×900 桌面视口完整布局与空间关系。
6. `06-real-mode-demo-gate-failclosed.png`: 真实模式下直接访问 `/demo` 或 `/cards` 失败关闭，页面呈现「演示模式未启用」，禁止执行旧演示动作。
7. `07-invalid-mode-error-recovery.png`: 遇到非法或破损健康状态时，失败关闭并展示友好错误提示「无法确认服务端运行模式，请重试。」，重试按钮可按有效状态恢复。
8. `08-action-rejection-draft-preserved.png`: 后端拦截实际路径并返回 `403 LEGACY_ACTIONS_DISABLED` 拒绝旧动作时，前端呈现明确警告，输入框内的草稿文本严格保留，不生成任何虚假进度（如“确认范围: done”）或伪造完成状态。
9. `09-proactive-null-clean-state.png`: 后端主动建议返回 null 时，等待加载彻底就绪后断言并截屏，清爽对话主态，不注入任何本地假卡片或主动建议。
