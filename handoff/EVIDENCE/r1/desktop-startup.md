# 主线普通聊天接线与开发窗口启动

代码：3b9dee7（普通聊天Native接线）+ d74ba9f（Bridge实例与提前完成事件刷新修复）。用户原前端目录保持不动，未发真实模型请求，未使用已撤销Key。

主会话串行合入后实际执行，set -euo pipefail：
- UI类型、23项UI测试、Vite build：exit0。
- Core全量56项、Native lib2+bridge6+flow9（17项）：exit0。普通回合probe明确scripted transport，真实Core/Node/PiSDK/stdio与SQLite，不是真实模型。
- `cargo build --manifest-path apps/desktop/Cargo.toml --offline -p hark-desktop`：exit0，开发二进制已构建。
- 主会话启动Vite，访问 `http://127.0.0.1:1420/` 实际HTTP200。
- 启动新构建的hark-desktop进程，3秒后仍运行，启动日志为空；通过NSRunningApplication按该PID激活，返回DESKTOP_ACTIVATED=true。

这是实际服务/进程/窗口激活证据，不是截图、浏览器DOM验证或Native控件点击验收；没有据此宣称界面全部交互通过。两处剩余快速切Workspace时序窗口和组件测试缺口见conversation-native证据，不扩本轮Gate。

开发进程已为用户保留运行。默认模型未配置，stepFunConfigured=false，不能把普通聊天scripted回归当应用内真实模型启用。用户可在桌面查看本地项目导入/卡片/消息/来源入口；浏览器独立页面没有Tauri能力，不会回退到假数据。
