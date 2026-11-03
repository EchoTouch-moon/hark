# API 抽检摘要 · v2 · 2026-10-29

| 项 | 结果 | 备注 |
|---|---|---|
| G1 list | PASS | ≥1 含 thread-default |
| G1 create | PASS | 201 + thread |
| G1 get | PASS | |
| G2 chat + parts | PASS | reply.parts text；无「去 Home」 |
| G2 history parts | PASS | execute 后含 actions/progress/result/text |
| G3 proactive | PASS | 新线程：≤3 行动（proposed 卡合成） |
| G3 after exec | PASS | suggestion=null |
| G4 execute | PASS | progress+result 同线程 |
| G5 文案 | PASS | chat/proactive 均无「去 Home」 |

注：`thread-default` 若已 consumed / 已有聊天且 idle，proactive 为 null（符合「无事安静」）。
