# G1-A 项目作用域与恢复：合并 A-01 后的安全基线

状态：**基线与局部表征完成；项目作用域合同待审；G1-A NOT_PASSED**。代码基线 `bot/hearth-g0-contract@6ef6fe00c90545749f8beef25ac5753e13ccc8e9`，PR #32 squash merge；G0 [Actions run 41414610654](https://github.com/EchoTouch-moon/hark/actions/runs/41414610654) 的 Linux、Windows 和 `ci-gate` 均成功。CI 不等于完整 G1-A 安全验收。

## 已证实的项目上下文行为

使用单一本地 session、两个合成项目与两条预绑定线程，经 Fastify 真实路由和隔离 SQLite 表征，详见 `handoff/EVIDENCE/g1a-scope-recovery-2026-11-02/`：

1. thread-a 存储绑定 atlas，请求写入声明 beacon 时，`POST /api/v1/chat` 返回 200，thread-a 的消息数量由 1 增至 3（用户消息与 Mock 回复），thread-b 未变；带 beacon 查询参数请求 thread-a 历史返回 200 且含该合成标记。当前 `routes/chat.ts` 使用 thread ID，未在这些路径验证请求的 projectId 与线程绑定。
2. 对未知 thread ID 的聊天请求返回 200，隐式创建 `projectId=null` 的线程和两条消息。
3. 以不存在的 projectId 创建线程返回 201，线程保存该 ID。审计相应增加一条记录。

这些是实际行为与拟议项目焦点隔离目标之间的缺口，**不是**已证明的多租户越权：当前系统为单主体本地会话，还需界定谁可选择全局/项目上下文。`GET /threads` 的全局列表也不能直接认定为泄露。cards/runs 详情、反馈、取消、SSE、并发切换等尚未完成双项目动态矩阵。

## 恢复和 reset 当前证据

- 对合成 SQLite 分别预置 executing/verifying，真实 SIGKILL 等待中的子进程并启动另一个进程恢复：两例均变为 `pending_verification`，Fake Executor 调用 0、evidence 和产物不增加，新增一条 `legacy-disabled` 审计；重复恢复无动作。仅在 macOS 做了此定点模拟，未覆盖执行器运行期间崩溃、completed→evidence 非原子窗口或 Windows 终止语义，不将其升级为完整恢复 PASS。
- `Storage.resetDemoData()` 在写锁内遇到来源不明的待清理数据即拒绝并回滚，审计保留；混合数据等既有测试包含于本轮 50 项局部回归。当前没有可信逐条 Demo 归属，纯 Demo 数据也可能拒绝；API 与禁用的前端入口、错误文本的一致性以及可信隔离模型需独立处理，不能放宽以换取可重置。
- 本轮 50 项相关已有测试和 typecheck 通过。此前 CSRF / restricted 事件 / 执行禁用只按各自已验收范围计算，不能外推到 scope、全量恢复或真实数据安全。

## 下一独立批次：项目作用域合同与最小修复方案（待审）

PR #31 的 ADR-01 是**待审设计**，提出全局线程、线程与项目的多对多绑定以及显式 focusedProjectId；不应悄然替换成“一线程唯一项目”。同一 session 在本地可能有全局访问；项目焦点的隔离保护上下文一致性，不能假装客户端的 projectId 就是独立身份或授权凭证。

建议先冻结以下合同，再只做一条有界的 threads/chat 纵向切片：

1. 区分显式全局上下文和项目上下文；项目上下文必须由服务端验证项目存在、来源及线程与项目的可信绑定。无法证明绑定或请求不一致时 fail-closed，不以客户端 projectId 自行创建绑定。精确 HTTP 错误码及对不存在与未授权的统一响应待合同审查。
2. 多项目线程允许显式、多对多绑定；切换 focusedProjectId 不修改历史消息归属。先确认现有 `threads.project_id` 和 `chat_messages.session_id` 与未来稳定身份模型之间的兼容映射；无法证明的旧记录不得自动归入真实项目，也不得为了迁移删除历史。
3. 保持全局对话的有意用途；现有前端 `sendChatMessage` 和历史读取主要只传 threadId，不能直接对所有省略 projectId 的调用一律 403 而不定义兼容方案。确定 global、legacy-unbound、missing 和 project-scoped 的区分及用户可见恢复路径。
4. 先写红灯：两项目唯一标记、匹配与不匹配、未知/伪造 project 和 thread、全局/无绑定历史、重启及同线程异步焦点切换；拒绝路径比较线程、消息、设置、audit 和 Mock 调用前后状态；正常单项目和全局行为保持可用。仅用合成数据，禁止真实项目和模型。
5. 执行面先不涉及 cards/runs/SSE、reset、执行权限、Chronicle/Opinion 或 provider。API/schema 变更和持久绑定/迁移如不可避免，先单独审查合同、版本、回滚和旧数据 fail-closed 策略，再实现；最终独立 PR、Linux/Windows CI 与安全复审按门禁推进。

## 独立后续项

- **cards/runs/feedback/cancel/SSE**：逐一确定全局查询和项目范围语义，合成双项目/负例及状态快照；不以本轮 thread/chat 观察替代。
- **Demo reset**：先冻结可信隔离或逐条可验证归属及旧混合库策略；在此之前保持拒绝和 append-only 审计。
- **恢复**：补正在运行的进程中断、completed→evidence 窗口、重启后状态/证据/审计和非重复执行验证；显式标注平台与未测场景。
- **PATCH CSRF / E2E 并发隔离**：沿用 PR #32 复审登记为独立后续，不在本批顺带实施。
