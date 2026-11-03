# 验收结果 · 对话主壳 · 2026-10-29

**结论：pass（8 pass / 0 fail / 0 blocked）** · 范围：产品 must + Style Bible 主流程（前端本地未推远程）

| ID | 结果 | 说明 |
|---|---|---|
| M1 默认 `/` 对话主壳 | pass | 非卡流 |
| M2 Nav 三项+更多 | pass | 洞察/活动/建议在「更多」 |
| M3 Mock 摘要应答 | pass | Badge「离线演示 · 不连接模型」；问「现在该关注什么？」有 Mock 回复 |
| M4 空态/chip | pass | 有历史时不显示 chip（合理）；占位符仍引导该问法 |
| M5 证据 Drawer | pass | ConclusionRow→本轮步骤；链到 `/cards` |
| M6 `/cards` 次级 | pass | 标题「建议（次级）」 |
| M7 项目/设置 | pass | 一级可达 |
| M8 `/chat`→`/` | pass | 重定向 |

**Nits（不挡）**
1. ConclusionRow 仅内存，离开/刷新 `/` 后步骤行消失，消息仍在
2. 偶发：刚发送的用户气泡需刷新历史才并排出现
3. `pnpm test:e2e` 本机未跑（缺 chromium）——不当绿
4. 未推远程；终验需 @产品 共签范围

证据：`handoff/EVIDENCE/qa-20261029-m*.png` + 前端交接 `chat-shell-*.png`
