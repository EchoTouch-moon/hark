---
name: Hearth · 续页
description: 独立备选原型，重新翻开尚有可能的项目
colors:
  primary: "#354e41"
  paper: "#f5f5f0"
  surface: "#fffefa"
  index: "#e9ede6"
  ink: "#25332d"
  muted: "#626e65"
  line: "#d3dacf"
  selected: "#e0e6dc"
  note: "#e9eaf3"
  note-ink: "#464d65"
typography:
  brand:
    fontFamily: "Instrument, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1
  app-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  mobile-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
  label:
    fontSize: "11px"
  secondary:
    fontSize: "12px"
  action:
    fontSize: "13px"
  display:
    fontFamily: "ContinuationSerif, Songti SC, serif"
    fontSize: "clamp(30px,3vw,44px)"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
rounded:
  control: "5px"
  field: "4px"
  message: "14px"
  action: "8px"
  composer: "12px"
  scrollbar: "6px"
spacing:
  small: "8px"
  medium: "24px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "44px"
---

# Design System: Hearth · 续页

## Overview

**Creative North Star: "每个被搁置的念头，都可以有下一页。"**

个人项目Agent的对话工作台。用户打开后就可以输入；当前项目判断作为Agent的一条消息出现，材料按需查看。故事通过对话与项目记忆的连续性发生，主页面不陈列手稿。

这是本目录已实现的独立设计原型，不覆盖正式前端的设计系统。

**Key Characteristics:**
- 对话是主操作，判断融入消息，依据按需展开。
- 中文阅读优先，材料与推断分层。
- 安静背景、清晰动作、低存在感品牌。

## Colors

主色为苔绿墨，纸白为阅读背景，灰绿索引建立工作区边界；灰紫便笺区分新的研究提示。色值以frontmatter及style.css为准。

**The Evidence Rule.** 色彩不能代替“示例、推测、未知”的文字说明。

深色主题沿用同一语义：背景(#202723)、表面(#29312b)、文字(#e7ece3)、强调(#c9d8bf)、便笺(#353b4b)。

## Typography

主界面使用固定字号系统无衬线：范围标题(16px)、正文(14px)、辅助(11–12px)。Instrument仅保留小型品牌字标；中文衬线仅继续用于档案等辅助页。主操作不使用大幅展示标题。

**The Reading Rule.** 标题先说清楚判断，再用字号表达层次。

## Layout

桌面为索引栏(210px)与单一对话区，内容最大宽度(760px)。顶栏(60px)，消息区独立滚动，输入框常驻。640附近以下转顶部导航；实际断点(620px)。窄屏整个工作台使用动态视口高度，消息区收缩而非挤出发送按钮。项目档案仍通过辅助页面按需查看。

## Elevation & Depth

大部分界面平面呈现。档案通过细边、轻微层叠与柔和阴影(0 14px 38px #21382a0a)产生“材料在手边”的感觉；窄屏减弱纸页旋转。没有纹理、火焰或大面积光效。

## Shapes

控件微圆角，档案近似直角；项目索引采用连续行。主动作实心，展开依据为轻量下划线链接，降低重复入口竞争。

## Components

主动发现采用单条圆角操作建议：按钮、项目与一句判断并置，来源和暂缓置于下方。Agent消息靠左、用户消息靠右，均使用克制的圆角表面；参考Hark Pro的操作建议与聊天示意，保留本产品色系和权限边界。

主按钮具备默认、悬停及可见焦点；输入框用细边与原生校验。导航以浅灰绿背景和文字加重标识当前页。判断页右侧材料可直接阅读，点击翻开项目档案；灰紫批注保留不确定性和下一步。依据弹窗支持Escape关闭并恢复焦点。

对话及页面切换立即出现，不编排入场。消息区可滚动；发送按钮在空白输入时禁用。讨论范围使用原生select，每个范围保留草稿和消息。忙闲仅手动演示，无持续呼吸或虚假进度。

## Do's and Don'ts

### Do:
- Do 让用户打开就能输入，一条判断作为对话开场。
- Do 让用户随时看见讨论范围、材料来源与未知部分。
- Do 将新发现接回原项目对话。

### Don't:
- Don't 把合成材料或预设回复包装为真实研究。
- Don't 用热度、生命值或装饰性仪表盘决定项目价值。
- Don't 让背景故事盖过用户的项目。
