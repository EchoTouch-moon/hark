# Hearth 验收结果 v6 · 2026-10-29

**结论：fail（6 pass / 2 fail / 0 blocked）** — 糙壳不算过；空态 Seed 与中心→底未在实机出现。

依据：`acceptance-checklist-v6-2026-10-29.md` + FE 交接 + 产品叙事成功标准。
环境：Vite `:5173` + API `:4317`；三档炉温用 mock（停 API → `hearth.threads.v2` 改 `updatedAt`）。API 测后已重启 listening。

## Must
| # | 项 | 结果 | 注 |
|---|---|---|---|
| 1 | 炉芯空态 Seed | **FAIL** | 真 API 新线程已 `canvas-page--grown`（G3 主动卡先到，`.ember-seed`=0）；停 API 后是网络错误屏，不是 Seed。未见「余烬还在。」等问候。 |
| 2 | 中心→底生长 | **FAIL** | Composer 一开始就在 `.composer-dock`；发「QA验收：炉边再说一句」后仍底栏，未见中心→底。 |
| 3 | 聊天\|项目顶栏 | PASS | 顶栏分段 + 搜 + 炉头像→设置；左栏单线程列表。 |
| 4 | ≤1 卡 / ≤2 chip | PASS | 1 小卡 + 2 chip（会议协调 / 构建未通过）。 |
| 5 | 自有语言 | PASS | 炉温洗色、炉边敲一下卡、玻璃井 CSS 焰、炉字形。 |
| 6 | 炉温三档 | PASS | 旺 0.9 hot；温 mock `updatedAt` 10-26 → 0.52 warm；黯 10-21 → 0.15 cool。问候文案因无 Seed 未验到。真 API 今日 `updatedAt` 清 local 仍旺（交接已写明）。 |
| 7 | 续用钩 | PASS | 两枚行动 chip 可点。 |
| 8 | v6.1 craft | PASS | 纸底洗色、玻璃 Composer、DOM 内外焰/煤/aura。大 Seed 焰+衬线问候未上屏（连带 #1）。 |

## Failures（blocker）
1. **空态 Seed** — 期望：问候+居中玻璃 Composer+焰+≤2 chip。实际：G3 历史先占屏 / mock 断网错误。证据 `qa-v6-20261029-01-shell-grown.png`, `09-heat-cool-015.png`。
2. **中心→底** — 期望：首条后消息上长、输入落底。实际：始终底栏。证据 `qa-v6-20261029-05-after-message.png`。

## Evidence
`/workspace/hark/handoff/qa/EVIDENCE/qa-v6-20261029-01` … `10`（见目录）。

## 给前端
优先：空态须在无历史时渲染 Seed（G3 主动勿抢空态首屏，或无消息时仍可点燃）；首条发出后才 `--grown` + Composer 落底。三档 heat 值路径本身可过。

未 commit / 未推应用代码。终验不共签（must 未过）。
