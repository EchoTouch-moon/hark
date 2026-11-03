# M2 交接（Mind）

分支 `bot/mind-m2` → [PR #10](https://github.com/EchoTouch-moon/hark/pull/10)，合入目标 `bot/hearth-g0-contract`。

## 已交付
1. **火候** `deriveFlame(story, now)`：bright→warm→ember→neutral；闭区间（恰满窗算内）；`milestoneGold` 独立；`now` 注入。
2. **授权写** `PUT /api/v1/hearth/permissions`：body `{observe:boolean}` strict；返回 permissions 且 `execute:false`；库持久化（settings key `hearth.permissions`），无记录时回退 env；同源 Origin 校验，本路由免 CSRF；非同源 403（全局 `ORIGIN_DENIED` / 路由 `origin_rejected`）。
3. **Chronicle**：诞生 + 探索（有 branch 且 lastObservedAt）+ 推进（shortSha + lastSuccessAt）+ 沉淀（test PASS）；字段不超合同。
4. **404**：scope 固定 global，响应不含 projectId。

## 怎么验
- 单测：`apps/server/src/http/hearth/**`（flame / chronicle / http）。
- 授权环：默认 GET 403 → PUT `{observe:true}` → GET 200 → PUT `{observe:false}` → GET 403；跨进程重建 app 仍以库为准。
- 火候：固定 `now` 覆盖 3d/14d 边界两侧。
