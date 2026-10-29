# Hearth Style Bible v3 · Atmosphere Chat（2026-10-29）

**Verdict：** **fail → rewrite**（相对 v2 落地视觉）  
**触发：** 用户对照 Hark：现稿「太普通、无美感」——设计承认把关失职。  
**Contract 保留：** 产品交互 v2 must（整屏对话 / 有事才主动 / 闭环留线程 / 项目=换线程 / 设置角落 / 卡流出主路径）**不改**。  
**Convention：**  
- **打破**「暖纸 SaaS 聊天 + 陶土 pill 行动条 + 管理后台式 checklist」——这是 v2 落地后的真实长相，也是普通感来源。  
- **打破**扁平单色底、全员等权字号、白卡片包一切。  
- **保留**沉浸画布 IA 与克制信息密度；**原创** Hearth「炉火气场」，不像素复刻 Hark 天空/资产。

对标 Hark 的是**气质原则**（气氛场、短句、语言即行动、消息感而非仪表盘），不是抄天空贴图。

---

## 0. 为什么 v2 视觉 fail（证据：qa-v2-01…05）

| 问题 | 现稿表现 | 目标 |
|---|---|---|
| 气氛 | `#f6f4ef` 死纸，像 Notion/Linear 浅色皮肤 | 有深度的气场底（时辰光感），消息浮在「空气」上 |
| 行动 | 陶土满宽 pill 三连 = 后台筛选芯片 | **语言即控件**：摘要句里可点动词 / 短词链，不是三块陶土砖 |
| 进度 | 灰卡 + 绿勾 checklist = 项目管理模板 | 同线程内嵌「步骤轨迹」：细线+节点+一句结果，无行政卡片感 |
| 字阶 | Agent / meta / 用户几乎同权 | Agent 主句 editorial 大一级；时间戳耳语；用户气泡极克制 |
| Composer | 白框+旁侧按钮 = 任何聊天模板 | **凹槽井**装输入；**唯一抬升物**是 Send |
| 侧栏 | 标准会话列表 + 灰高亮条 | 幽灵窄轨：弱分割、强当前态、无「列表产品」铬件 |

**结论：** IA 对了，皮肤与组件语法错了。只换色不够——必须改组件形态与字阶。

---

## 1. 气质一句话

**炉边夜话，不是办公协作软件。**  
打开应感到「有空气、有光、有人在对面说话」；不是「又一个 AI 工作台」。

---

## 2. 气场底（Atmosphere）——结构级，非贴图装饰

- 全视口底层：`AtmosphereField`（CSS 渐变 + 极慢位移噪点/光斑，**禁止**实景天空摄影商用图、禁止 Hark 资产）。
- 默认：傍晚炉火——深墨蓝紫 → 暖褐余烬（`hsl` 停靠点见 §8）；随本地时辰微调（清晨偏冷灰青、正午压低饱和、夜间压暗抬对比）。
- 消息列之上叠一层极淡 `scrim`（`rgba(10,8,6,0.18–0.28)`）保证文字对比；**不要**白实心大画布。
- 侧栏：半透深色玻璃（`backdrop-filter: blur(20px)` + 8% 白），与气场连续，而不是另一块浅灰板。

**Fail 条件：** 任何整屏纯 `#f6f4ef` / `#fff` 底板重现。

---

## 3. 字阶与声音（Type first）

| 角色 | 规格 |
|---|---|
| Agent 主句 | `--font-display`（衬线或高质量人文无衬线二选一，见 §8）；`text-xl→2xl`；`leading-tight`；字重 500–600；短句，≤3 行 |
| Agent 次句 / 风险一行 | sans `text-sm`；`ink-muted` |
| 用户消息 | sans；无描边气泡或极淡凹底；勿大圆角白卡 |
| 时间 / 品牌耳语 | `text-xs`；`opacity 0.45–0.55`；追踪略宽 |
| 空态 | 一句 display 弱提示居中偏下；**禁止**插画墙、禁止多卡引导 |

**打破**系统默认「全站 14px 正文」——对话主句必须一眼压过 chrome。

---

## 4. 组件语法翻案（相对 v2 §4）

### CanvasShell
- 气场底全屏；消息列 `max-width: 640–680px` 居中（略窄于 v2，更「对话」）。
- **禁止**顶栏大标题条、ConnectionBadge 堆砌、右侧常驻 Drawer。
- 入场：消息 `translateY(12px)+opacity`，`320ms` `cubic-bezier(0.22,1,0.36,1)`（不是 200ms 线性 fade）。

### ThreadRail
- 宽 ≤168px；半透；品牌小写 display「hearth」耳语级。
- 线程行：仅名；当前态 = 左侧 2px 余烬光条 + 字重提升，**不要**整行白底圆角块。
- 「新线程」= 文字链，不是主按钮。
- 底：齿轮图标，弱。

