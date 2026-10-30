# Actual implementation decisions

> Agent 修改技术决策时，记录时间、任务、原计划、变更原因、对 Gate 的影响、引用测试/日志。规划合同不能静默更改。

| timestamp | task | decision | reason | consequence | evidence |
|---|---|---|---|---|---|
| 2026-10-28T03:15Z | M0-T01 | zod 固定 3.24.1（不用 ^3.25） | npm 镜像上的 zod@3.25.0 tarball 缺 dist/（损坏包），vite/node 均无法解析入口 | 无合同影响；API 为 v3 稳定面 | pnpm install 日志（handoff 会话记录）；contracts 32 tests |
| 2026-10-28T03:15Z | M0-T01 | SQLite 用 Node 22 内置 node:sqlite（DatabaseSync），不用 better-sqlite3 | 零原生依赖、零编译风险；WAL/busy_timeout/FK 均支持；experimental 警告可接受 | ADR-001；storage 13 tests 全过 | packages/storage/src/migrations.ts |
| 2026-10-28T03:20Z | M0-T02 | sha256/canonical 用纯 TS 实现于 contracts 包 | contracts 会被浏览器 bundle 引用，禁 node:crypto | 需对照 node:crypto 向量测试（已做，全过） | contracts.test.ts「sha256 matches node:crypto vectors」 |
| 2026-10-28T03:30Z | M0-T04 | ActionCard 合同无 cancelled 状态：run 取消后 card 回到 proposed | docs/04 CardStatus 枚举确实没有 cancelled；写 cancelled 会让 getCard 的 Zod 解析抛错（500） | orchestrator.cancel/updateCard 改为 proposed；重新执行受幂等键约束返回原 run | orchestrator 源码 + server cancel 测试 |
| 2026-10-28T03:45Z | M1-T03 | executeCard 默认异步推进（fire-and-forget pipeline），支持 awaitCompletion 供测试/E2E | UI 需要立即返回 run id 做进度展示；测试需要确定性终态 | API ?sync=1 参数；pipeline 异常全部写 audit | runs.ts 路由 + orchestrator |
| 2026-10-28T04:05Z | M1-T01 | 会话：单 principal；GET /auth/session 下发 HttpOnly SameSite=Strict cookie + csrfToken；写请求要求 Origin+x-csrf-token 双校验；无 Origin 的裸写一律 403 | docs/04 要求即使 localhost 也不能免 CSRF；浏览器 fetch 对 POST 恒带 Origin，curl 需显式 -H Origin | E2E/API 测试全部带 Origin；安全负例 4 条 | app.test.ts auth&boundary 8 tests |
| 2026-10-28T04:30Z | M1-T01 | auth preHandler 只守卫 /api/v1/*（静态页与 SPA fallback 公开） | 原 hook 对 '/' 也 401，页面无法加载 | 无安全弱化：数据面全在 /api/v1 | app.ts + E2E-11 |
| 2026-10-28T04:40Z | M1-T05 | client 任意 401（含 GET）都会重建会话并重试一次 | 首次加载时 GET /cards 先于会话建立，旧逻辑只救写请求 | 一次额外重试，无循环 | client.ts + E2E |
| 2026-10-28T05:05Z | M2-T02 | 用户显式触发的 POST /discover 绕过静默时段延迟（预算仍生效）；仅后台扫描受静默限制 | 集成 E2E 时发现凌晨运行被 quiet hours 拦住建卡——静默规则应约束“主动打扰”，不应挡用户明确指令 | discovery.discover({userInitiated}) 参数；API 层传 true | ADR-006；discovery 集成测试 + E2E-01 |
| 2026-10-28T05:10Z | M1-T09 | E2E 拓扑：Fastify 直接伺服 apps/web/dist（同源），不另起 vite preview | 消除跨源 cookie/CSRF 变量；与生产形态一致 | E2E 配置绝对路径 DB/静态目录（曾因相对路径落到 apps/server/data 造成跨 run 残留——已修并清理） | playwright.config.ts |
| 2026-10-28T05:15Z | M1-T09 | E2E-05/09/10 在 API/单元层断言，浏览器层不构造非法状态 | 过期卡/伪造 verifier/L2 篡改无法从 UI 诚实地制造；在服务端注入状态更真实 | 用例映射表写明覆盖层级 | m1-t09-e2e.txt |
| 2026-10-28T05:20Z | M1-T08 | SSE 端点已实现（/runs/:id/stream），但 UI 用 900ms 轮询消费 | 轮询实现更简单稳健（重连即最新快照），SSE 留给后续增强 | 无验收影响（docs 允许 polling fallback） | runs.ts + ActivityPage |
| 2026-10-28T17:30Z | Observer-P0 | 规格中的四包合并为 `@hearth/project-observer`；独立 `observer.sqlite`；观察详情走 `/observe/:id` | 保留既有 Hearth events/projects 合同与 E2E；观察器可脱离 HTTP 测试 | 无 API Key、无 Docker；UI 不把 UNKNOWN 画成绿色成功 | docs/14-PROJECT-OBSERVER.md |
| 2026-10-28T17:46Z | Observer-P0 | 扫描事务内不再 prune 仍被 events 引用的 runs；相同 fingerprint 不再重复 ADAPTER_ERROR；STALE 仅在 HEAD 变化时计算；git 沙箱去掉 HOME 全局配置与 fsmonitor | 审查复现持续运行 FK 失败与误标 STALE | T01–T16 仍绿；增加 filter 负例 | observer.p0.test.ts |
| 2026-10-30T03:00Z | Flame-Lifecycle | 建立 Project Ember 生命态计算模型与 Point-Sprite 火星粒子系统 | 用户希望将火焰赋予生命，让整个项目跟着火焰状态走（刚创立为火星、聊天推进为火苗与大火焰、完成为常明金火、搁置为静卧余烬、扫描为添柴散发火星） | 既保留克制的磨砂炉火美学，又将离散的项目工程状态具象为生生不息的活火世界 | `apps/web/src/features/projectEmber.ts`、`flameRenderer.ts`、`living-flame-lifecycle.mjs` |
| 2026-10-30T05:30Z | GSAP-Motion-Overhaul | 建立 GSAP 核心时间线分层拓扑与物理缓动引擎，全面替代 CSS 关键帧 | 用户要求使用 GSAP 重构动效，Teamwork 子代理分工出具完整叙事动效规范文档并执行重构 | 采用 GSAP 3.12+ 物理动力学（`apps/web/src/motion/`）驱动 WebGL uniforms 与 DOM；引入销毁门闩与 `useHearthTimeline`，彻底杜绝 React 18 孤儿补间与内存泄漏 | `docs/MOTION-SPECIFICATION.md`、`apps/web/src/motion/`、`tests/unit/ember-motion.test.ts`、`tests/unit/adversarial-lifecycle.test.ts` |
| 2026-10-30T07:30Z | G1-A-Frontend | 模式失败关闭、离线 Mock 标识真实可见与取消本地虚假回退 | 修复 G1-A 真实安全基线：真实/未知/破损模式下直接访问 /demo 严格失败关闭；修复 CSS 导致离线标识 hidden 的 bug；彻底清除前端本地 fake proactive/progress/result/seed 回退；后端拒绝旧 action 时展示错误且保留草稿 | 离线演示完全透明可信，未连接真实模型，对旧 action 403 诚实报错且不丢草稿 | `tests/e2e/runtime-mode.spec.ts`、`handoff/EVIDENCE/g1a-frontend/` |
| 2026-10-30T08:35Z | G1-A-Review-Fixes | 根除本地 parts 回灌、消除假进度、全直接入口门禁、线程服务异常展示与标识范围明确 | 评审复现 5 项问题：1. 旧 parts 回填历史导致可点击旧操作且短暂伪造进度；2. `/cards` 绕过门禁，且 `demoMode: false && legacyDemoAvailable: true` 异常挂载；3. 线程 503 异常被伪造成空历史；4. 离线标识出现在非对话页面误导真实 Pi 分析；5. 夜间测试未注入真实夜间时间、主动空态未等稳定 | 1. 彻底移除 `attachStoredParts`，服务端消息为唯一权威，启动清理脏数据，执行时零乐观步骤；2. `/cards` 移入 `DemoGate`，严格双重校验 `demoMode` 与 `legacyDemoAvailable`；3. 线程服务错误渲染错误警告与重试按钮；4. 标识限定为「当前对话为 Mock · 离线演示」，非对话页面不展示；5. 使用 `setSystemTime` 注入 22:00 真实夜间时间，断言实际执行接口与 403 状态 | `tests/e2e/runtime-mode.spec.ts` 7/7 PASS、`handoff/EVIDENCE/g1a-frontend/` |
| 2026-10-30T09:05Z | G1-A-Review-R2-Fixes | 保留全部本地数据不强制删除、固定测试时区、主对话区呈现线程错误、精准区分 403 职责 | 针对审查意见：1. 彻底禁用对 localStorage 消息与 parts 的写回删除（包括 `preferLiveApi` 触发的 `clearStaleMockOverlay`），保留全部历史数据（含普通记录与 `mock-result-*` 等旧模拟记录）；2. 昼夜测试固定 `Asia/Shanghai` 时区，并在 `TZ=UTC` 环境下全绿验证；3. 首次加载线程 503 失败时在主对话区直接显示错误与重试入口；4. 准确表述 403 为前端契约模拟，与后端独立 HTTP 测试分别标明 | 1. `clearStaleMockOverlay` 改为 no-op，移除 `PROACTIVE_INJECT_PREFIX` 删除，读取与展示层过滤旧模拟内容，E2E 增加服务成功与刷新后逐项内容比对（`toEqual`）；2. Playwright 配置与用例显式注入上海时区；3. 主界面增设 `.chat-thread-error` 组件；4. 文档准确厘清前后端测试边界 | `tests/e2e/runtime-mode.spec.ts` 7/7 PASS (TZ=UTC)、`handoff/EVIDENCE/g1a-frontend/` |


## 2026-10-29 · P2-A live provider

用户明确选定 stepfun-plan/step-5-preview。该 Provider 由已安装 StepFun 扩展注册；全部禁扩展会令其不可用。保留 --no-extensions，新增显式 HEARTH_PI_PROVIDER_EXTENSION，仅加载经审阅的 Provider 注册代码；不启用自动发现或其他扩展。模型身份必须显式指定并记入 Run。CLI 用 text 模式接收最终结构化文本，补充嵌套字段合同；真实错误不回退 Mock、不保存原始 stderr。默认服务仍为 Mock，真实验证使用独立 DB，未修改全局 Pi/Hermes 配置。

## 2026-10-29 · GitHub 代码同步

用户明确授权推送 GitHub，用于多端同步，覆盖此前默认不推送的任务边界。当前 GitHub 登录账号 EchoTouch-moon，无既有 hark/hearth 远端；目标为新建私有 EchoTouch-moon/hark，保留现有 master 分支与历史。纳入已有源码/测试/验收文档改动；缓存与编辑器配置加入忽略规则，未跟踪截图保留本地。数据库、凭证和本机注册路径不作为运行状态同步。

## 2026-10-29 · R0整改

Analysis中断复用failed+INTERRUPTED，保留旧Run且不自动重试模型。跨库清理采用analysis schema v2持久化删除日志和幂等补偿；不声称跨库原子。显式目标Insight进入优先上下文。上下文文件hash改为有界捕获前缀，完整大小和截断保留。每日模型预算定义为请求数（默认20），不是货币。非loopback暂不开放。保留默认Mock及用户触发模型原则。

## 2026-10-29 · R1/R2边界与用户质量评价

单一后台协调器只用ObserverReadPort+InsightStore，绝不获得Provider依赖。R2外发每次预览确认绑定稳定内容指纹和接收方，schema v3记录排除路径、v4记录发送确认。默认真实模式不自动混入Demo；Chat仍Mock。用户实际希望建议覆盖项目发展/演进，不能只提供本地检查清单；原样保存定性反馈，不假造逐项评分。仅调整中文/方向提示，不扩大代码采集，不跳至P2-B/C。真实评价基线不足时保持NOT_MEASURED。

## UI-REFRESH-01 · 分块执行

用户要求节省额度与可接班，本轮只交付主题基础+空详情隐藏，不把导航/路由/后端聚合混入同一块。显示偏好仅保存在设备localStorage；默认浅色，用户明确选择system后才跟随系统。未知服务端模式不应暴露Demo seed。完整计划与接班入口固定为tasks/UI-REFRESH-01.md。

## UI-REFRESH-01 · 模式与导航

今日首页的聚合后端尚未实现，真实根路由先复用现有InsightsPage，不制作假数据概览；旧Home移至/demo。服务端mode只读并校验，未知/失败时不挂载业务操作；本地偏好不能改变mode。观察记录入口随UI-02.3时间线交付后才加入主导航，避免死链接。旧Demo测试改路径并保留原断言语义。

## UI-REFRESH-01 · 布局与详情抽屉

1. 响应式导航：<1280px使用72px紧凑图标导航，全链接保留title与aria-label；>=1280px使用200px导航。
2. 主内容区域限制最大宽度1200px并宽屏水平居中，消除所有视口下的水平滚动。
3. 详情面板自适应三态：>=1600px为360px内联网格列；768~1599px为右侧覆盖式抽屉并伴随半透明遮罩；<768px为底部模态面板。空内容时不挂载任何DOM节点。
4. 无障碍交互：顶栏常驻说明触发器；抽屉打开时延迟将焦点移至关闭按钮，关闭（Esc、按钮、遮罩点击）时严格将焦点恢复给打开前的触发元素，防止键盘操作失焦。
5. E2E测试配置补充insights.sqlite.writer.lock清理，防止偶发异常退出的残余锁阻塞测试实例启动。

## UI-REFRESH-01 · 真实项目工作台与观察时间线

1. 首页工作台四大区域确定性渲染：今日概览叙事由模板生成，不调用模型；值得关注按严重度、时间与 ID 稳定排序，最多展示 3 条；普通 Git 变动属于记录，不包装为发现。
2. 聚合路由设计：新增只读 `GET /api/v1/overview?projectId=...`，包含有界拉取与各分区独立可用性状态（`AVAILABLE` / `DEGRADED` / `UNAVAILABLE`）。部分数据源异常时，保留成功区块，不返回 500。
3. 项目概况与筛选交互：聚合接口中 projects 列表始终返回全部已登记项目（包含各自最新状态与未处理洞察数），以便下拉框和概况卡片选择；`projectId` 筛选通过 `useSearchParams` 写入 URL `?projectId=...`，页面刷新及后退/前进均能正确恢复。
4. 观察时间线：新增 `/observations` 与全局 `GET /api/v1/observer/events`，主导航正式加入“观察记录”入口。
5. 活跃页面 3 秒只读无重叠轮询：使用 `isFetchingRef` 防重叠；在 `document.visibilityState === 'hidden'` 时暂停轮询，切回前台时通过 `visibilitychange` 立即触发一次更新；分页加载时保留已有列表不跳动。
6. SPA 静态文件路由健全性：修复服务端 SPA 兜底逻辑中当请求携带查询参数（如 `/?projectId=...`）时误将静态根目录当做普通文件用 `fsReadFile` 读取导致 EISDIR 500 错误的问题，增加目录检测与空路径规范化。
7. 测试结果映射：测试报告中包含失败用例时的 `MIXED` 状态统一归入测试失败（`FAILED`），避免在项目卡片中显示为未知。
8. 2026-10-29 用户明确授权将独立分支 `codex/ui-refresh-01` 推送至 GitHub（`origin/codex/ui-refresh-01`，HEAD: `c18faa1`），供用户审查与查看远端 CI 状态；不自动合并 master。

## UI-03 · Phase 1 产品视觉识别与体验重设计

1. 探索策略：严格遵守「不直接重写后端、不破坏数据合同与安全流程、未通过人工确认不全面替换现有前端」的红线；在 `prototypes/` 建立独立的高保真运行原型体系。
2. 差异化设计规范：禁止仅通过换色、圆角或阴影伪造不同方案。根据用户“更加有设计感、风格不拘一格、更为跳脱”的明确反馈，在保留原有 3 套方案的基础上拓展至 6 套全矩阵独立概念，在骨架栅格、信息架构与排版隐喻上实现根本性区分：
   - **Quiet Observatory**：开放式大天幕叙事 + 发丝瞄准十字焦点透镜 + 7:5 细线数据台账 + 垂直时间轴，去卡片化设计，极度克制舒适；
   - **Editorial Workspace**：经典报头与 3px 双排线 + 63:37 非对称社论专栏 + 首字下沉 (Drop-Cap) + 双排线引用警句 (Pull Quote) + 粗细相间学术考据证据板；
   - **Instrument Studio**：四角固定螺丝机架 + 沉降式示波器视窗 (内阴影物理倒角与波形模拟) + 双通道排插与十段式 LED VU 电平表 + 走带式事件步进器；
   - **Monolith Architect**：野兽派建筑切角 + 纯正 0px 锋利构造 + 48px/64px 雕塑大字阶 + 工业斜纹危险警示带 + 建筑剖面式项目详情；
   - **Kinetic Cartography**：极坐标同心圆动态雷达星盘 + 晒蓝工程毫米网格 + 偏航矢量拦截板 + 航天飞控蓝图时空航迹；
   - **Luminescent Gallery**：通透发光展柜与环境光晕 + 35mm 齿孔胶片卷轴式提交历史 + 摄影光圈与曝光指标 + 纯白立方艺术馆留白。
3. 证据化截图：使用 Playwright 在 1440px 真实视口下自动化渲染并生成全部 48 张完整页面截图（涵盖 6 套方案在首页/项目页、内容态/基线空态、浅色/深色主题下的全矩阵表现），归档至 `docs/design/screenshots/`。
4. Phase 2 实施门禁：已在 `docs/design/UI-03-CONCEPTS.md` 交付深度对比矩阵与实施路线图，待人工确认视觉方向后再正式开启生产端组件重构。

## 2026-10-29 对话优先首页
- 用户本次明确要求依参考图生成现有前端，作为此前视觉方向等待选择的后续授权。
- 作为现有核心闭环的交互改版：首页不再同时平铺指标、项目列表、事件流，只呈现一条重点事项。项目、发现、观察及审批流程保留原有入口。
- 山景与天文台为 CSS 装饰，不使用参考图整图作为页面。没有新增模型、自动后台处理或外部副作用权限。首页沿用实际本地聚合和离线 Mock 对话，标注能力边界。

## 2026-10-30 Ember 新叙事对齐
- 两个 v6 前端/设计分支同指 e4ba9eb；以 G3 修复分支为包含该界面的基线，另合入新叙事规范。
- 冲突的旧 AppShell、HomePage、tokens、旧 E2E 使用新前端版本；既有业务深链接保留。
- 不沿用“发送即加热”及“thread.updatedAt = 最近互动”；仅回读确认用户消息后升温。避免切换 DB、线程、失败后被旧缓存误导。
- 不为单个位置过渡新增动画依赖，采用 CSS + 可取消的原生 FLIP。真实故事卡和 Pi 深读仍属后续范围。

## 2026-10-30 精修追加决议
- 用户明确纠正未设计手机端：本次只验收1440×900与1280×800桌面，不新增移动页面。
- 用户明确调用gsap-core：新增gsap/@gsap/react依赖，实际采用scoped useGSAP+Timeline，移除冲突WAAPI/旧圆焰CSS。纯UI偏好输入使用直接zod依赖严格校验。
- 本地欢迎是初次建立关系的实际可运行部分，独立于auth/consent/炉温；完成欢迎不升温。
- 子代理按用户要求中断并重新派发；已写入组件由新实例接续精修与检查，所有交付最终由主代理浏览器复核。
- 真实浏览器发现欢迎完成时GSAP父contextSafe包装嵌套matchMedia回调会形成context循环、触发getTweens栈溢出。删除纯React回调的跨context包装，增加active/completed守卫及回调清理，复测完整流程通过。

## 2026-10-30 叙事驱动而非单点动效
- 从开屏故事扩展为完整关系逻辑，持久温度、临时注意力与真实工作事实独立；黯态不再等于静止。
- 视觉cue只允许kind/paused，不携带消息、路径、项目ID或授权字段；事件不能发起API或改变业务状态。Zod严格校验外部事件。
- 全局动效暂停使用模块内UI偏好，页面内导航保留，不持久化、不等同观察暂停。测试最初整页goto会重置此内存，改用真实页面内导航验证既定语义。
- 核心只实现现有操作与叙事的交叉；真实StoryEpisode、Pi同线程、长期自主能力仍在候选阶段，不以视觉暗示已完成。

## 2026-10-30 页面即炉心
- 根据用户新方向废弃独立SVG火焰与炭床，将既有 GSAP 呼吸改为中央与页面连续光场；历史视觉文档保留为旧方案并明确标注。
- 视觉暖度分层：0 条 0.12，最近24小时内1/2/3/4+条分别 0.42/0.53/0.64/0.75；1–7天降至温态，更早为余光。只代表当前话题已保存的交流，不能按项目进度解读。
- 服务端历史与旧本地展示叠层分离：暖度使用经过严格投影校验的服务端用户消息；读回不确定时不播放确认/不增暖，提醒先查看会话，避免盲目重复发送。
- 当前项目与线程尚无可用的完整关联和可信进展合同；作为后续核心候选记录，没有引入推测性项目进度指标。
- 默认收起线程侧栏、移除常驻项目/聊天分页导航；搜索在展开的历史侧栏，项目与设置仍可由菜单访问。

## 2026-10-30 昼夜与等待状态
- 昼夜由设备本地时钟决定（07:00/19:00 边界），是环境层，与已确认交流的光强、实际项目/执行事实分离；不更改系统主题或增加后台行动。
- 把聊天请求等待和其他动作失败区分为独立视觉事件；只有聊天本身确认、失败或话题切换才结束其等待光。暂停时请求本身继续，重新开启动效不会恢复已结束的等待。
- 发送中切换话题时取消本地请求等待、保留相应话题的内存草稿，并说明可能已经送达；不自动重试，也不将中断视为未保存。草稿不做新的持久化。
- 夜间令牌作用于应用外壳及欢迎、项目、设置；对继承文本和状态徽标单独调校，避免暗底沿用日间深色文字。保持桌面范围。

## 2026-10-30 磨砂玻璃活火动效
- 将抽象几何光幕升级为真实湍流翻动的玻璃火影，保留既有暖白对话截面质感与深黑夜晚对比；火焰是唯一光源，不添加外部边框与装饰贴图。
- 火焰大小为本地视觉偏好，通过 Zod 校验限制在 0.65 至 1.40 范围内，保存在 localStorage，不与交流温度（0.12–0.75）混淆或反向影响业务数据。
- 动效平滑与健壮性：高频打字 pulse 由固化 timeline 重启改为动态平滑插值，避免截断归零的闪烁跳变；着色器纹理边缘添加平滑渐隐消除扰动截断缝隙；磨砂玻璃底色补充昼夜渐变过渡；无 WebGL 环境保留静态柔和火影无缝降级。

## 2026-10-30 预览启动修复
- 渲染器清理保留显式纹理、缓冲和着色器释放，但不主动触发 WebGL 上下文丢失；避免组件初始化/重挂载后错误进入降级模式。真实上下文丢失仍由现有事件处理。

## 2026-10-30 火影颜色
- 火焰纹理使用预乘透明度采样并在合成前还原颜色，边缘淡出只影响透明度；将日间、夜间与休眠状态色调略微调暖，避免黑色边缘。未改变火势状态计算。

## 2026-10-30 火焰五态对照
- 按用户请求先记录并对照当前效果：所有阶段使用相同视口、用户大小设置和稳定帧；页面文字仅在火影对照图中隐藏。项目与对话输入为合成数据，未伪装成真实项目状态。

## 2026-10-30 五态火影
- 按确认的方向使用独立视觉比例，而不是让手动大小决定阶段；状态变化由 GSAP 连续插值，暂停/减少动态效果时立即呈现目标形态。
- 校正旧生命周期测试：清理时不主动丢失 WebGL 上下文，以保持此前已验证的组件重新挂载行为。

## 2026-10-30 前端整理
- 六套 `prototypes/` 是已跟踪的历史设计源文件，不按构建缓存删除；不删除本地数据库或截图证据。当前仅有一个前端构建目录，继续供预览使用。

## 2026-10-30 MVP G0 待审提案
- 先隔离旧主动建议/模拟执行路径，再增量建设项目事实和观点；研究/模型/执行授权独立，现有 Pi 单次外发确认不得因后台预授权被弱化。
- 对话和火影视觉资产可复用，旧聊天计数、卡片完成、添柴和活力百分比不构成项目生命语义。方案仅提交审阅，不视为实现或自动执行授权。

## 2026-10-30 G0 审阅反馈
- 自主公开研究允许一次授权主题范围内定期元数据发现，超范围/不确定外发才阻断；模型和私有内容授权仍独立，不削弱现有 Pi 确认。
- 证据类型区分观察流、公开来源与用户决定；GET 只读，展示使用受控 claim 和独立幂等确认。呈现后确认前崩溃无法保证恰好一次，须标记不确定并防止无界重复。

## 2026-10-30 MVP G0 用户审查
- v0.2 文档审查 PASS，不构成编码或推送授权。G1-A 不提前构造过渡项目身份；后续研究链有来源、深度和去重边界，历史观点保留可审计性但失效时不可主动推荐。

## 2026-10-30 G1-A 后端
- 由于 `demoMode` 和默认路径不足以证明数据库与产物隔离，实际服务暂不启用旧 Demo seed/reset/项目卡片/执行与审批；仅隔离测试显式打开旧 Mock 执行器。前端须按 health 的 `legacyDemoAvailable` 失败关闭，不以按钮隐藏代替服务端限制。
- 旧线程产生的可识别模拟建议及伪完成在响应和模型上下文中屏蔽、数据库不删除；未识别历史仍需审查。验证中的旧任务取消返回 `pending_verification`，不编造撤销已发生的副作用。

## 2026-10-30 · 前端数据保全验证补充

保留旧本地数据、展示时不回灌。测试只在首次加载时注入合成数据，等待会话就绪后比较完整内容，并在刷新后再次比较；使用同一线程和同一消息 ID 检查旧动作不会被附加。截图目录可由 `HEARTH_TEST_EVIDENCE_DIR` 覆盖，以便独立复验时不覆盖既有证据。


## 2026-10-30 · 叙事与设计对应审查

审查采用 docs/mvp 新产品意图：五形态作为视觉资产保留，添柴/活力百分比/聊天次数推断推进须移除；未来从可信项目生命投影，不将旧交流热度规则当作新MVP终态。沿用G1–G5，不另起重设计或自动研究授权。此次仅审查，不开始业务编码。


## 2026-10-30 · 项目优先与一句判断实现

按用户明确取舍，先添加/选择项目再谈，观点只露一句；复用现有thread.projectId与Observer身份，不引入新项目身份或迁移。旧无关联记录只读保留。无可信生命投影前用中性氛围，移除添柴与评分，不把旧消息计数当临时产品终态。真实观察及手动分析进入对话，但聊天继续明示Mock，既有Pi确认不弱化。此次改动在独立codex/project-first-conversation分支，未启动整个G1/G2流程。
