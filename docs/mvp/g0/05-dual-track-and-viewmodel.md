# G0 · 双轨分闸、HearthViewModel 合同与主动呈现判定

> 2026-10-31 · 产品。补齐外部评审 5 处修改中 `92a9ed3` 未覆盖的部分。冻结前不写功能代码。与 02/03 冲突时，以本文的分闸与 ViewModel 为准，安全与授权仍以 ADR-04/07 为准。

## 1. 评审 5 处修改对照

| # | 修改 | 状态 | 落点 |
|---|---|---|---|
| P0-1 | G0–G5 拆成共享底座 + 双轨闸 | 本文 §2 | 替换 03 的线性 G1–G5 排序 |
| P0-2 | Mind→Experience 正式数据合同 | 本文 §3 | `packages/hearth-contract` |
| P0-3 | 研究 / 模型 / 执行权限分离 | 已覆盖 | 02 ADR-04（四项独立，默认关） |
| P1-1 | Research Watchlist | 本文 §4 | 在 TopicScope 之上补用户可见清单 |
| P1-2 | 观点价值 vs 打扰成本 | 本文 §5 | ProactivePolicy 判定规则 |

## 2. 分闸

| 闸 | 范围 | 负责 | 出闸条件 |
|---|---|---|---|
| G0 共享底座 | 02–05 文档、`HearthViewModel` Zod schema、四态 fixture | 产品 + 后端 | 产品 ready、总工开闸 |
| G1-A 安全基线 | 03 原 G1-A（真实模式拒旧执行、项目隔离、GET 无写） | 后端 | 两轨开写前必须通过 |
| E1 Experience · 静态 | 仅消费 fixture：四界面 × 四状态、火焰只读 NarrativeState | 前端 + 设计 | 设计 pass、测试 Experience 清单 |
| M1 Mind · Chronicle + Opinion Memory | 03 G1-B/G1-C | 后端 | 测试 Mind 清单 |
| M2 Mind · Research | 03 G2 | 后端 | 同上 + 一次真实公开检索日志 |
| M3 Mind · Opinion + Proactive | 03 G3 + 本文 §5 | 后端 | 同上 |
| I1 集成 | Experience 改读真实 API，契约不变 | 前端 + 后端 | 测试集成清单，含 H1 |
| 终验 | 03 G5 / H1 | 测试 + 产品 | 用户本人确认观点有新信息、值得出现 |

E1 与 M1–M3 并行。两轨只通过 `HearthViewModel` 相连，任一轨改 schema 需重开 G0 小闸（产品 + 后端双签）。

## 3. HearthViewModel（Mind → Experience 唯一入口）

```ts
type Scope = { kind: 'global' } | { kind: 'project'; projectId: Id; title: string };
type Freshness = 'fresh' | 'stale' | 'gap' | 'unknown' | 'disabled' | 'unavailable';
type FlameLevel = 'neutral' | 'ember' | 'warm' | 'bright';     // 旺/温/黯 + 无项目中性
type EvidenceLabel = { id: Id; kind: 'observer' | 'research' | 'decision'; label: string }; // 界面展示用，≠ 02 的 EvidenceRef
type StoryBeat = { kind: '诞生' | '探索' | '推进' | '沉淀'; at: ISODate; summary: string; evidence: EvidenceLabel[] };
type NarrativeState = {
  flame: { level: FlameLevel; reason: string; milestoneGold: boolean }; // reason 为可读文字
  story: StoryBeat[];                                                 // 与 flame 同源
};
type FeaturedOpinion = {
  revisionId: Id; opinion: string; whyNow: string;
  evidence: EvidenceLabel[]; uncertainties: string[];
  actions: ['查看依据', '讨论计划', '稍后再说'];
} | null;
type Permissions = { observe: boolean; research: boolean; model: boolean; execute: false };
type HearthViewModel = {
  mode: 'real' | 'demo';                 // demo 必须在界面明示
  status: 'ok' | 'empty' | 'error' | 'permission_denied';
  error?: { code: string; message: string };   // real 模式失败必须走这里
  scope: Scope;
  narrative: NarrativeState;
  featuredOpinion: FeaturedOpinion;      // 最多一条
  observationFreshness: Freshness;
  permissions: Permissions;
};
```

硬规则：
- 观点历史版本不进 ViewModel，展开时按需读 `GET /opinions/:revisionId/history`。研究关注清单走独立接口，不进 ViewModel。
- 「稍后再说」后是否重新出现由服务端主动呈现判定（§5）决定，前端不自行推断，不拿 `revisionId` 变化当信号；`featuredOpinion` 非空即显示。
- `status` 为 error 或 permission_denied 时，火焰旁只显示「暂无法判断」类文字，不给任何焰态名（如「静火」），以免把读取失败说成项目安静。
- Seed 的「扫描」只触发一次只读观察：`permissions.observe=false` 时禁用并引导授权；不得连带触发研究或模型调用。
- 火焰只由 `narrative.flame` 决定。消息数、卡片数、完成数一律不得参与；`emberHeat.ts` 与 `projectEmber.ts` 的计数规则删除。
- `mode: 'real'` 下任何服务失败都返回 `status: 'error'`，界面显示错误，不得静默改读 Mock 或 fixture。全局规则，不只 chat。
- `permissions.execute` 在 MVP 恒为 `false`。

Fixture（`packages/hearth-contract/fixtures/`，由后端交付）：`ok.json`、`empty.json`（无项目，flame=neutral）、`error.json`（real 模式服务失败）、`permission-denied.json`（research 或 observe 未授权）。另加 `stale.json`（observationFreshness=stale）供设计覆盖过期态。

## 4. Research Watchlist

在 `TopicScope` 之上给用户一份可见清单：每项显示主题、边界、允许来源、频率、预算已用 / 上限、到期时间、最近一次检查及结果（有新资料 / 无变化 / BLOCKED）。用户可暂停、改边界、删除；删除即撤销对应 ResearchPolicy。清单本身不触发研究。本拍 Should，不阻塞 E1 / M1。

## 5. 主动呈现判定（价值 vs 打扰）

候选观点只有同时满足以下条件才可进入 `featuredOpinion`：
1. 至少一条用户此前未见过的新证据（对比该项目已呈现 revision 的证据集合）。
2. 与当前项目已登记目标或决定有可解释的关联，`whyNow` 必须写出这条关联。
3. 用户当前未在输入，且该项目在冷却期外；被「稍后再说」的观点到 `deferUntil` 前不再出现。
4. 同一项目 24 小时内主动呈现不超过 1 条（数值可配，默认 1）。

不满足即静默，不降级成提示条或角标。用户反馈「没用」计入该主题的阈值上调，具体曲线在 M3 定，但必须可审计。

## 6. Must / Should / Won't

- Must：§2 分闸；§3 schema + 四态 fixture；火焰只读 NarrativeState；real 模式无静默 Mock；执行恒关；一条端到端切片在搁置、复审、重启后保持。
- Should：§4 Watchlist；§5 的反馈调阈值。
- Won't：管理后台、活力百分比、添柴、自主跑命令或外部写入、拆成两个仓库。

## 7. 完成标准

工程上 H1 切片端到端跑通；用户本人确认首条观点带新信息且值得出现。两者缺一不算完成。
