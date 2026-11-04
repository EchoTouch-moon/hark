# M1 合成本地 API（D-C1）

仅供本地合成模式：回环地址、独立演示数据库、服务端固定合成 scope，禁止接入旧目录读取、原生目录适配器、真实模型和执行器。所有响应均为合成数据或明确错误；项目 ID 不是路径。静态资源白名单固定，任何其他路径失败关闭。

服务对本地请求校验 Host；会话通过同源 `GET /api/session` 建立，返回 `{ csrfToken }` 并设置 HttpOnly、SameSite=Strict 的随机会话 cookie。业务请求需要会话；POST 还需精确匹配 Origin、`application/json` 和 `X-Hearth-CSRF`。不得在前端资产、日志或 URL 写入令牌。服务端由固定项目 ID 推导 scope，不接收客户端 principal、grant、root、目录或风险字段。所有 JSON 写入边界使用严格 schema；GET 不能生成观点或写入数据。

| 方法 | 路径 | 结果 |
| --- | --- | --- |
| GET | `/api/inventory` | `{synthetic, projects, unavailableCount, unassigned, access}`；`projects` 仅返回当前授权项目。各项目含 `id,title,kind,coverage,understanding`；无数据时显示未分析。`access` 仅列固定公开的合成标识与标题、`state`（`active`、`paused`、`revoked`、`uninitialized` 或 `unavailable`），不含项目内容，用于恢复暂停的合成项目。 |
| POST | `/api/inventory` | body `{}`；初始化尚未存在的隔离合成资料与默认演示授权，明确扫描预置数据；不重新启用、恢复或覆盖已有撤权。返回上述盘点及 `initializationErrors`（处理失败的合成项目 ID 数组）；单个项目失败不阻止其余项目。 |
| GET | `/api/projects/:id` | `{project,understanding,current,previous}`；无有效授权返回错误，来源不可用时理解值为空且观点为 null。`current`/`previous` 是既有观点存储的 `{revision,plan,change,feedback}` 或 null。 |
| POST | `/api/projects/:id/challenge` | body `{requestId,reason,createdAt,expectedVersion}`；返回 `{previous,current}`，反馈及版本持久化，重复相同请求幂等；冲突返回错误。 |
| POST | `/api/projects/:id/question` | body `{question}`；返回明确 `mode: mock` 的固定回复及其已核验引用，不声称理解。 |
| POST | `/api/projects/:id/access` | body `{action: "pause"|"resume"|"revoke"}`；仅更改固定合成 scope，撤销不可通过此入口恢复；返回 `{state}`。 |

请求失败用非 2xx，JSON `{error: string}`；不得回退为成功静态数据。POST 失败保留输入并明确反馈；若首次请求结果不确定，应使用相同 requestId 和原始字段重试。项目切换时忽略过期响应；旧版、反馈与修订原因从服务读取。所有页面保持合成与 Mock 标识。

真正实现后需要集成测试：会话/Origin/CSRF、严格输入、无任意路径、直接调用拒绝、项目隔离、来源与授权失效、GET 无写入、重复反馈、重启恢复及旧目录路径零调用；浏览器验证才可认领 M1-R01～R06。
