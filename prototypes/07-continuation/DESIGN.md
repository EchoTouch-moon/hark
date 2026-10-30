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
  note: "#e9eaf3"
  note-ink: "#464d65"
typography:
  brand:
    fontFamily: "Instrument, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1
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

个人研究助理的阅览工作台。窄索引承载导航，工作区围绕一个具体项目给出判断；可读档案与页边便笺承载材料与推断。故事通过阅读、翻开、继续讨论发生。

这是本目录已实现的独立设计原型，不覆盖正式前端的设计系统。

**Key Characteristics:**
- 单一当前判断，依据按需展开。
- 中文阅读优先，材料与推断分层。
- 安静背景、清晰动作、低存在感品牌。

## Colors

主色为苔绿墨，纸白为阅读背景，灰绿索引建立工作区边界；灰紫便笺区分新的研究提示。色值以frontmatter及style.css为准。

**The Evidence Rule.** 色彩不能代替“示例、推测、未知”的文字说明。

深色主题沿用同一语义：背景(#202723)、表面(#29312b)、文字(#e7ece3)、强调(#c9d8bf)、便笺(#353b4b)。

## Typography

中文标题使用本地Noto Serif SC子集；英文品牌和资料中的英文使用Instrument Serif。正文使用系统无衬线，辅助文字最低(11px)，正文默认(14px)。标题为桌面阅读服务，短句自然换行；不以英文装饰压过中文判断。

**The Reading Rule.** 标题先说清楚判断，再用字号表达层次。

## Layout

桌面为窄索引栏(210px)加单一工作区；主区左右内边距通常(58px)。发现页判断与材料并置，其他项目通过分隔线列表出现。900px以内单列，620px以内侧栏改为顶部导航；390px无横向溢出。

1280×800首屏内可达主动作，实测按钮底边(631px)。项目档案用概况、研究与线索、你的选择三个同级入口；对话始终显示当前项目范围。

## Elevation & Depth

大部分界面平面呈现。档案通过细边、轻微层叠与柔和阴影(0 14px 38px #21382a0a)产生“材料在手边”的感觉；窄屏减弱纸页旋转。没有纹理、火焰或大面积光效。

## Shapes

控件微圆角，档案近似直角；项目索引采用连续行。主动作实心，展开依据为轻量下划线链接，降低重复入口竞争。

## Components

主按钮具备默认、悬停及可见焦点；输入框用细边与原生校验。导航以浅灰绿背景和文字加重标识当前页。判断页右侧材料可直接阅读，点击翻开项目档案；灰紫批注保留不确定性和下一步。依据弹窗支持Escape关闭并恢复焦点。

页面切换轻微入场(240ms)，减少动态偏好下取消；忙闲只是明确标注的手动演示，无持续呼吸或虚假进度。

## Do's and Don'ts

### Do:
- Do 把具体项目与一句判断放在主要位置。
- Do 让用户随时看见讨论范围、材料来源与未知部分。
- Do 将新发现接回原项目对话。

### Don't:
- Don't 把合成材料或预设回复包装为真实研究。
- Don't 用热度、生命值或装饰性仪表盘决定项目价值。
- Don't 让背景故事盖过用户的项目。
