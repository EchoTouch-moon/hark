# 昼夜炉心验收证据

全部截图、录屏与浏览器请求使用专门的本地合成数据库；画面中没有真实项目或对话。设备时间在浏览器中模拟为本地白天/夜晚，不代表真实操作系统时间调整。

- `00-day-welcome.png`、`01-day-empty.png`、`02-day-waiting.png`：白天欢迎、空对话及真实请求等待。
- `03-night-conversation.png` 至 `10-night-settings.png`：夜间对话、菜单、欢迎、空态、减少动态效果、项目和设置。
- `day-night-interactions.webm`：本轮浏览器交互录屏；`browser-check.txt` 是昼夜/等待/暂停/失败/切换及夜间对比度检查。
- `regression-check.txt` 是已有对话与炉温回归；`unit-check.txt`、`focused-check.txt`、`typecheck.txt`、`lint-check.txt` 是实际命令输出。空的 lint 日志表示命令 exit 0 且无警告。
- Web 构建 `pnpm --filter @hearth/web build` exit 0（2026-10-30），Vite 对约 506 kB 的主 JavaScript 包提出拆包提示；没有做性能专项。

复现时启动独立服务（所有路径均为本仓库下的合成数据）：

```sh
HEARTH_PORT=4404 HEARTH_DB="$PWD/data/qa-day-night.sqlite" HEARTH_OBSERVER_DB="$PWD/data/qa-day-night-observer.sqlite" HEARTH_ANALYSIS_DB="$PWD/data/qa-day-night-analysis.sqlite" HEARTH_INSIGHT_DB="$PWD/data/qa-day-night-insights.sqlite" HEARTH_ARTIFACTS="$PWD/data/qa-day-night-artifacts" HEARTH_OBSERVER_WATCH=0 pnpm --filter @hearth/server dev
```

构建前端后运行 `node scripts/qa/day-night-hearth.mjs`；旧流程回归可设置 `HEARTH_QA_URL=http://127.0.0.1:4404` 和 `HEARTH_QA_EVIDENCE_DIR` 后运行 `node scripts/qa/conversation-hearth.mjs`。后台可见性和减少动态效果为浏览器模拟，未进行完整历史 E2E、整站无障碍认证或 OS 级节能测试。
