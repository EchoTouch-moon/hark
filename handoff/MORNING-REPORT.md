# Morning Report — 2026-10-28 夜间运行（主交付 HEAD: f076cb4，前序 145213c）

**状态**：M0 ✅ GREEN · M1 ✅ GREEN · M2 ✅ GREEN（P1 范围；precision@3 诚实标注 NOT_MEASURED）

## 1. 真实环境
- OS：macOS darwin 27.0.0 arm64；Node v22.23.2；pnpm 11.9.0；git 2.49.0；python3 3.9.6
- 仓库：`/Users/v/new-idea/hark`（本仓库内 git init，未推任何远端）
- 主交付 HEAD：`f076cb4`（收尾含首启 seed 修复；14 个本地 commit，未推送任何远端）
- 运行命令与端口：
  - API/一体化运行：`pnpm dev:server` → **http://127.0.0.1:4317**（首启自动 seed+discover；同端口伺服已构建 UI）
  - 纯前端开发：`pnpm dev:web` → http://localhost:5173（/api 代理到 4317）
  - E2E：`pnpm test:e2e`（自起 4321 端口独立实例 + 独立 DB `data/e2e.sqlite`）

## 2. 实际交付（20/20 overnight 任务 DONE，progress.json 同步）
- **M0**：Zod 严格合同（DTO+状态机+canonical/sha256 纯 TS）、策略引擎（动作注册表/digest 审批/路径防逃逸）、SQLite（node:sqlite，显式 migration/WAL/FK）、fixtures/eval 复放框架
- **M1**：Fastify localhost API（会话+CSRF+Origin、SSE 端点）、规则发现/去重/抑制、Run 编排（MockExecutor 真实写 `.hearth-demo-artifacts`、独立 Verifier、重启恢复）、React UI 全五页（Home/Chat/Projects/Activity/Settings，中文、空/错/加载态、1280/1440 无横滚）
- **M2**：确定性评分（golden precision@3=1.0）、静默时段（IANA 时区+DST 测试）/每日预算/忽略冷却（用户显式扫描不被静默拦截，ADR-006）、Hermes 只读 probe（未配置→诚实 unconfigured）
- **并行方式**：4 个子 Agent（eval、UI shell、Home、Projects/Activity/Settings），合同/存储/权限/编排由主 Agent 串行收口；子 Agent 不 commit，主 Agent 统一验证合并

## 3. 测试摘要（全部真实 exit code，证据在 handoff/EVIDENCE/）
| 命令 | exit code | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 全仓 strict 通过（含 web 独立检查） |
| `pnpm test` | 0 | **12 files / 131 tests**（contracts 32、policy 17、storage 13、eval 16、verifier 6、orchestrator 8、discovery 15、scoring 7、server api 20…） |
| `pnpm lint` | 0 | eslint 9 flat config |
| `pnpm build` | 0 | web vite build（341KB js）+ server esbuild bundle |
| `pnpm test:e2e` | 0 | **11 passed / 0 failed**（Playwright 1.64.1 + chromium-1248） |
| 安全负例 | 0 | S01–S12 全部有真实断言（policy/api/e2e 分层，见 m1-gate.txt 映射） |

## 4. Demo 演示路径（明早照此点击）
1. `pnpm build && pnpm dev:server` → 打开 http://127.0.0.1:4317
2. **Home**：3 张合成卡（CI 诊断/实验清单/会议草稿），每张有 whyNow/来源/风险/TTL
3. **硬闭环**：CI 卡「查看证据」→ 见 fixture 来源与事件 → 「开始处理」→ queued→executing→verifying→completed（步骤实时轮询）→「查看 Run」进 Activity：3 个步骤、sha256、artifact 路径
4. **验证产物**：`.hearth-demo-artifacts/report/ci-42.json`（真实文件，Verifier 独立重算 hash 才置 completed）
5. **刷新/重启**：状态保留（E2E-03 + demo-run.json 里真实 kill-restart 记录）
6. **负例**：双击同卡幂等（同 run）；忽略后不再重现；跨项目查询服务端隔离；未审批 L2 零执行器步骤（API 级断言）
7. **Chat**：输入即回（明确「离线演示 · 不连接模型」），记录持久化
8. **Settings**：安静时段/预算/时区可保存；「重置 Demo 数据」需二次确认且只清 demo DB

## 5. Git / 证据
- 14 个本地 commit（eadc0d7 → f076cb4），未推送任何远端
- 截图：`handoff/EVIDENCE/ui-{home,chat,projects,activity,settings}.png`（Playwright 实拍）
- 闭环 trace：`demo-run.json`；审计快照：`morning-audit-snapshot.json`；每任务证据 txt 共 12 份

## 6. 已知边界与下一阶段优先项
1. E2E-12 浏览器级断服模拟未做（client 重试+ErrorState 已覆盖路径）；SSE 端点已备、UI 暂用轮询
2. 50 条标注基准集未建 → precision@3 NOT_MEASURED（现有 golden 5 条 = 1.0）
3. Hermes 未配置（不请求密钥、不假装在线）；真实 connector 全 OFF
4. 下一步建议顺序：真实 connector 只读接入评审（M2 文档）→ 50 条基准集 → SSE UI 消费 → M3 browser handoff（人工评审后）

## 7. 用户审批事项（今晚零越权）
未访问 personal-vault/memory-vault；未碰 Hermes 配置；无 sudo/Docker/远端推送/邮件/支付；所有密钥类操作为零（PROVIDER_BUDGET=0，无付费 API）。真实副作用接入一律等你明早批准。

## 2026-10-29 · P2-A Live Verification 增量交付

真实 stepfun-plan/step-5-preview 在 pindou 上生成建议卡，工程闭环 PASS；默认 Mock 保留。修复 Provider 扩展注册缺失、显式模型选择、结构化输出合同和 UI 来源标识。全仓 306 tests、类型检查、改动文件 lint、web build 通过。未执行模型建议、未更改 pindou、未修改全局 Pi/Hermes 配置。人工有用性判断尚未完成，未进入 P2-B/C。详情与截图：docs/verification/hearth-p2a-live-verification.md、handoff/EVIDENCE/p2a-live-card.png。原有工作区改动保留；全仓 diff-check 的既有空白问题不属于此次变更。

## 2026-10-29 · R0/R1/R2整改增量

R0 PASS（cca95e0），R1 PASS（1642215）。R2工程本地检查通过：343测试、typecheck、lint零错误、完整build、16项E2E。隐私预览/逐次确认与持久化记录、排除路径、稳定上下文、真实模式与Mock标识、反馈、README及最小CI已实现；远端CI需以新运行确认。R2人工价值门禁NOT_MEASURED，用户定性反馈已保存，未执行新的真实模型请求。数据migration至analysis v4；启动补偿清理任务，不自动重试中断模型。运行方式与限制见README及docs/verification/remediation-r*.md。

远端补充：GitHub CI Run40836527163对00121a2实际通过，job2m31s；完整源码已推送私有仓库。R2仅人工价值门禁未通过，不能用CI替代。后续本批只有验收记录更新，不变更已通过源码。

## UI-REFRESH-01 · 第一块交付

本地分支codex/ui-refresh-01，主题基础与空详情隐藏已完成，web build/typecheck、局部lint、新浏览器1场景与基础对比度检查通过。尚未重构真实首页、导航或分析API，未进入P2-B/C。继续执行从tasks/UI-REFRESH-01.md最新交接开始；本块不推送以保留小步本地交付。
