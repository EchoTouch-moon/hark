# Hearth 验收清单 v2（2026-10-29）

状态：等设计 Style Bible v2 过闸 + 前端/后端同迭代交接。v1 废止。

## 产品 Must（UI/交互）
1. 整屏持续对话；侧栏极简可收；非多页工作台
2. 有事才主动：同条摘要 + ≤3 行动；无事安静
3. 行动闭环留线程：确认→执行→进度/结果回写；不跳详情主路径
4. 项目=换主题线程；无 CRUD 项目后台主入口
5. 设置=角落轻入口
6. `/cards`、Insights/Activity 退出日常主导航

## 后端切片（本拍 Must，与前端同验）
- G1 Thread：list/create/switch；chat 绑 threadId（+可选 projectId）
- G2 消息 parts 落库：text + actions[] + runRef + steps；history 回填不丢
- G3 proactive：打开/拉取时未处理建议≤3 注入；无事空
- G4 execute 后进度/结果 append 同 thread（可挂现有 SSE）
- G5 Should：Mock 文案不再推「去 Home」

## 成功标准抽检
- 打开不像工作台
- 无事安静 / 有事摘要+行动同条
- 点行动→确认→见结果不离线程
- 切项目=切线程

后拍不挡：G6、真摘要接 insight、e2e/远程推送
