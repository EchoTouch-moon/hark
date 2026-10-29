# Hearth UI-03：产品视觉识别与体验重设计方案探索报告

> **阶段**：Phase 1 视觉探索与原型验证（已完成）  
> **代码基线**：`codex/ui-refresh-01` (`5d5eef9`)  
> **核心原则**：真实工程事实驱动、零虚构模型态、保留 Pi 显式授权与安全约束、骨架级结构差异（禁止换色套壳）。

---

## 目录
1. [现有前端视觉与布局审计](#1-现有前端视觉与布局审计)
2. [三套视觉概念设计全景](#2-三套视觉概念设计全景)
   - [方案一：Quiet Observatory（安静精密的个人观测台）](#21-方案一quiet-observatory安静精密的个人观测台)
   - [方案二：Editorial Workspace（编辑式排版的研究工作空间）](#22-方案二editorial-workspace编辑式排版的研究工作空间)
   - [方案三：Instrument Studio（现代精密仪器风格的-agent-工作台）](#23-方案三instrument-studio现代精密仪器风格的-agent-工作台)
3. [结构化差异证明：无色骨架对比](#3-结构化差异证明无色骨架对比)
4. [真实浏览器截图索引（1440px Playwright）](#4-真实浏览器截图索引1440px-playwright)
5. [深度对比评估矩阵](#5-深度对比评估矩阵)
6. [综合推荐与 Phase 2 实施建议](#6-综合推荐与-phase-2-实施建议)

---

## 1. 现有前端视觉与布局审计

在进入方案探索前，我们对现有前端（`apps/web`）进行了系统的视觉与交互审计，识别出以下核心症结：

| 维度 | 现有前端现状 | 问题与负面体验 |
| :--- | :--- | :--- |
| **模板同质化 (Template Monotony)** | 每一个页面（首页、项目列表、项目详情、洞察页、设置页）均由三段固定套件拼接：`PageHeader`（粗体大标题 + 浅灰副标题）→ 筛选胶囊条 → 垂直堆叠的圆角白卡片。 | 视觉疲劳严重，各页面缺乏专属的功能气质与识别点；用户无法在 1 秒内通过空间版式感知当前所在频道的任务性质。 |
| **卡片包裹过剩 (Card Fatigue)** | 所有数据都被塞入 `border: 1px solid var(--color-border); border-radius: 12px;` 的同质卡片内。无论是单行指标、代码堆栈、Git 哈希还是测试摘要，均被相同尺寸与边框包裹。 | 页面缺乏呼吸感与主次焦点的纵深，重要的高危异常（如测试断言失败）与常规的已跟踪事实（如未暂存文件数为 0）在视觉重量上毫无差异。 |
| **事实表达乏力 (Unexpressive Git / Telemetry)** | Git 哈希（`c18faa1`）、分支名、JUnit 测试数量等核心工程事实被退化为单行文本或通用标签，缺乏精密仪器的刻度感或研究报告的严谨考证感。 | 感受像一个常规的 CRUD 管理后台，而非具备深度自动化感知、代码守卫能力的个人智能体工作台。 |
| **空态同质且平庸 (Generic Empty States)** | 空态统一为：居中灰色小图标 + `暂无...` + 浅灰色引导文字。 | 错失了传递「代码处于健康基线、智能体在静默守护」的信赖感，反而带给用户「缺少内容、配置未完成」的负面空虚心理。 |
| **信息密度失衡** | 1440px 宽屏下留白未经过结构化规划，导致核心信息水平拉长失真，侧边栏与主信息区比例呆板。 | 阅读视线需要大范围左右跳跃，降低了长久代码审查与日常巡检的舒适度。 |

---

## 2. 三套视觉概念设计全景

为了打破同质化模板，本阶段分别探索了三套从**隐喻、排版、信息架构到骨架栅格**完全不同的产品级设计方案。所有方案均运行在 `prototypes/` 目录下，并已通过真实浏览器渲染检验。

```mermaid
graph TD
    A[Hearth 核心数据与安全边界] --> B[方案 1: Quiet Observatory<br/>安静精密的个人观测台]
    A --> C[方案 2: Editorial Workspace<br/>编辑式研究公报工作空间]
    A --> D[方案 3: Instrument Studio<br/>现代精密仪器机架工作台]
    
    B --> B1[大视野天幕 + 无卡片台账 + 坐标刻度]
    C --> C1[报头双排线 + 非对称社论双栏 + 考据证据板]
    D --> D1[19寸机架箱体 + 示波器沉降屏 + LED段式电平表]
```

---

### 2.1 方案一：Quiet Observatory（安静精密的个人观测台）

*让 Hearth 成为桌面上一座静默远眺的代码气象站与天文台。*

#### 设计隐喻与核心气质
以高海拔现代天文观测台或深空无线电监测站为隐喻。强调**天幕的宽广、极细发丝线的精确、克制的负空间与极低的视觉噪音**。取消封闭式白色大卡片，采用开放的大态势横向叙事与细线台账。

#### 核心布局与排版
1. **顶部台站标定条 (Station Bar)**：显示台站物理坐标与工作状态（`STATION 127.0.0.1:4317 · LOCAL ACTIVE`），带呼吸微光的微型雷达点。
2. **天幕大态势全景 (The Horizon)**：开放式全宽水平空间，左侧大字号精炼叙事（如「天幕平稳：捕获 1 项待复核用例失败」），右侧无框台账对齐显示台站数与过境事件数。
3. **主焦点透镜 (Focal Attention)**：唯一的独立聚焦窗，四个角落带有发丝瞄准十字标（`+`），直接拉开证据事实与时间戳，右下角提供「调焦展开」链路。
4. **频谱台账与过境事件双栏 (7:5 黄金非对称)**：
   - 左栏：台站频谱台账（细线行式表格，去卡片化，带精确状态微点与测试通过进度）。
   - 右栏：垂直时间轴过境流水（Transit Stream），单侧细线导引。

#### 设计系统 Tokens
- **色彩（晨曦纸灰与冷松）**：
  - 浅色：底色 `#fbfaf7`，表面 `#ffffff`，沉降 `#f4f2ec`，高山冷松绿 `#36533f`，警示余烬赤 `#a34824`。
  - 深色：深空天幕 `#0f1013`，表面 `#17181d`，荧光松针绿 `#4ade80`，暖橘 `#fb923c`。
- **字体**：系统高精密 Sans（SF Pro / PingFang SC）与 SF Mono，字重克制（400/500 为主）。

---

### 2.2 方案二：Editorial Workspace（编辑式排版的研究工作空间）

*将代码事实呈现为一份值得细细品读的学术研究公报与头版特刊。*

#### 设计隐喻与核心气质
以《金融时报》(FT)、《大西洋月刊》与经典学术档案专刊为隐喻。强调**印刷排印的美感、严肃的新闻叙事节奏、非对称的版面平衡与考据级的证据引用**。将乏味的 Git 变更与测试报告转化为有理有据的工程研报。

#### 核心布局与排版
1. **公报大报头 (The Hearth Dispatch Masthead)**：
   - 顶部卷号条（`VOL. IV · NO. 42`）与日期刊号。
   - 居中宏伟的大衬线刊名与斜体副标题。
   - 经典古典双排线（`3px double rule`）导航栏，将版面自然切割。
2. **非对称社论双栏 (63% 主述评 / 37% 边栏卷宗)**：
   - **左侧主专栏**：
     - 赤色大字号栏目分类（Kicker）。
     - 极具阅读吸引力的大衬线社论头条与斜体摘要导语（Deck）。
     - 优雅的**首字下沉排版 (Drop-Cap)**。
     - 双排线夹持的**学术引用警句 (Pull Quote)**。
     - **学术特刊证据板 (Evidence Plate)**：外加粗细相间的考据边框，左侧红色断言垂线，底部附带规范的学术考据出处与关联实体注脚。
   - **右侧边栏 (Marginalia)**：
     - 档案卷宗 (Project Dossier)：采用罗马数字编号（`I. hark`，`II. pindou`），附带工程简标与通过率。
     - 边缘纪要速记 (Dispatch Docket)：左侧细竖线悬挂的纪要卡片。

#### 设计系统 Tokens
- **色彩（新闻纸白与深浓墨汁）**：
  - 浅色：新闻纸底色 `#fbf9f4`，纯白纸面 `#ffffff`，深浓墨汁黑 `#191816`，学术次墨 `#4a4742`，特刊朱砂红 `#ba3426`，鼠尾草绿 `#375b42`，古典金褐 `#99621e`。
  - 深色：深夜藏书阁 `#141312`，暖象牙墨 `#f0ebe1`，复古赤陶 `#ea6050`，浅鼠尾草 `#68ab7b`。
- **字体**：经典衬线族（Georgia, 'Songti SC', 'Noto Serif SC', 'Source Serif Pro'）主导大标题与叙述，等宽字体作为代码引证。

---

### 2.3 方案三：Instrument Studio（现代精密仪器风格的 Agent 工作台）

*将个人智能体还原为一台具有硬件机架与旋钮刻度的精密声学 / 逻辑分析台。*

#### 设计隐喻与核心气质
以 Dieter Rams 的 Braun 音响实验设备、Teenage Engineering 极简硬件、以及工业 19 寸测试机架为隐喻。强调**硬件物理质感、沉降式 LCD 示波器视窗、十段式 LED VU 电平表与走带式步进录音机**。

#### 核心布局与排版
1. **机架 Master Status Display (MSD)**：
   - 四角带有金属机架固定螺丝（`(+)`）纹理。
   - 仪器型号标识（`HEARTH // MK-IV INSTRUMENT CONSOLE`）与系统时钟总线（`CLK: 0.33 Hz`）。
   - 硬件物理感摇臂按钮导航（`[01 MASTER]`, `[02 CHANNELS]`, `[03 TRACES]`）。
2. **数字段码仪表盘 (Digital Segment Ribbon)**：
   - 硬件沉降黑底液晶视窗，高对比度点阵段码显示运行周期、激活通道数、故障数与断言达成率。
3. **沉降式示波器视窗 (Bay 02: Primary Transducer)**：
   - 带有内阴影物理倒角（`box-shadow: inset 0 3px 8px rgba(0,0,0,0.8)`）的深色屏幕。
   - 实时波形模拟（`_/\_/\__/\/\/\____`）、断言错误高亮与本地总线硬隔离标牌。
4. **双通道排插与十段式 VU 电平表 (Bay 01: Channel Matrix)**：
   - 每个仓库作为独立硬件通道（CH-01, CH-02）。
   - 十段式 LED 硬件电平表：100% 满绿显示稳定，50% 伴随琥珀色与红色峰值告警。
   - 硬件控制开关：`[PROBE]`, `[SOLO]`, `[MUTE]`。
5. **走带式事件步进器 (Bay 03: Step-Sequencer)**：
   - 磁带机走带式格式记录事件时序，带精确到毫秒的硬件时间码。

#### 设计系统 Tokens
- **色彩（Braun 哑光米灰与沉降液晶黑）**：
  - 浅色：哑光机箱米灰 `#e6e3dc`，拉丝面板 `#f2efe9`，沉降 LCD 黑 `#18191c`，磷光管绿 `#00e676`，警示橙 `#ff9100`，故障红 `#d50000`。
  - 深色：深曜石黑机箱 `#121316`，机架面板 `#1a1c22`，高亮二极管绿 `#00e676`，段码青 `#00e5ff`。
- **字体**：技术等宽字体主导（SF Mono / JetBrains Mono / Fira Code），数字全对齐排印。

---

## 3. 结构化差异证明：无色骨架对比

为了贯彻**「禁止仅修改配色、圆角、阴影后将其称为不同方案」**的硬性红线，下表呈现了即使在完全去除颜色、阴影与字体后，三套方案在空间栅格与信息组织上的根本性骨架差异：

```
+----------------------------------------------------------------------------------------------------+
| 现有同质模板 (Baseline):                                                                           |
| [Page Header: Title + Subtitle]                                                                    |
| [Toolbar: Filter Pills                                                          [Action Button] ]  |
| +------------------------------------------------------------------------------------------------+ |
| | Rounded Card 1 (12px border radius, identical 1px border)                                      | |
| +------------------------------------------------------------------------------------------------+ |
| | Rounded Card 2 (Identical layout, stacked vertically)                                          | |
| +------------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------------+
| 方案一：Quiet Observatory (开放天幕 + 聚焦透镜 + 7:5 细线台账)                                     |
| [Station Bar: Coords // Radar Pulse                                            [Nav] [Theme Toggle]|
| [Open Horizon: Large Narrative Typography . . . . . . . . . . . . . . .  [Metrics Ledger: 3-Col] ] |
| -------------------------------------------------------------------------------------------------- |
| [01 Focal Lens: Hairline Box with Crosshairs (+) + Severe Badge + Evidence Pills + Focus Link]     |
| -------------------------------------------------------------------------------------------------- |
| [Left 58%: Station Hairline Table Ledger]       | [Right 42%: Vertical Single-Rule Transit Stream]  |
| - Row 1: Status Dot | Repo | Branch | Test Stat | - Timestamp | Category | Narrative Note       |
| - Row 2: Status Dot | Repo | Branch | Test Stat | - Timestamp | Category | Narrative Note       |
+----------------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------------+
| 方案二：Editorial Workspace (大报头双排线 + 非对称 63:37 社论专栏)                                  |
| [Vol. IV · No. 42                        THE HEARTH DISPATCH                        Oct 29, 2026]  |
| ============================== Double Folio Rule (3px double) ==================================== |
| [Left 63% Lead Editorial Article]               | [Right 37% Marginal Column]                      |
| - Kicker: Special Dispatch                      | - Project Dossier Header                         |
| - Headline: Large Serif Monograph               |   * Folio I. hark [Clean]                        |
| - Deck: Italic Analytical Lead                  |   * Folio II. pindou [Attention]                 |
| - Byline Bar: Extractor / Head / Time           | ------------------------------------------------ |
| - Drop-Cap Paragraph: First Letter 52px tall    | - Dispatch Docket Header                         |
| - [Pull Quote: Centered between Double Rules]   |   * Annotated Timecode & Monograph Notes         |
| - [Evidence Plate: Double Boxed Citation Snippet]                                                  |
+----------------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------------+
| 方案三：Instrument Studio (19寸机架固定螺丝 + 模块化仪器箱格 + 沉降示波器)                           |
| [(+) Chassis Screw     HEARTH // MK-IV CONSOLE · CLK: 0.33Hz      [01] [02] [03]     (+) Screw]    |
| ================================================================================================== |
| [Digital Segment Ribbon: Recessed LCD Strip [0142 CYCLES] [02 CH] [01 FAULT] [99.7% ACCURACY]   ] |
| -------------------------------------------------------------------------------------------------- |
| [BAY 02: Primary Signal Transducer (Sunken Bezel Box with Inset Shadows)]                          |
| - Fault Register LED | Oscilloscope Waveform (_/\_/\_) | Raw Stack Trace Box | [Probe] Buttons     |
| -------------------------------------------------------------------------------------------------- |
| [BAY 01: Dual Channel Matrix]                                                                      |
| - Channel 01: Gain Strip + 10-Segment VU Meter Bar [■■■■■■■■■■] + Hardware Mini Switches           |
| - Channel 02: Gain Strip + 10-Segment VU Meter Bar [■■■■■■■□□□] (Peak Amber/Red LEDs)              |
| -------------------------------------------------------------------------------------------------- |
| [BAY 03: Step-Sequencer Tape Deck: [STEP 01] [STEP 02] [STEP 03] with Monospace Timecode]          |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. 真实浏览器截图索引（1440px Playwright）

本阶段通过 Playwright 在 Chromium 真实浏览器（1440px 高清双倍视网膜视口）下生成了全部 24 张完整页面截图。所有原型代码位于 `prototypes/`，产物位于 `docs/design/screenshots/`。

### 4.1 方案一：Quiet Observatory 截图

| 场景 | 浅色模式 (Light) | 深色模式 (Dark) |
| :--- | :--- | :--- |
| **首页（内容态）**<br>*包含 1 项用例失败焦点、两台站台账与事件流* | [![Quiet Observatory Home Light](screenshots/01-quiet-observatory-home-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-home-light.png) | [![Quiet Observatory Home Dark](screenshots/01-quiet-observatory-home-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-home-dark.png) |
| **首页（基线空态）**<br>*全绿稳定基线、宁静天幕* | [![Quiet Observatory Home Empty Light](screenshots/01-quiet-observatory-home-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-home-empty-light.png) | [![Quiet Observatory Home Empty Dark](screenshots/01-quiet-observatory-home-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-home-empty-dark.png) |
| **项目详情（hark）**<br>*工作树游标、Vitest 348通过率与台站纪要* | [![Quiet Observatory Project Light](screenshots/01-quiet-observatory-project-detail-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-project-detail-light.png) | [![Quiet Observatory Project Dark](screenshots/01-quiet-observatory-project-detail-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-project-detail-dark.png) |
| **项目详情（初建空态）**<br>*未探测试验场、等待首次信号* | [![Quiet Observatory Project Empty Light](screenshots/01-quiet-observatory-project-detail-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-project-detail-empty-light.png) | [![Quiet Observatory Project Empty Dark](screenshots/01-quiet-observatory-project-detail-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/01-quiet-observatory-project-detail-empty-dark.png) |

---

### 4.2 方案二：Editorial Workspace 截图

| 场景 | 浅色模式 (Light) | 深色模式 (Dark) |
| :--- | :--- | :--- |
| **首页（内容态）**<br>*特刊社论头版、首字下沉、引用警句与学术证据板* | [![Editorial Workspace Home Light](screenshots/02-editorial-workspace-home-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-home-light.png) | [![Editorial Workspace Home Dark](screenshots/02-editorial-workspace-home-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-home-dark.png) |
| **首页（基线空态）**<br>*纯白卷轴、Ex Libris藏书票典雅印记* | [![Editorial Workspace Home Empty Light](screenshots/02-editorial-workspace-home-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-home-empty-light.png) | [![Editorial Workspace Home Empty Dark](screenshots/02-editorial-workspace-home-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-home-empty-dark.png) |
| **项目详情（hark 卷宗）**<br>*工作树专论、学术三线表与卷宗时序录* | [![Editorial Workspace Project Light](screenshots/02-editorial-workspace-project-detail-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-project-detail-light.png) | [![Editorial Workspace Project Dark](screenshots/02-editorial-workspace-project-detail-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-project-detail-dark.png) |
| **项目详情（初建空态）**<br>*白板以待、卷宗建档待勘* | [![Editorial Workspace Project Empty Light](screenshots/02-editorial-workspace-project-detail-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-project-detail-empty-light.png) | [![Editorial Workspace Project Empty Dark](screenshots/02-editorial-workspace-project-detail-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/02-editorial-workspace-project-detail-empty-dark.png) |

---

### 4.3 方案三：Instrument Studio 截图

| 场景 | 浅色模式 (Light) | 深色模式 (Dark) |
| :--- | :--- | :--- |
| **首页（内容态）**<br>*19寸机架箱、沉降示波器、双通道VU电平表与步进器* | [![Instrument Studio Home Light](screenshots/03-instrument-studio-home-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-home-light.png) | [![Instrument Studio Home Dark](screenshots/03-instrument-studio-home-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-home-dark.png) |
| **首页（基线空态）**<br>*示波器基线平波、双通道100%全绿电平* | [![Instrument Studio Home Empty Light](screenshots/03-instrument-studio-home-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-home-empty-light.png) | [![Instrument Studio Home Empty Dark](screenshots/03-instrument-studio-home-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-home-empty-dark.png) |
| **项目详情（hark 探针）**<br>*数字段码条、Git寄存器游标与测试逻辑分析器* | [![Instrument Studio Project Light](screenshots/03-instrument-studio-project-detail-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-project-detail-light.png) | [![Instrument Studio Project Dark](screenshots/03-instrument-studio-project-detail-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-project-detail-dark.png) |
| **项目详情（初建空态）**<br>*通道未连接、示波器无信号输入待命* | [![Instrument Studio Project Empty Light](screenshots/03-instrument-studio-project-detail-empty-light.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-project-detail-empty-light.png) | [![Instrument Studio Project Empty Dark](screenshots/03-instrument-studio-project-detail-empty-dark.png)](file:///Users/v/new-idea/hark/docs/design/screenshots/03-instrument-studio-project-detail-empty-dark.png) |

---

## 5. 深度对比评估矩阵

下表对三个方案进行了多维度客观工程与设计评估：

| 评价维度 | 方案一：Quiet Observatory | 方案二：Editorial Workspace | 方案三：Instrument Studio |
| :--- | :--- | :--- | :--- |
| **设计独特性与辨识度** | **高**。彻底摆脱常规后台卡片网格，将天文台的旷远与极细发丝刻度结合，空灵且专业。 | **极高**。在开源工具与开发控制台中罕见采用高质量报业排版与首字下沉，极具人文学术气质。 | **高**。致敬经典 Braun 与音乐硬件，物理拟物与现代数字结合，触感强烈。 |
| **日常使用舒适度 (抗疲劳度)** | **卓越**。负空间开阔，极少杂音边框，长时间挂在副屏毫无压迫感与视觉侵略性。 | **良好**。阅读长文时极具沉浸感，但大量长文本排版在快节奏工程排查时可能稍微分散注意力。 | **优秀**。段式电平表与颜色指示灯让状态一眼即知，但高对比度 LCD 与发光点在极暗环境可能较醒目。 |
| **5 秒内关键信息获取** | **优秀**。天幕大标题与透镜区域在 2 秒内直接传达核心异常，其余数据沉浸在背景台账中。 | **良好**。新闻头条式标题非常明确，但用户视线可能优先被大号首字下沉和引用警句吸引。 | **卓越**。段码 LCD 视窗与 VU 电平表在 1 秒内给出「红/绿、故障数、断言达成率」结论。 |
| **前端组件可维护性** | **高**。布局主要依靠清晰的 CSS Grid 与 Flexbox，组件语义清晰（Horizon, FocalLens, TableLedger）。 | **中等**。需要维护较多学术排版规则（如报头双线、首字下沉、特刊证据板的特定衬线对齐）。 | **中等**。段式电平表、沉降内阴影和波形渲染需要较多专属样式或 Canvas/SVG 辅助支持。 |
| **实现与迁移成本** | **低 - 中**。无缝兼容现有 REST/SSE 数据合同，现有 React 状态可直接映射为台账与事件流。 | **中**。现有简短的规则告警文案需被包装或提炼为具备学术社论感的大标题与摘要结构。 | **中**。需要封装硬件开关组件、段式数码管显示组件与电平表组件。 |
| **无障碍与对比度** | **高**。浅深色对比度均超过 WCAG AA（4.5:1），文本与背景分离度佳。 | **极高**。大字号衬线体配合经典墨黑与纸白，对比度极高（> 7:1）。 | **高**。黑色 LCD 视窗与高亮发光二极管对比度极高，但对色盲用户需严格依赖文字标注。 |

---

## 6. 综合推荐与 Phase 2 实施建议

### 6.1 方案取向建议

结合 Hearth 的定位——**「运行在本地的个人代码守卫智能体，追求宁静、克制、事实驱动与长期副屏守候」**：

1. **首选推荐：方案一 Quiet Observatory（安静精密的个人观测台）**
   - **理由**：Hearth 不是一个需要用户每天泡在里面写万字长文的编辑器，而是一个大部分时间静默运行、仅在关键代码异动或用例破裂时向用户汇报的「个人代码观测站」。
   - Observatory 方案的负空间感让其成为**最适合全天候开启并挂在显示器副屏**的界面；它消除了所有粗笨的白色圆角大卡片，用细线台账与大天幕态势叙事，5 秒内即可明确全局态势。
2. **强烈建议吸收的融合点**：
   - 从 **Editorial Workspace** 吸收**「特刊证据板 (Evidence Plate)」**：当用户点击展开具体候选题时，以学术证据板的形式呈现代码片段、测试堆栈与规则来源，保留考据的严肃感。
   - 从 **Instrument Studio** 吸收**「硬件段式电平表 (VU Meter Bar)」**：在台站台账中用微型段式电平表表达测试套件的通过比例，提供即时的物理刻度反馈。

### 6.2 Phase 2 实施路线图（等待用户确认后开启）

当用户从上述三套方案中明确最终方向后，Phase 2 将按以下步骤稳步推进生产代码落地（不破坏现有数据接口与安全流程）：

```mermaid
flowchart LR
    A[用户确认视觉方向] --> B[建立设计 Token 体系<br/>packages/tokens]
    B --> C[重塑核心组件库<br/>TopBar / Horizon / FocalPane]
    C --> D[逐页渐进重构<br/>Home -> Project -> Insight]
    D --> E[端到端回归验收<br/>Playwright + Vitest 全绿]
```

1. **Step 1：设计 Token 规范化**：
   - 将选定方案的颜色、字阶、间距、边框发丝线沉淀至 `@hearth/web` 的 CSS Token 变量体系，确保深浅主题完美切换。
2. **Step 2：核心骨架组件重构**：
   - 替换现有的同质化 `PageHeader` 与包裹卡片；
   - 构建专属布局容器（如全景天幕 `Horizon`、主焦点透镜 `FocalPane`、发丝台账 `LedgerTable`、走带流水 `TransitStream`）。
3. **Step 3：逐页渐进式替换**：
   - **首页**：个人项目简报与重点关注区域；
   - **项目详情页**：真实 Git/Observer 游标与测试套件诊断；
   - **洞察页**：结论与证据相互关联的阅读板；
   - **空态系统**：彻底淘汰占位图标，升级为具备安定感与专业守候信赖的基线状态。
4. **Step 4：自动化回归与无障碍复验**：
   - 保持全部 43 个单元测试与 25 个 Playwright 端到端测试 100% 通过；
   - 确保键盘导航、高对比度与移动端自适应表现不退化。
