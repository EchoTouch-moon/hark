# Hearth Style Bible v7 · 叙事状态驱动火焰（2026-10-31）

**基线：** G0 `bot/hearth-g0-contract@eca1224`（05 §3 HearthViewModel）。继承 v6 Ember Seed，下文只写变化与补全。
**Convention：** 保留 Web 聊天惯例（对话为主角、底部 Composer、右侧抽屉）；打破「火焰=活跃度计数」与仪表盘化——火焰只是气氛，屏幕上不出现百分比/分数。

## 0. 红线
- 火焰**只读** `narrative.flame`；消息数、卡片数、完成数不得参与。删除 `emberHeat.ts` / `projectEmber.ts` 计数规则。
- 不显示任何百分比、分数、进度条；`evidenceCount` 只作文字「N 条依据」，不画条。
- 「添柴」交互删除（入口、动效、文案全部移除）。
- `mode:'real'` 失败 → 显式错误态，绝不静默换 Mock/fixture。
- `permissions.execute` 恒 `false`：界面只显示为锁定行，不给开关。
- 继承 v6：`--ember-heat` 0–1 插值；CSS+WebGL 分层火焰；热度过渡 500ms `cubic-bezier(.22,1,.36,1)`；Composer 360ms 临界阻尼 spring（bounce 0）；reduced-motion 停闪烁；空线程 Seed 居中，首条用户消息后落底。

## 1. 火焰：FlameLevel → 视觉

| `flame.level` | `--ember-heat` | outer | inner | coal | aura | flicker 振幅 | 页面色调 | 含义（不上屏） |
|---|---|---|---|---|---|---|---|---|
| `neutral` | **0.10** | 0 | 0 | 0.25 | 0.10 | 0（静） | 中性暖灰纸 `#F2EFEA` | 无项目 / 全局，不评判 |
| `ember` | **0.30** | 0.20 | 0.10 | 0.70 | 0.25 | 0.02 | 偏冷暗 `#EDE6DC` | 项目搁置、余烬尚在 |
| `warm` | **0.60** | 0.55 | 0.45 | 0.60 | 0.50 | 0.05 | v6 暖奶油 `#F7F0E6` | 项目稳定推进 |
| `bright` | **0.90** | 0.90 | 0.85 | 0.50 | 0.80 | 0.09 | 暖橙亮 `#FBEBD8` | 刚有实质推进 / 新判断 |

- 层参数均 0–1 乘子，作用于 PR #5 `EmberAtmosphere` 各层 opacity/scale；flicker 振幅 = 噪声位移占火焰高度比例。
- `milestoneGold:true`：coal 与 aura 叠金 `#E8B24A`（仅色相，不加强度），一次性 1.2s 金光扫过，之后保持金边余烬。
- `flame.reason`：仅在悬停/聚焦火焰 600ms 后以 tooltip 显示（中文短句），不常驻。
- **过渡：** 任意两档之间直接插值 `--ember-heat`，500ms `cubic-bezier(.22,1,.36,1)`；跨 ≥2 档（如 ember→bright）延长到 800ms 同曲线，不经中间档停顿。降档同速，不做"熄灭"动画。
- **reduced-motion：** flicker=0、无金光扫过，颜色仍按档切换（200ms 线性）。
- 非 ok 状态的火焰见 §6。

## 2. Seed 布局（无添柴）
- 空线程：顶栏（聊天｜项目）→ 视口中心火焰 widget（160px）→ 下方 24px 衬线问候一句 → Composer 居中（max-width 640）→ 2–3 个入口 chip。
- 原「添柴」按钮位置不补任何控件；火焰不可点击（仅聚焦显示 reason）。
- 首条用户消息发出 → Composer 360ms spring 落底；火焰缩为顶栏左侧 20px 标记，同步插值。
- 问候文案按 level：neutral「从哪儿开始？」/ ember「余烬还在。」/ warm「炉还温着。」/ bright「火正旺。」

## 3. 观点卡（featuredOpinion）
**折叠态（对话流内，最多 1 张）：**
1. 判断行 `opinion`：17px/600，最多 2 行。
2. 一句为什么 `whyNow`：14px/400 次级色，1 行截断。
3. 元信息：「N 条依据」+ 若 `uncertainties` 非空显示「有 N 处不确定」，13px，无图标条。
4. 三个动作（文字按钮，左对齐）：**查看依据**（主，accent）/ **讨论计划** / **稍后再说**（次级色）。
- 卡片：暖纸白底、1px `--line`、圆角 14、左侧 3px 余烬色竖线（色随 `--ember-heat`）。

**展开 Editorial 视图（查看依据 → 右侧抽屉 520px，移动端全屏）：** 分节标题 13px 字距 .08em：
- **判断**：`opinion` 全文 + `whyNow`。
- **证据**：EvidenceLabel 列表（见下）。
- **反例**：`uncertainties` 逐条，前缀「—」，斜体次级色。
- **历史版本**：按 `revisionId` 列出（需后端字段，见末尾歧义）。
- **计划**：「讨论计划」入口，点击把观点引用插入 Composer，不自动执行。

