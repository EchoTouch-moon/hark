# G3 空炉不抢 Seed · 2026-10-29

## 改动
`GET /api/v1/threads/:id/proactive`：
- **无用户消息** → `{ suggestion: null }`，**不写库**
- 用户发过至少一条后，才允许注入（卡摘要 / 演示建议）
- `consumed` 仍安静；`offered` 仍回已有建议

对齐：产品「无用户消息=空炉」+ 设计「Seed 首屏」+ 总工指派。

## curl 证明（本机 :4317）
1. 新建线程 → GET proactive → `null`，history 仍 0
2. POST chat 用户一句 → GET proactive → 有 suggestion
3. 再 GET → 同一 offered 建议

## 给前端 / 测试
- 空态判定请以 **有无用户消息** 为准（勿只看 history 条数；助手主动条在用户开口前不应再出现）
- 复验 blocker：无历史 Seed；首条后 grown（前端侧）
