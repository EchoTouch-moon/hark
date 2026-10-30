# Hearth · 毛玻璃后的炉火

2026-10-31：按用户要求恢复炉火意象，沿用极简自然对话。火体在无边框毛玻璃后持续流动；输入时轻轻回应，长谈后收到顶部，让文字和交流保持主角。

这是独立设计原型，07仍保留；正式React应用和既定后台功能没有改动。项目、记忆、判断和回复均为合成示例，不会读取真实目录、调用模型/研究或发送系统通知。

在仓库根目录启动：

```sh
python3 -m http.server 4342 --bind 127.0.0.1 --directory prototypes/08-living-hearth
```

打开 http://127.0.0.1:4342 。Ctrl+C停止。

- 首页可以直接提问；点击项目线索进入该项目的独立对话。
- 输入框底部切换项目，草稿和历史分别保存，刷新恢复。
- 旧记录可以原处展开；依据、档案、项目库、目录授权演示与设置按需访问。
- 角落暂停按钮停止火焰循环；系统减少动态偏好下自动保留静帧。
- WebGL不可用或丢失时保留静态火图和正常交流，不阻塞使用。

存储键：`hearth.living-prototype.v1`（合成项目交互）；`hearth.living-motion.v1`（动效偏好）。不读取07的原型状态。清除相应浏览器本地键可重置。

火焰沿用本仓库既有纹理与着色器。资产来源与嵌入元数据见assets/SOURCE.md；字体本地提供并附OFL。无外部运行时请求、无新依赖、无声音。火势不代表进度、评分或真实后台工作。

验证（先启动服务，使用仓库既有依赖）：

```sh
node prototypes/08-living-hearth/verify.mjs
node prototypes/08-living-hearth/build-flame.mjs --check
```

修改火焰TypeScript后重新生成浏览器模块：

```sh
node prototypes/08-living-hearth/build-flame.mjs
```

33项浏览器检查、局部strict类型检查、截图和实际动效录屏：`handoff/EVIDENCE/living-hearth-2026-10-31/`。当前终版截图使用frosted前缀；round1/final前缀记录用户要求加毛玻璃之前的中间实现，不作当前设计依据。视频living-hearth-preview.webm为当前毛玻璃版的真实界面录屏。

方向与动效合同位于仓库docs/design/2026-10-31-LIVING-FIRE-BRIEF.md，设计系统见本目录DESIGN.md及.impeccable/design.json。