**EvidenceLabel `{id, kind, label}`**（kind ∈ observer | research | decision）一行一条，三种区分：
| kind | 标记 | 色 | 文案前缀 |
|---|---|---|---|
| `observer` | 实心圆点 ● 6px | 余烬橙 `#D9773A` | 观察 |
| `research` | 空心方块 □ 6px | 薄蓝 `#5B7FA6` | 研究 |
| `decision` | 菱形 ◆ 6px | 墨色 `#3A3330` | 决定 |
形状+前缀双编码，不只靠颜色（色弱可辨）。`label` 14px 单行截断，悬停显示全文。

**稍后再说：** 卡片 280ms 缩成对话流右侧 12px 余烬标记（无文字），标记不可操作，aria-label「已搁置的观点」。新一条 `revisionId` 到达（有新证据）→ 标记 400ms 亮起并展开回卡片；否则保持暗。
**主动出现/收起：** 出现 = 自 Composer 上方 8px 位移 + 透明度，320ms `cubic-bezier(.22,1,.36,1)`；收起反向 220ms。用户输入中（Composer 有焦点且有内容）**不出现**，排队到失焦/发送后 1.5s；同时只存在 1 张。reduced-motion：仅透明度 150ms。

## 4. 故事时间线抽屉
- 入口：顶栏火焰标记点击 → 右侧抽屉 420px。
- 纵向四种节点 `诞生/探索/推进/沉淀`，节点图形：诞生 ○、探索 ◌（虚线）、推进 ●、沉淀 ■；连线 1px `--line`。
- 每节点：kind 标签 + `at`（相对时间，悬停绝对时间 UTC+8）+ `summary` + **事实来源**：其 `evidence: EvidenceLabel[]` 按 §3 样式逐条列出；为空则显示「无事实来源」警示色——不得隐藏。
- 抽屉顶部显示当前 flame 档（文字名，不显数值），与 story 同源。

## 5. 权限与研究设置
设置 Sheet 两段：
**权限**：观察 `observe` / 研究 `research` / 模型 `model` 三个开关；**执行 `execute`** 为锁定行「执行：关闭（本版本不提供）」，无开关。关闭任一项即时生效，Toast「已关闭 X」。
**研究清单（05 §4，Should）**：每行：主题 · 边界 · 允许来源 · 频率 · 预算「已用 X / 上限 Y」（纯文字，不画条）· 到期时间 · 最近一次检查（时间 + 结果：有新资料 / 无变化 / BLOCKED，BLOCKED 用警示色）。行尾：暂停（切换为「恢复」）· 删除（二次确认「删除即撤销研究授权」）。`research=false` 时整表灰显并提示去开权限。空清单：一句「还没有研究主题」，不放插画。

## 6. 状态矩阵
屏：A 对话/Seed · B 观点卡/Editorial · C 时间线抽屉 · D 权限与研究设置。

| 状态 | A | B | C | D |
|---|---|---|---|---|
| ok | 按 §1–2 | 按 §3 | 按 §4 | 按 §5 |
| empty（无项目，neutral） | Seed 居中，neutral 火焰 | 不出现 | 「项目开始后这里会有故事」 | 正常显示权限；清单空态 |
| error | 火焰冻结为 coal 0.2、flicker 0、去饱和；Composer 上方错误条：`error.message` + 「重试」+ `code` 小字；**不显示任何旧/Mock 数据** | 不出现；已展开抽屉替换为同错误块 | 同错误块 | 同错误块，开关禁用 |
| permission_denied | 火焰正常按 level；顶部一行提示「未授权观察/研究，部分内容不可用」+「去设置」 | 依赖被拒权限的卡不出现 | 被拒来源的 evidence 显示「需授权」占位 | 被拒项开关高亮描边引导 |
| stale（`observationFreshness:'stale'`） | 火焰正常；顶栏火焰旁 6px 灰点，tooltip「观察已过期，最近更新于…」 | 卡片元信息加「依据可能过期」 | 抽屉顶部同提示 | 观察行显示过期时间 |

- 其他 freshness：`gap`/`unknown` 同 stale 文案变体；`disabled` 同 permission_denied；`unavailable` 同 error 文案但不阻断对话。
- **Demo 徽标：** `mode:'demo'` 时顶栏右侧常驻胶囊「演示数据」（12px，`#3A3330` 底白字，不可关闭），所有抽屉标题旁重复一次。real 模式不出现。

## 7. Tokens 增量（相对 v6）
| 类 | 新增/变更 |
|---|---|
| 色 | `--tone-neutral #F2EFEA`、`--tone-ember #EDE6DC`、`--tone-warm #F7F0E6`(v6)、`--tone-bright #FBEBD8`；`--gold #E8B24A`；`--ev-observer #D9773A`、`--ev-research #5B7FA6`、`--ev-decision #3A3330`；`--danger #B2452F` |
| 字 | 判断行 17/600；分节标题 13/600 字距 .08em；元信息 13/400；demo 徽标 12/600 |
| 距 | 卡片内边距 16/20；抽屉 520（Editorial）/420（时间线）；节点间距 20 |
| 动 | 卡片出现 320ms / 收起 220ms / 搁置 280ms / 复燃 400ms；跨档 800ms；金光 1.2s；其余沿用 v6 |
| 删 | 添柴相关 token 与动效；任何计数→heat 映射 |

