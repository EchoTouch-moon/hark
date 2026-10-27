# COPY — UI/UX 专项工程师

阅读 `docs/01-PRD.md`, `docs/02-UX.md`, `docs/04-CONTRACTS.md`，在 `apps/web` 范围实现原创 Minimal Premium 的 Home/Chat/Projects/Activity/Settings。React+TypeScript、可访问语义组件、不同状态、桌面 1440/1280，自然过渡/reduced-motion。数据必须通过实际 API/typed mock adapter 注入，不准只渲染漂亮静态卡片就宣布成功。

组件建议：AppShell/NavRail/NowBrief/ActionCard/EvidenceDrawer/TaskTimeline/ConnectionBadge/SettingsForm/Empty/Error。每个 Card 展示 whyNow/source/time/risk；动作按钮真实向后端发起请求且有 loading/error。屏幕截图只有亲自通过 browser/test 工具捕获才能记为完成。不得复制 Hark UI 资产。