### AgentTurn（有事）
- 结构：`[耳语名·时] → 主句 → InlineActions → 一行风险/说明`。
- **InlineActions（必须）：** 1–3 个可点短语，视觉为**句内下划线/余烬色实词**或轻 `chip-ghost`（透明底 + 细描边 + 无填充陶土）。  
  **禁止** v2 那种满饱和实心 pill 横排三连。
- 「忽略」= 更弱文字链，远离主行动。

### ConfirmSheet
- 自底升起毛玻璃 Sheet；标题用 display 短句；主按钮唯一抬升；拒绝文字链。
- 影响范围用短列表，无表格感。

### ProgressBlock
- **轨迹式：** 水平或竖直细线连接 2–5 节点；当前节点余烬脉冲；完成态一字结果，不是绿勾清单卡。
- 证据链：一行文字链「查看证据」，不嵌大卡。

### Composer
- 底部居中凹槽（`surface-sunken` 深半透）；多行；无粗边框。
- **Send = 唯一 raised 控件**（小圆角实体或圆形）；禁用态融入凹槽。
- Placeholder 口语化、短。

---

## 5. 动效

| 事件 | 规格 |
|---|---|
| 侧栏 | 280ms transform + fade；spring-out |
| 消息入场 | 320ms 上述曲线 |
| InlineAction press | scale 0.97 → 1；120ms |
| Atmosphere | 光斑 60–120s 极慢漂，`prefers-reduced-motion` 则静止渐变 |
| Progress 节点 | 到达时 400ms 点亮 |

禁止：弹跳 emoji、彩带、骨架屏闪烁秀。

---

## 6. 状态

- 安静空画布：气场 + Composer 焦点；可一句弱 display 提示。
- 有事：一条 AgentTurn，不刷屏。
- 执行中：同线程 Progress 轨迹，不跳页。
- 失败：主句说明原因 + 一可点「重试/另想办法」。

---

## 7. 前端落地顺序（§7 替换 v2）

1. `tokens.css`：气场色停靠、display 字体、抬升/凹槽、去掉「办公浅纸」为主 bg。  
2. `AtmosphereField` 挂 CanvasShell 底层。  
3. ThreadRail 去白底块高亮 → 光条当前态；半透轨。  
4. AgentTurn：拆掉实心 pill → InlineActions。  
5. ProgressBlock：checklist 卡 → 轨迹。  
6. Composer：凹槽井 + 唯一 raised Send。  
7. ConfirmSheet：毛玻璃 + 单主按钮。  
8. 对照本 Bible 拍 5 张：空态气场 / 有事 InlineAction / Confirm / Progress 轨迹 / 切线程。

**验收审美闸（设计把关）：**  
- 3 秒内不像 Linear/Notion/通用 ChatGPT 浅色皮。  
- 行动不像筛选芯片。  
- 有空气感与字阶层级。  
不通过 → 设计 **fail**，不开测。

---

## 8. Token 草案（实现可微调，方向锁死）

```css
/* 气场（傍晚默认） */
--atmosphere-0: hsl(222 28% 10%);
--atmosphere-1: hsl(265 22% 16%);
--atmosphere-2: hsl(18 40% 22%);   /* 余烬 */
--atmosphere-3: hsl(28 45% 28%);
--scrim: rgba(8, 6, 5, 0.22);

--color-ink: hsl(36 20% 96%);          /* 浅字打在深气场上 */
--color-ink-muted: hsl(36 10% 70%);
--color-ember: hsl(18 78% 52%);        /* 行动实词 / 当前光条 */
--color-ember-soft: hsla(18, 78%, 52%, 0.18);
--surface-glass: hsla(30, 10%, 100%, 0.06);
--surface-well: hsla(20, 15%, 8%, 0.45);
--color-on-ember: hsl(30 40% 98%);

--font-display: "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", Georgia, serif;
--font-sans: /* 保持系统人文无衬线栈 */;

--radius-control: 12px;   /* Send / Sheet */
--radius-well: 20px;      /* Composer 凹槽 */
/* 废弃作为主按钮形态：radius-full 实心 pill 行动条 */
```

浅色「纸」仅允许出现在：设置 Sheet 内表单、证据只读面板——**不是**主画布。

---

## 9. 明确不做（防又普通）

- 不复刻 Hark 实景天空、Logo、文案、面板小部件皮。  
- 不把气场做成夸张全屏视频噪音。  
- 不靠再饱和一层橙「换皮过关」。  
- 不加回 cards/insights/activity 主导航。

---

## 10. 闸口

- **设计：** 本篇 = 新 Style Bible；旧 v2 视觉条款废止，IA 条款继承。  
- **总工：** 需重开 **UI设计闸 → 开发视觉翻案**；交互合同不重开产品闸。  
- **前端：** 按 §7 只做视觉/组件语法；G1–G4 API 不动。  
- **测试：** 审美闸过后再跑回归（功能路径应仍绿）。

**设计签名：** fail（v2 视觉）→ v3 方向锁定，待总工开视觉翻案闸后交前端。