## 8. 前端检查单
- [ ] 删 `emberHeat.ts`、`projectEmber.ts` 计数逻辑；heat 只由 `narrative.flame.level` 查表
- [ ] 四档 heat 0.10/0.30/0.60/0.90 + 层参数按 §1
- [ ] 无百分比/分数/进度条；无添柴
- [ ] 五份 fixture 各截 A–D 四屏，对照 §6
- [ ] error 态无任何 Mock 回退；demo 徽标常驻
- [ ] execute 只读锁定行
- [ ] 观点卡最多 1 张、输入中不出现；EvidenceLabel 三 kind 形状+色区分
- [ ] reduced-motion：无闪烁、无位移

## 9. E1 评审锁定规则（2026-10-31，优先于上文冲突条目）

### 9.1 观点卡证据
- `FeaturedOpinion.evidence: EvidenceLabel[]`，`EvidenceLabel = {id, kind: 'observer'|'research'|'decision', label}`；不再有 `evidenceCount`，显示的证据数 = `evidence.length`。
- 标记：observer 实心 ember 圆点；research 空心淡蓝方块；decision 墨色菱形。标记色只上标记本身，文字永不着色。

### 9.2 历史版本
- `GET /opinions/:revisionId/history`，展开时懒加载。
- 加载中 = 骨架行；失败 = 仅该节内局部报错 +「重试」，不影响卡片其余部分。

### 9.3 研究清单（Should，不在 E1）
- `/research/watchlist` 在设置页独立成块，自带 loading / error 态。

### 9.4 稍后再说
- 前端只看 `featuredOpinion`：非空即显示卡片，为空即不显示；是否再次出现由服务端决定。
- 单独的 `revisionId` 变化不是信号（撤回原歧义 6 的提法）。

### 9.5 火焰标签按状态
| 状态 | 标签 | 视觉 | 操作 |
|---|---|---|---|
| ok | 档位名（如 温火 / 旺火） | 按档位 | — |
| empty | 尚未点火 | neutral 0.10，不去饱和 | 主按钮「添加项目」 |
| error | 火候未知 | 0.10 去饱和，无过渡 | 仅「重新读取」（只重读 ViewModel） |
| permission-denied | 未授权读取 | 0.10 去饱和，无过渡 | 「重新扫描」禁用（40% 不透明 + aria-disabled）+「去授权」链接 |
| stale | 保留上次档位名 + 后缀「· 旧观测」 | 保持上次档位 | — |

- error / permission-denied / empty 永不显示「静火」。
- 全局范围 stale：reason 必须写明是哪个项目的观测过期。

### 9.6 重新扫描
- 次级 13px 文字按钮，位于 Seed 下方，永不放在火焰旁。
- M1 只读观察接口上线前不调用任何 API。

### 9.7 flame.reason 与遮罩带
- reason 为可见行，居中紧贴 hero 标题下方，13px #5A514B，间距 8px；stale 提示放在 reason 下方。
- 遮罩带：标题顶部 → reason 底部 +12px；带内火焰不透明度 ≤0.15，上下各 24px 羽化；所有状态下 reason 对比度 ≥4.5:1。

### 9.8 火焰纵向范围
- 止于观点卡底边；无卡片时止于「重新扫描」底部 +24px 或时间线顶部，取更高者。
- 末端 56px 渐隐；火焰永不进入时间线。

### 9.9 观点卡样式
- 不透明底 #FFFDF9；标题 --ink 700；正文 / why-now #5A514B；左边框 --line-strong（不用 accent）。
- 「查看依据」链接 #A8501C 700。

### 9.10 色彩与时间线节点
- Accent #D9773A 只用于火焰和证据标记。
- 时间线节点 #A8501C 9px：实心 = 填充；空心 = `box-shadow: inset 0 0 0 1.5px #A8501C`（不用 border）。

### 9.11 按钮
- 「发送」：--ink 底、paper 字；草稿为空时 0.4 不透明 + aria-disabled，仍可聚焦。
- 文字按钮：次级文字 #24201E（≥4.5:1），13px，hover 下划线，2px 焦点环。

### 9.12 模式
- 仅日间（paper）模式；独立夜间规范出来之前不做夜间叠层。

## 合同歧义（交 产品/后端）
1. `status` 枚举无 `stale`；本文用 `observationFreshness:'stale'` 表达过期态（与 stale.json 一致）。
2. 05 §3 写的是 `EvidenceRef`；按产品更正统一为 `EvidenceLabel {id,kind,label}`，需改合同文本。
3. 已定：去掉 `evidenceCount`，改为 `evidence: EvidenceLabel[]`，见 §9.1。
4. 已定：历史版本走 `GET /opinions/:revisionId/history` 懒加载，见 §9.2。
5. 已定：研究清单走 `/research/watchlist`，设置页独立块（Should），见 §9.3。
6. 撤回：不用 `revisionId` 变化判断复燃；由服务端决定，前端只看 `featuredOpinion` 是否非空，见 §9.4。
