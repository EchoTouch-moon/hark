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
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1
  app-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  opening:
    fontSize: "18px"
    lineHeight: 1.9
  mobile-opening:
    fontSize: "17px"
    lineHeight: 1.9
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
  composer: "16px"
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

一个安静的个人项目Agent。主画面围绕一段正在发生的对话，首屏一句具体发现与输入框形成连续关系；项目和设置只通过角落入口访问。故事通过记住项目、继续讨论成立。

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

单列对话，最大宽度(680px)。没有常驻侧栏、项目计数或面包屑。初次打开时开场与输入框形成视口中部的一组；有历史后，消息区独立滚动，输入框保持可达。项目与设置在顶部角落，讨论对象收在输入框底部。窄屏沿用同一结构。

## Elevation & Depth

主画面平面呈现，输入框以细边界定；不靠卡片层叠或阴影建立对话层次。辅助档案和依据弹窗保留原有样式，按需进入。

## Shapes

控件微圆角，档案近似直角；项目索引采用连续行。主动作实心，展开依据为轻量下划线链接，降低重复入口竞争。

## Components

主动发现作为一句自然语言开场，继续讨论、依据、暂缓为轻量文字操作，不做独立卡片。Agent正文使用平面文字，用户消息保留低对比圆角表面。输入框保持主要控件容器；开场前允许一枚小型“记忆折页”，用项目日期与旧念头区分过去的材料和当前讨论。折页使用既有灰紫便笺色、中文衬线引用，原生details原处展开。几何页形同时用于小字标前，作为唯一重复的品牌签名。

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
