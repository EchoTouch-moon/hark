---
name: "Hearth · 炉火对话（独立原型08）"
description: "文字与对话在前，无边框毛玻璃后的炉火在场。"
colors:
  paper: "#f6f2eb"
  surface: "#fffcf7"
  ink: "#302820"
  muted: "#75695f"
  line: "#ded5c9"
  accent: "#8a432b"
  on-accent: "#fff9f0"
  wash: "#eee3d4"
  note: "#f2e6d7"
  note-ink: "#694e3b"
  focus: "#a35c36"
  danger: "#984b3d"
  glow: "#d1894d24"
  dark-paper: "#211d19"
  dark-surface: "#2b2520"
  dark-ink: "#eee5d8"
  dark-muted: "#b9aa98"
  dark-line: "#4a3c32"
  dark-accent: "#edb582"
  dark-on-accent: "#302117"
  dark-wash: "#3c3026"
  dark-note: "#3c3026"
  dark-note-ink: "#d8bfa5"
  dark-focus: "#e0a46b"
  dark-danger: "#edb49e"
  dark-glow: "#e493442b"
typography:
  brand:
    fontFamily: "Instrument,serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1
  title:
    fontFamily: "ContinuationSerif,'Songti SC',serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1.6
  body:
    fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  conversation:
    fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.95
  opening:
    fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.9
  memory:
    fontFamily: "ContinuationSerif,'Songti SC',serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.8
  label:
    fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: "11px"
    fontWeight: 400
rounded:
  small: "5px"
  sheet: "6px"
  button: "8px"
  dialog: "12px"
  message: "14px"
  composer: "16px"
  round: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  section: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.button}"
    padding: "11px 17px"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "9px 14px"
  composer:
    rounded: "{rounded.composer}"
    padding: "17px 20px 12px"
  navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.small}"
    padding: "8px 12px"
  suggestion:
    textColor: "{colors.muted}"
    padding: "7px 0"
  memory-fold:
    textColor: "{colors.muted}"
    typography: "{typography.memory}"
  note-sheet:
    backgroundColor: "{colors.note}"
    textColor: "{colors.note-ink}"
    rounded: "{rounded.sheet}"
    padding: "24px"
  directory-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.small}"
    height: "44px"
    padding: "10px 12px"
---

# Design System: Hearth · 炉火对话

## Overview

**Creative North Star: "毛玻璃后的炉心"**

一处持续有生命力的炉火，接住被搁置项目的下一次对话。暖纸、深褐墨与铜橙构成日间，深色延续为暗炉室；火藏在无边框毛玻璃扩散层后，文字始终最清楚。

这是 prototypes/08-living-hearth 的已实现视觉记录，依据 PRODUCT.md 与炉火方向合同提取；它是独立合成资料原型，不代表正式前后端已迁移。自然简短的对话保持低密度，项目、资料、设置按需进入，长谈时火收至顶部。

**Key Characteristics:**
- 暖纸与暗炉室沿用同一信息层级。
- 无边框毛玻璃只扩散火层，不模糊文字。
- 系统字体负责阅读，品牌与少量旧记录保留衬线辨识。
- 动效可暂停、可降级，不承担产品状态证明。

## Colors

主色是克制的铜褐与炉光，底色保留纸张与深墨的温度。frontmatter 的浅色键对应 :root，dark- 前缀对应深色覆盖；这些是实际 CSS 值，不是新增主题。

### Primary

- **铜褐行动色（accent / dark-accent）**：发送、主要行动与少量项目链接；on-accent 保持按钮文字层级。
- **炉光（glow / dark-glow）**：火体周边的微弱暖意与输入聚焦阴影，包含原始透明度。

### Neutral

- **暖纸 / 暗炉室（paper）**：页面底色；surface 为输入、设置表单和依据对话框的表面。
- **深褐墨 / 暖亮墨（ink）**：正文；muted 为时间、说明与辅助操作，line 负责必要的细分隔。
- **浅洗色（wash）**：用户消息与导航悬停；note / note-ink 为档案页边线索。
- **焦点铜（focus）与警示褐（danger）**：focus 已用于键盘轮廓与输入边界；danger 已声明但当前原型没有独立错误视觉组件。

**The Honest Fire Rule.** 火势不代表项目评分、进度、研究成果或真实后台运行；重要含义必须有明确文字。

## Typography

**Display Font:** Instrument, serif，用于品牌字标与项目索引。字体文件随原型提供。

**Body Font:** 系统字体栈，中文优先匹配 PingFang SC / Microsoft YaHei。

**引用与档案标题:** ContinuationSerif（本地 Noto Serif SC 子集），回退 Songti SC / serif。并非正文全面衬线化。

### Hierarchy

- **Brand**：桌面品牌字标，窄屏字号收为（28px）。
- **Title**：辅助页标题；档案主标题另用（34px / 1.5），窄屏（30px）。
- **Body / Conversation**：正文按 frontmatter 的 body 与 conversation；消息行长限制（65ch），说明类正文多用（13px）。
- **Opening**：首次具体判断使用 opening，窄屏（17px）；已有对话中的常规消息回到 conversation。
- **Memory / Label**：旧记录引语与来源日期低权重并列；窄屏引语（12px）。

**The Reading Rule.** 正文与对话使用系统字体，ContinuationSerif 只承担旧念头、档案标题等有限层级。

## Layout

桌面对话中轴最大宽（680px），顶部栏高（80px），左右外距（38px）。辅助页容器最大宽（1100px），内距（38px 42px 40px）。不设置常驻侧栏。项目列表以横向细分隔和文字层级组织，档案页和目录演示可采用双栏。

