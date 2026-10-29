# EmberPresence 炉心造型与运动

2026-10-30。本次仅桌面 1440×900、1280×800；浏览器画面验收由主代理完成，本文不声称截图已通过。

## 三态与材质

- 黯（`cool`）：低矮的独立余焰轮廓，火腹收窄，侧焰和热晕减弱，炭心轮廓、裂隙仍可见；不使用旺焰等比例缩小。
- 温（`warm`）：中央分叉、左低右高的连续曲线，半透明侧焰与透亮内芯交叠。
- 旺（`hot`）：最高主舌、两侧独立火舌与多重凹口；米白内焰、杏色中层、赭橙透明边缘。最高尖端偏离轴线，底部仍落在同一炭心。

每态由手绘 SVG 路径构成，没有圆形火体。外焰、中焰、内芯、细亮热流与弧形透光带分别绘制。炭心使用暗部、切面、边缘磨损、细纹与细亮裂隙；唯一模糊用于裂隙局部热光。热晕轻于实体，不遮盖文字或输入。

## 运动控制

已阅读并实际应用本地 `gsap-core`、`gsap-react`、`gsap-timeline` 指南。组件导入并注册 `useGSAP`，以两条真正的 GSAP 时间线分别管理点燃和持续运动；不再使用 CSS 动画或原生 WAAPI。

- 点燃时间线显式标记 `core` → `wings` → `mantle`：内芯先亮，侧舌以 55ms 错开，外焰最后升起。点燃约 860ms，复燃约 1100ms。使用 `fromTo` 明确起止值、`power3.out` 缓动。
- 持续时间线带 `breath`、`tongue`、`cinders` 标签。外焰、中焰、内芯、透光带分别用不同周期的 `sine.inOut` 往返；火星嵌套时间线错相升起消隐。运动原点通过 `svgOrigin` 固定在各自火舌根部，炭心不浮动。
- 外焰通过 GSAP `attr: { d }` 对相同命令序列的贝塞尔控制点做微幅往返形变，无 MorphSVG 插件要求。黯态保留安静火形，只给裂隙局部极慢的呼吸。
- 点燃只作用于父级 stage，持续运动只作用于内部路径；没有两个引擎竞争同一个 transform。
- 手动 `paused` 与 `document.hidden` 对两条时间线调用暂停，恢复用原时间点继续，不重建点燃。
- `prefers-reduced-motion` 初始直接保留完整 SVG；运行中切换时，点燃 `.progress(1).pause()`，持续运动 context 还原静态轮廓。
- 每个 `useGSAP` 都设置 `scope: root`、`revertOnUpdate: true`，场景变更或卸载自动清理；组件句柄同步置空。SVG 定义使用 React `useId` 隔离。未使用 SVG SMIL。
- 根节点 `data-motion-engine="gsap"` 为非视觉审计标记，可与路径 `d`、内焰 `transform` 的浏览器采样共同验证实际运行。

API：`band='cool' | 'warm' | 'hot'`、`scene: string`、`compact`、`paused`、`className`，保持原调用合同。视觉组件 `aria-hidden`，状态语义由调用方文本表达。

## 已运行检查

- `pnpm exec eslint apps/web/src/components/EmberPresence.tsx`：通过。
- `pnpm --filter @hearth/web typecheck`：通过。

主代理仍须在真实浏览器核对：三态静帧可辨、点燃和再燃、手动暂停恢复、隐藏页面恢复、减少动态效果、桌面两种尺寸。无 JavaScript 时 SVG 默认显示完整静态轮廓，不依赖初始隐藏样式。
