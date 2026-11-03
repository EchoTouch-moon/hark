# Hearth Style Bible · 对话主壳（2026-10-29）

**Verdict for 总工:** pass-with-notes  
**Scope:** 产品 ready 切（对话为主、信息流不进默认主屏）；非后端能力扩展。  
**Convention:** 打破「仪表盘 Home + 并列导航」网页惯例；保留暖纸 editorial 令牌与克制动效（Rams / Swiss / Braun→Ive）。

## 1. 信息架构（必须改结构，不是换色）

| 层级 | 内容 | 路由 |
|---|---|---|
| 主壳 | 对话（默认落地） | `/` → Chat 主壳（现 `/chat` 升格） |
| 一级侧栏 | 对话 · 项目 · 设置 | `/` `/projects` `/settings` |
| 次级（「更多」折叠） | 洞察 · 活动 · 建议卡（旧 Demo Home） | `/insights` `/activity` `/cards`（旧 `/` 迁此，或 label「建议」） |
| 对话内侧证 | Evidence / Run Trace | 右侧 Drawer（≥1440）或窄屏 Sheet；由对话摘要卡触发，不单独当首页 |

**禁止：** 默认打开并列展示 ≥3 张 ActionCard 信息流；Insights/Activity 与对话并列同等权重。

## 2. 主屏流程（一屏说清）

```
开应用
  → 对话主壳（全宽消息区 + 底栏输入）
  → 空态：一句问候 + 建议 chip「现在该关注什么？」+ 次要「登记项目」
  → 用户发问
  → Agent 回复 = 摘要正文（可含 1–3 条紧凑结论行）
       └ 可选「查看证据 / 打开项目」链出 Drawer 或次级页
  → Mock 时顶栏常驻 ConnectionBadge：「离线演示 · 不连接模型」
```

成功路径对齐产品：新用户 3 步内问出「现在该关注什么」并得到基于本机事实的摘要（Mock 须标明）。

## 3. 令牌（沿用 `tokens.css`，本轮不换肤）

- 色：暖纸 bg `#f6f4ef` / ink `#26221c` / accent 炭火 `#9c4b26`
- 字：sans 系统栈正文 14；serif 仅品牌名；mono 证据 URI
- 间距：4 基；消息气泡纵向 `--space-3`；输入区上下 `--space-4`
- 圆角：`--radius-sm/md/lg`（10/12/16）
- 动效：仅 opacity/transform，160–220ms `--ease-out`；`prefers-reduced-motion` 关闭

## 4. 组件规格（给前端）

### AgentShell（替换现 AppShell 默认重心）
- 左栏缩为 200–220px（可保留 `--nav-width` 调到 220）
- 主列：对话占满；去掉 Home 式 PageHeader 大标题堆叠，改为细顶栏：工作区名 + ConnectionBadge
- 右 Drawer：仅在用户点「证据/步骤」时出现；空闲不占位（窄于 1440 用底部 Sheet）

### Nav
- 默认三项：对话（active 态 inset accent）、项目、设置
- 「更多」展开：洞察、活动、建议（旧卡片流）— 视觉权重弱一级（`--color-ink-3`）
- 去掉「Demo Home」「Chat · Mock」字样进标签；Mock 状态只走 Badge

### ChatTranscript
- 用户泡：右对齐，`--color-accent-soft` 底
- Agent 泡：左对齐，`--color-surface` + 轻边；角色行「Hearth」+ 时间；Mock 时角色行缀「· Mock」
- 摘要内嵌 **ConclusionRow**：标题一行 + why_now 一行（`--text-sm` ink-2）+ 文字按钮「证据」；**不是** Home ActionCard 整卡搬进对话
- 输入：底栏 sticky，textarea 2 行起，Enter 发送；发送按钮用 accent 实心

### EmptyState（对话）
- 标题：不说「开始一段对话」空壳话，改「问我现在该关注什么」
- hint：登记项目 CTA（链 `/projects`）
- 可选 2–3 chip 快捷提问（本轮 Should）

### 旧 Home / Insights
- 不删实现；降为次级路由；入口不在默认主屏
- 卡片流页面标题标明「建议（次级）」避免双入口误解

## 5. 状态

| 状态 | UI |
|---|---|
| Mock | Badge 常驻；不伪装在线模型 |
| 发送中 | 输入禁用 +「发送中…」；禁止永转圈 |
| API 断 | ErrorState + 重试；不假装有摘要 |
| 无项目 | 空态引导登记；摘要可诚实说「尚无授权项目」 |
| 外发确认 | 沿用既有预览确认，对话内触发同样 Sheet |

## 6. 动效与无障碍

- 新消息：fade+translateY 8px，`--duration-fast`
- 焦点环 `--color-focus`；H1 仍在对话顶栏（可 visually 紧凑）
- 对比度：沿用 ink/表面组合，不引入浅灰字踩线

## 7. 前端落地顺序（建议）

1. 路由：`/` → ChatPage；旧 Home → `/cards`（或 `/home`）
2. NavRail 重排 +「更多」
3. Chat 空态/顶栏/ConclusionRow
4. Drawer 从对话链入证据（复用 EvidenceDrawer）
5. 视觉回归：1280 与 1440 各一帧对话空态与有摘要态

## Notes（pass-with-notes）

1. Chat 仍 Mock：主壳视觉必须诚实标 Mock，避免「换壳即智能」错觉。  
2. 双入口风险：旧 Home 必须改路径+降权，不能只藏 CSS。  
3. 本 Bible 不改观察器/分析管线；摘要内容合同属后端，缺口时再叫后端。
