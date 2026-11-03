# Hearth Style Bible v6 · Ember Seed（炉心）（2026-10-29）

**Verdict：** pass-with-notes（待用户点头）  
**触发：** 用户——要**自己的设计语言**；要**有趣、想用下去**；空态勿竖空玻璃框，输入应从**中心展开**；可参考 Hark，**禁止一味模仿**。

## Convention（打破 / 保留）
- **打破** Hark 天蓝云复刻、竖空聊天柱、大决策台、无个性换皮。  
- **打破**「中间框起来却没字 → 空洞」：空态不画空对话柱。  
- **保留**产品 must：聊天|项目、对话为主、≤1 小卡 ≤2 chip、左栏面板本拍 Won't。  
- **自有语言名：Ember Seed / 炉心**——暖纸气场 + 余烬强调 + 从中心点燃对话。

## 设计语言（独特卖点）
1. **空态 = 炉心**：问候衬线短句 + **居中 Composer**（背后余烬光晕）+ 2–3 个好玩入口 chip；不出现空气泡柱。  
2. **首条消息后展开**：消息自中心向上生长，Composer **落底停靠**（对标 HF chat-ui / Gemini / Prestige 空态模式，原创材质）。  
3. **有趣钩子**：Agent 有事时轻声「炉边敲一下」+ ≤1 小卡；余烬脉冲，不刷卡墙。  
4. **材质**：暖奶油底 `#F7F0E6` + 粉橙/薄蓝径向光（非 Hark 天空摄影）；玻璃只做表面，不做「大空罩」。  
5. **参考但不抄**：Arc 暖奶油自信、Gemini 居中点燃、Linear 克制光泽——合成炉边，不合成第二套 Hark。

## 组件清单（少）
顶栏聊天|项目 · 搜/头像｜空态 Seed｜对话气泡｜MiniCard+chips｜底栏 Composer（仅有消息后）｜设置 Sheet

## 动效
空→聊：Composer `center → bottom` 360ms spring；消息 stagger 80ms；余烬光晕呼吸 8s（reduced-motion 静止）。

## 吸引力（体验原则）
打开就有事可点；Agent 像炉边伙伴轻敲，不像工单；完成小行动有轻反馈。度量：空态 3 秒内有可点入口；有事组件 ≤4 个可见块。

## 废止
v5c 竖空玻璃聊天框空态；v4 大卡；像素抄 Hark。

---

## Addendum · 炉心叙事主题（用户定稿 + 产品三档 2026-10-29）

**设计闸：pass**

### 三档（本拍 must · 本地启发式）

| 档 | 触发 | 视觉 | 关键帧 |
|---|---|---|---|
| **旺 Active** | 本会话已发送，或 24h 内有互动 | 火活泼；页偏暖橙亮；光晕强 | `v6-flame-hot.png` |
| **温 Steady** | 1–7 天内有互动、本会话未聊 | 中等余烬；暖奶油（v6 主调） | `v6-flame-warm.png` |
| **黯 Dormant** | >7 天无互动 / 新装未聊 | 余烬点；页偏冷暗；文案邀「吹一口气」 | `v6-flame-cool.png` |

**再燃 Reignite**：黯→发出首句 → 360–600ms ease 插值到旺（不闪切）。

### 前端合同
- `emberHeat` 0–1 本地推算：黯≈0–0.25 · 温≈0.4–0.65 · 旺≈0.75–1
- CSS：同一套 token 插值 `--ember-heat` → bg / glow / accent / flame-scale；禁止两套皮肤硬切
- 空态：中心火焰 widget；有消息后可缩顶栏/Composer 旁小标
- 打开 **3 秒内**三档可辨（测试清单已写）
- 跨端落库 Won't；第二套叙事 Won't

### 文案钩（空态示例，可换）
- 旺：「火正旺。」
- 温：「炉还温着。」
- 黯：「余烬还在。」 / 「吹一口气，火会回来。」

---

## Addendum · v6.1 Craft 美化（用户：UI 再美化 · 2026-10-29）

**设计闸：pass-with-notes**（美学抬档，交互合同不变）

### 保留约定
仍是 **Ember Seed**：中心点燃、暖纸余烬、三档炉温。不做第二套叙事、不抄 Hark 天空。

### 材质抬档（给前端）
| 面 | 规格 |
|---|---|
| 纸底 | 多径向光叠在 `#F7F0E6`（旺偏 `#F3E0CC`；黯 `#161412`）+ 极轻 grain overlay `opacity ≈ .04` |
| Composer | pill · `backdrop-filter: blur(24px) saturate(160%)` · 内高光 1px · 暖色投影，非死白卡片 |
| Chip | 同玻璃系更轻；≤3 个；黯态只留 1–2 个「吹一口气」类入口 |
| 火焰 | 外焰+内芯+煤底+aura 呼吸；`flame-scale` 随 heat：旺 1.12 / 温 1 / 黯 0.72；flicker 周期旺快黯慢 |
| 顶栏 | 品牌字重 600 · 分段 pill 选中有极轻阴影；右侧图标圆点占位即可 |
| 字 | 问候衬线（Songti/Georgia）`letter-spacing: -0.02em`；副文 14 / muted；禁止全页无衬线口号墙 |

### 动效（流体，可打断）
- 主题插值：`background` / `color` / `--ember-heat` **500ms** `cubic-bezier(.22,1,.36,1)`，禁止闪切  
- Composer 下沉：360ms spring，`bounce: 0`（critically damped）  
- 发送键：`pointerdown` 即 `scale(.96)` 100ms  
- `prefers-reduced-motion`：停 flicker/breathe，只留 crossfade 主题

### 关键帧（craft）
`v6b-flame-hot.png` · `v6b-flame-warm.png` · `v6b-flame-cool.png`

### 前端落地顺序
1. token + `--ember-heat` 插值  
2. 空态 Seed（火焰 widget + 衬线问候 + 玻璃 Composer + chips）  
3. 三档可辨 + 过渡  
4. 有消息后 Composer dock（既有合同）
