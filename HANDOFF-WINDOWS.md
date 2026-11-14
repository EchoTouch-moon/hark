# Hark · 桌面对话炉心 (R1 Frontend) — Windows 接续开发交接文档

> **交接日期**：2026-11-14  
> **GitHub 仓库与分支**：[`EchoTouch-moon/hark`](https://github.com/EchoTouch-moon/hark) · **`r1-frontend`** 分支（`master` 保留原设计/规划文档，`codex/macos-rebuild` 保留早期合成后端夹具）  
> **原开发目录（macOS）**：`/Users/v/antigravity/Hark-·-桌面对话炉心-(R1-Frontend)`  
> **前端核心规范**：[Hark-R1-Frontend-PRD-v1.0_fdfeebb9.md](./public/assets/aistudio/Hark-R1-Frontend-PRD-v1.0_fdfeebb9.md)

---

## 1. 当前项目定位与整体现状

本工程是 **Hark R1 桌面个人 Agent 的独立 React + Vite + TypeScript 前端**（源自 AI Studio 导出模板，并在 2026-11-06 至 2026-11-13 持续演进）。  
**注意：本仓库仅包含前端 UI 与 Tauri IPC 适配层，不包含 `src-tauri/`（Rust Core）及 Pi Agent Host Sidecar 源码。**

### 核心设计原则（不可违背）
- **单页炉心**：主窗口只有「Quiet Header + 中央对话空间（Conversation Hearth）+ 背景火光」，禁止恢复传统 240px 左侧导航栏或 Dashboard 统计卡片。
- **严格 Bridge 边界**：默认运行在 `strict_tauri_ipc` 模式（`src/app/app-shell.tsx` 第 78–80 行），Tauri 不可用时显式报 `SIDECAR_UNAVAILABLE`，**绝不静默降级到 Mock/DevPreview**。
- **火光叙事约束**：火焰阶段（`neutral | ember | gentle | bright | milestone`）只由后端 `NarrativeState` 决定（前端通过 `resolveSafeFlameStage` 安全回退到 `neutral`），禁止用消息数/签到数推算火势。
- **外发审阅与权限分离**：支持 `OutboundReviewDialog` 对单次模型外发请求做人工审阅（仅凭 `reviewId` 确认/拒绝，不暴露密钥）。

---

## 2. 已完成模块与目录结构

```text
src/
├── App.tsx / main.tsx / index.css        # 入口与双主题 CSS 变量（日间暖白 / 夜间近黑）
├── app/
│   └── app-shell.tsx                     # FE-01 主容器：工作区切换隔离、InFlightTurn 对账与看门狗、自动置底、按需抽屉调度
├── assets/
│   └── living-fire.png                   # 火焰纹理贴图
├── bridge/
│   ├── HarkBridge.ts                     # hark.ui.v1 前端-宿主领域契约（Workspace / Onboarding / Stream / Opinion / Evidence / Search / StepFun）
│   ├── tauri-bridge.ts                   # Tauri 2 invoke / Channel / listen("hark://app-event") 封装与 StrictUnavailableTauriBridge
│   ├── native-adapter.ts                 # Native Shell camelCase DTO ↔ HarkBridge 映射（含 zod 校验与智谱 MCP / Tavily 连通性测试）
│   ├── receipt-projection.ts             # 记忆回执投影
│   ├── schemas.ts                        # 火焰视觉描述、RunStreamEvent 去重排序、Stalled Turn 对账、Draft 隔离、错误码映射
│   ├── dev-preview.ts                    # 显式 DevPreviewHarkBridge（合成项目、多项目候选、流式模拟、证据分级）
│   ├── schemas.test.ts                   # 7 个单测（node:test）
│   └── native-adapter.test.ts            # 37 个单测（node:test，需 zod）
├── components/
│   ├── feedback/OfflineErrorBanner.tsx   # 错误与断联恢复条
│   ├── hearth/
│   │   ├── FlameAtmosphere.tsx           # 背景火光容器（支持 pauseMotion 与窗口隐藏停绘）
│   │   ├── flameRenderer.ts              # Canvas 动态火焰与火星粒子渲染器（R1_FLAME_STAGE_SHAPES）
│   │   ├── HomeHeader.tsx                # 顶部低密度导航：Workspace 切换、火光状态徽章、检索按钮、更多菜单
│   │   ├── MemoryFold.tsx                # 对话顶部可折叠「记忆折页」
│   │   ├── AttentionNotice.tsx           # 轻量提醒条
│   │   ├── ProjectOverviewSheet.tsx      # 项目概览抽屉
│   │   └── TrayCompanionBar.tsx          # 托盘最小化/恢复伴随条（浏览器预览模拟托盘）
│   └── markdown/
│       ├── MarkdownContent.tsx           # Markdown 渲染与代码块复制
│       ├── parser.ts                     # 流式安全 Markdown 分词器
│       └── parser.test.ts                # 6 个单测（node:test）
└── features/
    ├── onboarding/                       # FolderOnboarding.tsx / OnboardingProgress.tsx（文件夹选择、边界确认、StepFun Key 设置、Agent 首次开场）
    ├── conversation/                     # Composer.tsx / ConversationTimeline.tsx / OutboundReviewDialog.tsx / OutboundReviewDialog.browser-test.mjs
    ├── evidence/EvidenceInspector.tsx    # 右侧按需证据详情抽屉（full_text / snippet / stale / unreadable 分级）
    ├── opinions/OpinionInlineCard.tsx    # 行内结构化观点卡（依据、反例、不确定性、反馈按钮）
    ├── memory/HistorySearch.tsx          # 历史记忆与证据检索弹窗（支持引用插入草稿）
    ├── workspace/WorkspacePicker.tsx     # 工作区切换与子空间创建
    └── settings/
        ├── WorkspaceSettings.tsx         # 单工作区模型/搜索授权、目录暂停/恢复/撤销
        └── AppSettings.tsx               # 主题、动效暂停、Bridge 模式切换、StepFun Session Key、多搜索引擎配置（Tavily / 智谱 MCP / Bing / Serper）
```

---

## 3. 交接前已整理修复与仍需注意的 Windows 兼容项

### 3.1 已在本次交接中整理的工程项
1. **已补齐并清理 `package.json`**：
   - 将包名从模板默认 `react-example` 更新为 `hark-r1-frontend`。
   - 补全了源码实际引用的 `zod`（`^3.24.1`）与 `@tauri-apps/api`（`^2.0.0`）。
   - 移除了模板遗留但未在 `src/` 使用、且会导致 `vite@8` 产生 `esbuild` peer 冲突的冗余依赖。
   - 新增 `"test"` 脚本，并将 `"clean"` 脚本改为 Node 原生跨平台删除（兼容 Windows PowerShell / CMD）。
   - 生成了 `package-lock.json`。

### 3.2 Windows 端仍需注意的兼容项
1. **`src/features/conversation/OutboundReviewDialog.browser-test.mjs`**：第 8 行硬编码了 macOS Chrome 路径：
   ```js
   /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
   ```
   在 Windows 上运行该浏览器端测试前，需要改为读取 `process.env.CHROME_PATH` 或探测 Windows 默认路径（如 `C:\Program Files\Google\Chrome\Application\chrome.exe` / Edge `msedge.exe`）。
2. **`vite.config.ts` 的 `__dirname` 提示**：`vite build` 时提示未来版本推荐用 `import.meta.dirname` 替代 `__dirname`，当前可正常构建，后续可按需顺手替换。

### 3.3 交接前实测验证基线（2026-11-14）
- `npm install`：在 macOS Node `v22.23.2` / npm `12.0.2` 下无报错完成。
- `npm run lint`（`tsc --noEmit`）：**通过**（0 errors）。
- `npm test`（`parser.test.ts` + `schemas.test.ts` + `native-adapter.test.ts`）：**50/50 全部通过**。
- `npm run build`（`vite build`）：**通过**（产出 `dist/`，未入库）。

---

## 4. Windows 本地启动与验证步骤

### 前置环境
- **Node.js >= 22.13**（推荐 22 LTS，用于原生 `--experimental-strip-types` 运行 `node:test`）
- **npm**（已附带 `package-lock.json`）或 **pnpm**
- 若需联合调试桌面端：Rust 工具链 + MSVC Build Tools + WebView2（Tauri 2 Windows 要求）

### 初始化与预览运行（PowerShell / Git Bash）
```powershell
# 0. 在 Windows 拉取 R1 前端分支
git clone -b r1-frontend https://github.com/EchoTouch-moon/hark.git hark-r1-frontend
cd hark-r1-frontend

# 1. 安装依赖（按 package-lock.json 锁定版本）
npm ci

# 2. 复制环境变量模板（纯前端预览/DevPreview 可不填 GEMINI_API_KEY）
Copy-Item .env.example .env

# 3. 类型检查、单测与构建验证
npm run lint
npm test
npm run build

# 4. 启动前端开发服务器（默认 http://localhost:3000）
npm run dev
```

> **浏览器预览提示**：启动 `npm run dev` 后，页面默认使用 `strict_tauri_ipc` 模式并提示「未检测到 Tauri 宿主」。如需纯浏览器体验 UI 与完整交互流，点击右上角菜单 →「应用设置」→ 将运行模式切换为 **Dev Preview（合成预览）** 即可。

---

## 5. 与 Tauri 2 Rust Core 对接的 IPC 契约清单

`src/bridge/native-adapter.ts` 已对后端定义了完整 Tauri Command 映射，在 Windows 上集成 Tauri 宿主或联调 Rust Core 时需核对以下接口：

- **应用与运行态**：`shell_snapshot`、`get_runtime`（经 `shell_snapshot`）、`hide_window`、`quit_app`、事件通道 `hark://app-event`
- **目录与导入**：`list_roots`、`pick_directory`、`authorize_picked`、`scan_root`、`confirm_import`、`pause_directory`、`resume_directory`、`revoke_directory`
- **工作区与权限**：`list_workspaces`、`get_workspace`、`workspace_overview`、`service_grants`、`set_model_grant`、`set_search_grant`、`set_observer_paused`、`observe_workspace`
- **初读与开场**：`onboarding`、`selective_key_read`、`commit_local_scan_card`、`start_configured_opening`
- **对话与流式对账**：`start_agent_turn`（带 Tauri `Channel<RunStreamEvent>`）、`get_agent_turn`、`get_agent_turn_by_request`、`cancel_agent_turn`、`list_conversation`
- **外发审阅**：`get_outbound_review`、`decide_outbound_review`
- **观点、记忆与证据**：`get_opinion`、`list_workspace_opinions`、`submit_opinion_feedback`、`revert_memory_operation`、`list_memory_receipts`、`list_source_refs`、`get_source_ref`、`get_message_evidence`、`search_workspace_memory`
- **叙事与提醒**：`get_narrative_state`、`dismiss_attention_item`
- **模型与搜索配置**：`configure_stepfun_session`、`clear_stepfun_session`、`stepfun_session_status`、`get_search_config`、`save_search_config`

---

## 6. Windows 平台专项待完成工作（建议下一步）

1. **完善浏览器测试脚本跨平台适配**：将 `src/features/conversation/OutboundReviewDialog.browser-test.mjs` 中的 macOS Chrome 固定路径改为支持 Windows Chrome/Edge 或 `CHROME_PATH` 环境变量。
2. **Windows Tauri 宿主联调**：将本前端接入 Tauri 2 `src-tauri`（确认 `tauri.conf.json` 的 `frontendDist` 指向 `dist`、`devUrl` 指向 `http://localhost:3000`）。
3. **Windows 路径与选择器适配**：
   - 检查 `FolderOnboarding.tsx` 中 `PRESET_PATHS`（当前为 `~/projects/...` Unix 样例路径）与后端返回 Windows 盘符路径（`C:\Users\...`）时的截断、显示与等宽字体渲染。
   - 验证 `pick_directory` 系统文件夹选择器在 Windows 原生弹窗中的焦点恢复。
4. **Windows UI / WebView2 验收（对应 PRD §11.2–11.4）**：
   - 在 `1440×900`、`1280×800`、`1024×768` 及 Windows 125%/150% DPI 缩放下核验布局与中文字体回退（`微软雅黑` / `PingFang SC` 回退链）。
   - 验证 WebView2 下 `FlameAtmosphere`（Canvas + 模糊层）、`<dialog>.showModal()`（`OutboundReviewDialog`）及自定义滚动条视觉。
   - 核验 Windows 系统托盘最小化（`hide_window`）、通知点击唤起主窗口及完全退出（`quit_app`）不留残留进程。
5. **端到端五条用户旅程真机验证**：完成 PRD §11.3 的 Journey 1–5（首次认识、长期对话、多 Workspace 隔离、故障降级、桌面生命周期）并留存截图与测试记录。
