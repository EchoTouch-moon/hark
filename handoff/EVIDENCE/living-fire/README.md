# 玻璃火影与活炉心验收证据

本轮所有截图、录屏与浏览器请求使用本地合成数据库，无真实项目与隐私数据。画面验证隔着磨砂玻璃的真实湍流翻动火影、昼夜底色渲染、键盘控制火焰大小、动效暂停与无 WebGL 优雅降级。

- `01-day-glass.png`：白天暖白玻璃空间与中央柔和橙色火影。
- `02-size-small.png`：键盘 Home 调节至最小 65% 火焰。
- `03-size-large.png`：键盘 End 调节至最大 140% 火焰，持久化于本机偏好，不虚增炉温。
- `04-night-glass.png`：夜间深黑空间，玻璃火影为唯一暖色光源。
- `05-night-welcome.png`：夜间欢迎界面，与对话共享玻璃后的同一团火焰。
- `06-night-waiting.png`：消息发送中的温和呼吸等待反馈。
- `07-night-conversation.png`：收到确认后升温，文字与火光层次分明。
- `08-reduced-1280.png`：模拟系统减少动态效果或手动暂停，画面静止可读；1280 视口无横向滚动。
- `09-no-webgl-fallback.png`：缺少 WebGL 环境时，优雅降级为静态平滑火影。
- `fire-behind-glass.webm`：Playwright 浏览器执行全流程录屏。
- `browser-check.txt`：`glass-fire.mjs` 实际执行结果（7 项全 PASS）。
- `conversation-regression.txt` / `day-night-regression.txt`：已有回归套件实际输出。
- `lint-check.txt`、`typecheck.txt`、`unit-check.txt`：工程命令实测输出。

复现命令（启动独立 4404 服务）：
```sh
HEARTH_PORT=4404 HEARTH_DB="$PWD/data/qa-day-night.sqlite" HEARTH_OBSERVER_DB="$PWD/data/qa-day-night-observer.sqlite" HEARTH_ANALYSIS_DB="$PWD/data/qa-day-night-analysis.sqlite" HEARTH_INSIGHT_DB="$PWD/data/qa-day-night-insights.sqlite" HEARTH_ARTIFACTS="$PWD/data/qa-day-night-artifacts" HEARTH_OBSERVER_WATCH=0 pnpm --filter @hearth/server dev
```
构建后运行：
```sh
node scripts/qa/glass-fire.mjs
HEARTH_QA_URL=http://127.0.0.1:4404 HEARTH_QA_EVIDENCE_DIR=handoff/EVIDENCE/living-fire/day-night-regression node scripts/qa/day-night-hearth.mjs
HEARTH_QA_URL=http://127.0.0.1:4404 HEARTH_QA_EVIDENCE_DIR=handoff/EVIDENCE/living-fire/regression node scripts/qa/conversation-hearth.mjs
```