首次对话前，炉火占位高（140px），对话与输入在可用空间中聚拢；首次消息后进入长谈布局，消息区独立滚动，输入框保持在底部。火体基础画布区域（300px × 240px），初始缩放桌面为（1）、窄屏为（0.78）；有消息或进入辅助页时缩为（0.24）并移至顶部锚点。火不铺在对话文字后。

断点（900px）将档案和目录演示双栏折为单栏；断点（620px）将顶部栏收为（66px）、页面左右内距收为（22px），火占位为（120px）。输入字设为（16px），用户消息最大宽从（85%）变为（90%），并考虑底部安全区。

## Elevation & Depth

以纸张色阶、留白和少量细线表达层次。输入框常态最终覆盖为无阴影；聚焦仍保留炉光阴影。只有依据对话框具有明显结构阴影与半透明遮罩。

### Shadow Vocabulary

- **输入聚焦**：`0 5px 25px var(--glow)`，伴随 focus 边界。
- **依据对话框**：`0 20px 90px #1b0c0638`；遮罩 `#21160f70`，不使用毛玻璃。
- **炉光**：径向渐变与（18px）模糊；它是背景光，不是面板投影。

火层扩散器采用 `blur(15px) saturate(.9)` 与 paper（24%）混合的透明底，径向 mask 从（42%）至（76%）消隐边缘。窄屏扩散为 `blur(17px) saturate(.85)`。扩散器无边框，canvas 与图像降级透明度为（.68）；不支持 backdrop-filter 时仅对火图形加（12px）模糊，文字不受影响。

**The Foreground Rule.** 文字与对话是清楚的前景；火只能经过无边框扩散层显现，不增加玻璃卡框。

## Shapes

常规按钮温和短圆角，输入框比按钮更圆，用户消息略圆；半径值以 frontmatter 为准。辅助页边注为纸页式小圆角，无玻璃材质。项目行和档案标签靠分隔线而非独立卡片包围。图标按钮为圆形，线图标通常（20px）、描边（1.4），顶部小图标（17px）。

## Components

### Buttons

主要按钮为铜褐实底、浅色文字，最小高（42px）；发送按钮缩为最小高（36px），内距（8px 13px）。悬停以 accent（88%）与 ink 混色，按下缩为（.98）。次要按钮以 line 描边，最小高（40px）。文本操作使用低权重文字及悬停下划线。全局禁用按钮透明度（.5），键盘焦点为（2px）focus 轮廓与（5px）偏移。

### Conversation composer / Inputs

输入框为 surface（90%）透明混色，line 边界；聚焦时改为 focus 边界与炉光阴影。textarea 默认（15px / 1.8），可高（45px 至 130px），窄屏改为（16px）与最小高（44px）。范围选择与发送并列，低权重演示说明在框外。目录演示的文本输入另有 paper 底、line 边界及固定高（44px）。

### Navigation / Suggestions

顶部只保留项目文字和设置、暂停、明暗图标；悬停使用 wash，按下状态使用 wash 与 accent。项目档案标签靠文字与底部 accent 细线表示当前项。所谓建议 chip 实际是无药丸底的文字按钮：低权重文字、轻下划线响应，不改造成醒目的标签。

### Memory fold / Note sheet

原生 details 以项目名、年月和一小句旧念头构成记忆折页，展开后显示材料、未知部分和合成资料说明；箭头旋转（90deg）。档案边注使用 note / note-ink，标题、引语、来源与行动顺序清楚。sidecar 的折页能原生展开；其他片段只展示实际视觉状态，不携带产品行为脚本。

### Living fire

复用现有火焰纹理和 WebGL renderer，来源以 `assets/SOURCE.md` 为准，不推断原始创作方式或许可。JS 帧循环上限（30fps）；输入回应按动画时间节流（400ms），typing 脉冲时长（280ms），发送/换项目脉冲（480ms）。聚焦微亮；本地示例消息保存后的 cue 温和抬焰，不表示模型推理。交互层不调用火星喷出。

位置变换用（620ms）`cubic-bezier(.16,1,.3,1)`，显现（200ms），普通按钮颜色过渡（160ms）。这些 CSS 过渡与 WebGL 时间、帧数是不同机制。`getHearthFlameState()` 的 snapshot 返回 mode / frames / time / focus / pulse / textureReady，仅供读取动画状态；CSS 的 data-motion 与静态透明度不能证明帧持续推进。暂停、减少动态效果、页面隐藏停止循环并绘制静帧；无 WebGL 或上下文丢失切换到原纹理图像，完整交互继续。静态 sidecar 不尝试重造 WebGL 火体。

## Do's and Don'ts

### Do:

- Do 保留单列对话、低权重旧记录及按需展开的资料入口。
- Do 使用语义色变量切换暖纸与暗炉室，保持可见焦点和中文状态文案。
- Do 在长谈时将火收至顶部，让消息独立滚动、输入框落底。
- Do 保留暂停、减少动态效果、页面隐藏静帧与无 WebGL 图像降级。
- Do 引用现有纹理时保留 assets/SOURCE.md 的可核查来源。

### Don't:

- Don't 让毛玻璃覆盖文本，或为火层加可见边框、玻璃卡片。
- Don't 将火改成进度、评分、后台活动证明或养成奖励。
- Don't 添加常驻侧栏、仪表盘、未经请求的新功能或另一套皮肤。
- Don't 把合成示例回复、CSS 静态状态或 snapshot 字段当作真实研究、性能或用户实验结果。
