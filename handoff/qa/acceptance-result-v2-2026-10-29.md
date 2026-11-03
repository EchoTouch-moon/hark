# Hearth 验收结果 v2 · 2026-10-29

**结论：pass 11 / fail 0 / blocked 0**

对照 `acceptance-checklist-v2-2026-10-29.md`。前后端真路由对齐；UI + API 抽检。

## Must UI
| # | 项 | 结果 |
|---|---|---|
| M1 | 整屏对话；侧栏极简可收；非工作台 | PASS |
| M2 | 有事摘要+≤3 行动；无事安静 | PASS（有 proposed 卡时主动；全静音本次未复现） |
| M3 | 确认→执行→同线程回写 | PASS |
| M4 | 项目=换线程 | PASS |
| M5 | 设置=角落轻入口 | PASS |
| M6 | cards/insights/activity/projects 出日常 Nav | PASS（调试 URL 仍在） |

## G1–G5
| # | 项 | 结果 |
|---|---|---|
| G1 | threads list/create/switch | PASS（API+UI） |
| G2 | parts 落库 / history 回填 | PASS |
| G3 | proactive ≤3；消费后安静 | PASS |
| G4 | execute → progress+result 同线程 | PASS |
| G5 | 不推「去 Home」 | PASS |

## 证据
- API 摘要：`handoff/qa/api-accept-summary-v2-2026-10-29.md`
- 截图：`handoff/EVIDENCE/qa-v2-20261029-01-shell.png` … `-05-thread-switch.png`

## Nit（不挡过闸）
1. **CSRF 403**：localStorage 旧 `hearth.csrfToken` 与会话不一致时，POST execute 403，UI「行动执行接口不可用」；客户端仅 401 刷新 CSRF。清 key 后恢复。→ @前端
2. 从 `/t/:id` 再切线程时 path 不改、只加 `?thread=`（可用，路径略不一致）。→ @前端 should
3. G4 仍为本地演示闭环（已知缺口，不挡本拍）。

## 后拍不挡
G6、真摘要/真执行器、e2e、远程推送、未 commit。
