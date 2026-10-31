# M1 · 只读观察接口（observe endpoint）

## 路由
`GET /api/v1/hearth?scope=global|project&projectId=<id>`
- `scope` 缺省为 `global`；`scope=project` 必须带 `projectId`。
- 需要 session cookie（与其他 `/api/v1/*` 相同）；GET 无需 CSRF。
- 响应体永远是 `HearthViewModel`（`@hearth/hearth-contract`），`mode` 恒为 `real`。

## 行为
- 先查 `observe` 授权，未授权直接返回，不读观察者。
- 只读：只调用 `ProjectObserver.listProjects()` / `getObserverHealth()`。不触发研究、不调模型、不写卡片、不写任何设置。
  实现为纯函数 `apps/server/src/http/hearth/observe-view.ts#buildObserveView`。
- 任何内部失败返回 `status:'error'`，不回退 Mock / fixture。
- `permissions.execute` 恒为 `false`；`featuredOpinion` 本拍恒为 `null`。
- 火焰只经 `narrative.flame`；本拍恒为 `neutral`（尚无叙事判断），reason 区分正常 / 过期。
- `story`：每个启用项目一条「诞生」节拍（createdAt），evidence kind=`observer`（短 sha + 分支）。

| 情形 | HTTP | status | observationFreshness |
|---|---|---|---|
| observe 未授权 | 403 | permission_denied | disabled |
| 无启用项目 | 200 | empty | unknown |
| 正常 | 200 | ok | fresh |
| 任一项目 collectionStatus≠OK 或最近观察超过阈值 | 200 | ok | stale |
| 项目不存在/未启用 | 404 | error（`project_not_found`） | unavailable |
| 查询参数非法 | 400 | error（`invalid_request`） | unavailable |
| 观察者未配置或读取抛错 | 503 | error（`observer_unavailable`） | unavailable |

## 授权配置（服务端显式开关，默认全关）
| 环境变量 | 默认 | 含义 |
|---|---|---|
| `HEARTH_PERMIT_OBSERVE=1` | 关 | 允许只读观察 |
| `HEARTH_PERMIT_RESEARCH=1` | 关 | 仅回显到 `permissions.research`，本接口不用 |
| `HEARTH_PERMIT_MODEL=1` | 关 | 仅回显到 `permissions.model`，本接口不用 |
| `HEARTH_OBSERVE_STALE_MS` | 1800000 | stale 阈值（毫秒） |

存于 `ServerConfig.hearthPermissions`（`apps/server/src/config.ts`）。之前代码里没有授权存储，这是最小实现；还没有用户侧授权 UI。

## 验证
```bash
pnpm vitest run apps/server/src/http/hearth.http.test.ts   # 9 项
HEARTH_PERMIT_OBSERVE=1 pnpm dev:server
# 另一个终端：先拿 session cookie
curl -s -c /tmp/h.jar http://127.0.0.1:4317/api/v1/auth/session >/dev/null
curl -s -b /tmp/h.jar -w '\n%{http_code}\n' 'http://127.0.0.1:4317/api/v1/hearth'
curl -s -b /tmp/h.jar -w '\n%{http_code}\n' 'http://127.0.0.1:4317/api/v1/hearth?scope=project&projectId=<id>'
# 不带 HEARTH_PERMIT_OBSERVE 重启 → 403 permission_denied
```

## Fixture
测试不使用 `packages/hearth-contract/fixtures/*`（那是给前端的 demo 数据）：用 `createGitRepo` 建临时 git 仓并注册到临时观察者库；失败路径用 spy 让 `listProjects` 抛错。
研究、模型、卡片相关依赖（discovery / orchestrator / chat / insight / analysis / coordinator）在测试里注入成访问即抛错的 Proxy，并断言 `storage.setSetting` 在请求期间没有被调用。
