# Hearth · Project Insight Engine — S2 详细设计与实施任务书

> 版本：v1.0 (2026-10-29)  
> 建议仓库路径：`docs/17-PROJECT-INSIGHT-S2-IMPLEMENTATION.md`  
> 目标工作区：`/Users/v/new-idea/hark`  
> 文档类型：Implementation Plan + Gate Contract（允许开发 Agent 按门禁实施）  
> 本文依据用户交接的 S1.0/S1.1 实施事实及原 P1 规格编制，**不是当前 Mac 本地代码审查结果**。

## 0. 目的与非目标

### 0.1 一句话目标

把 S1 提取、持久化的可信 `Signal` 转化为**低噪声、证据可追溯、跨重启可靠、生命周期准确**的 `Insight`。即使不依赖 LLM，也能识别少数值得用户关注的项目情况。

### 0.2 当前已知基线

- P0 Observer schema v3：事务内全局 `append_seq`，`listEventsForward` 按追加顺序消费，冻结 highWatermark；v2 迁移后的 legacy 顺序明确标注重建。
- 项目硬删除后留下 tombstone；可检测 PROJECT_REMOVED、STREAM_EPOCH_MISMATCH、CURSOR_AHEAD_OF_STREAM；历史 payload 不可回放。
- S1.1 `InProcessObserverReadPort` 和纯函数 Signal Extractor 已实现；固定水位、两端 epoch 校验、按事件关联的历史 snapshot；Signal identity 基于 extractorVersion/projectId/streamEpoch/sourceEventId/kind/subject 的确定性哈希。
- `headBinding=UNDETERMINED`；多 JUnit 来源只能使用事件已有的 `relativePath`；未知的旧报告不可恢复。
- S1.1 提交：功能 `57191f9`、门禁 `17aa2ed`；96 项相关测试 PASS（均为用户交接信息）。
- **S1.2 状态尚未在当前对话中得到完成证据。** S2.0 必须核实 `signal_inbox`、P1 checkpoint、提交事务与失败注入是否真的存在并通过验收；**不得假设 S1.2 已完成**。
- 工作区曾存在未提交 P0.5 文件；本轮必须先 `git status --short`，不得覆盖/清理/误纳入提交。

### 0.3 硬性非目标

- 不调用 Hermes、Pi、Codex、GLM 或其他 LLM。
- 不实现 HTTP API、Insight Feed UI、消息、邮件、手机通知；留给 S3/P2/P3。
- 不运行项目测试、构建、git fetch、修改被观察仓库或读取源码正文。
- 不实现任务完成百分比、技术建议、跨项目知识推理、时间预测或自动创建开发任务。
- 不把 P1 做成动态 DSL、插件市场或泛化事件总线。
- 不改写 P0 observer.sqlite；P1 可写且仅写自己的 insights.sqlite。

## 1. 阶段切片及依赖

| 切片 | 名称 | 输入前提 | 可验收交付 | 退出条件 |
|---|---|---|---|---|
| S2.0 | Entry & Contract Audit | S1.1 | S1.2 gate 复核，接口映射，ADR 差异单 | G0 PASS 才可继续 |
| S2.1 | Deterministic Rule Kernel | S2.0 | 规则注册表、纯函数、硬否决、Candidate/NO_INSIGHT、规则测试 | G1 PASS |
| S2.2 | Episode & Lifecycle | S2.1 | issue family、稳定 episode、去重冲突、恢复复发、状态机 | G2 PASS |
| S2.3 | Durable Insight Processor | S2.2 + S1.2 | schema、规则游标、单库事务、重放/恢复、Source reset 冻结 | G3/G4 PASS |
| S2.4 | End-to-End Verification | S2.3 | fixture 回放、性能基线、真实项目只读验证、门禁报告 | G5–G8 判定 |

**执行规则**：每个切片先检查门禁，未通过不得宣称进入下一切片；同一开发会话可继续，但必须输出逐切片证据。不需每小节要求人工确认，除非遇到破坏性迁移、不可逆删除或安全权限变化。

## 2. 核心不变量（必须写入测试）

1. **No unsupported claim**：结论不超出证据支持范围。`headBinding=UNDETERMINED` 时不能写“当前 HEAD 测试回归”。
2. **No duplicate incident**：同一活跃问题、同一 projectId + epoch + issue family + subject 只能有一条活跃 Episode；重复信号不可制造新洞察。
3. **New recurrence**：确证恢复后再次出现，创建新 Episode，保留旧历史。`A→B→A` 不应被内容指纹误消除。
4. **Dismiss remains dismissed**：同一 Episode 的 dismissed 不因重复信号、重放、规则小版本变化而重新开放。
5. **Evidence or veto**：首次生成必须有可取回的 trigger 证据；证据不可用则拒绝发布或降级/冻结，不造证据。
6. **Transactional checkpoint**：规则处理结果、Episode/Insight 更新、证据引用、规则处理游标须同一个 **P1 SQLite** 事务提交。失败全回滚。
7. **No-op means no write**：没有新 Signal、没有合法到期任务时，S2 不写 SQLite；`NO_INSIGHT` 不产生用户卡片和常规逐事件审计行。
8. **Independent versioning**：Extractor 游标 ≠ 规则评估游标。规则版本变化不能静默重放旧内容并制造新卡片。
9. **Source isolation**：项目删除/epoch 失配/备份回绕必须冻结并显式报告；不自动归零继续消费。
10. **Determinism**：同一输入信号序列、规则版本、配置和注入时间，结果及身份一致；绝不使用未注入的 Date.now()/Math.random() 决定规则结果。
11. **Separation of concern**：P0 Fact ≠ S1 Signal ≠ S2 Insight。P0 的状态未知不等于测试失败，Git 变更不等于项目进度变化。
12. **Deletion semantics**：P0 请求彻底删除项目时，S2 不得在默认策略下无限保留其敏感 payload；只保留经确认允许的最少 tombstone/审计摘要。

## 3. 结构与接口（建议；以真实 S1.2 代码适配）

```text
packages/project-insight/src/
  contracts/                 # 现有 Zod contracts，最小增量
  observer-read-port.ts      # S1.1，避免修改其行为
  signals/                   # S1.1，避免改动已冻结信号语义
  rules/
    types.ts                 # Input/Result/ReasonCode
    registry.ts              # explicit whitelist + version
    policy.ts                # enabled rules + veto + thresholds
    test-failure.ts
    test-transition.ts
    observer-health.ts
    observation-gap.ts
    repository-access.ts
    __tests__/
  episodes/
    identity.ts              # issue-family/episode identity/canonical serialization
    reduce.ts                # 纯状态机
    conflicts.ts             # 同类候选竞争/抑制
    __tests__/
  insights/
    schema.ts                # S2迁移
    store.ts
    processor.ts             # 有界逐项目消费，事务
    fixtures.ts              # 独立测试构造器
    __tests__/
  index.ts
scripts/
  insight-s2-replay.ts       # 只对临时 fixture/P1测试库运行
  insight-s2-bench.ts

docs/
  17-PROJECT-INSIGHT-S2-IMPLEMENTATION.md
  adr/ADR-INSIGHT-003.md
  verification/insight-p1-s2-gate.md
  verification/data/insight-s2-bench-*.json
```

不得为了符合建议目录而破坏当前 monorepo 的命名与工作方式。

### 3.1 规则接口

```ts
type RuleDecision =
  | { kind: 'NO_INSIGHT'; reasonCode: string }
  | { kind: 'DEFER'; reasonCode: string; dueAt?: string }
  | { kind: 'CANDIDATE'; candidate: InsightCandidate }
  | { kind: 'RECOVERY'; recovery: RecoveryEvidence };

interface RuleInput {
  signal: Readonly<Signal>;
  state: Readonly<RuleStateSnapshot>;
  policy: Readonly<InsightPolicy>;
  clock: Readonly<{ now: string }>;
}

interface InsightRule {
  id: string;
  version: string;        // semver或冻结整数，必须明确升级语义
  issueFamily: string;
  evaluate(input: RuleInput): readonly RuleDecision[];
}
```

- `RuleDecision` 只表示计算结果，不能直接写数据库或访问文件系统。
- 如现有 `Signal` 不包含必需的前后态证据，应明确 `NO_INSIGHT / INSUFFICIENT_EVIDENCE`，而不是主动查最新快照补历史事实。
- Rule Registry 只允许已编译的白名单规则，配置不可运行任意代码。
- 存储从 Candidate 得到的有限模板参数，不存完整源事件/测试 XML/git diff。
- `DEFER` 只能在存在明确时间相关事实和注入时钟时使用；S2 不建设定时后台调度。可在 S3 引入真正 scheduler；S2 手动重评估可测。

### 3.2 Candidate 与 Insight

```ts
interface InsightCandidate {
  projectId: string;
  streamEpoch: number;
  ruleId: string;
  ruleVersion: string;
  issueFamily: string;
  subjectKey: string;
  openingSignalId: string;
  severity: 'info' | 'attention' | 'important';
  confidence: 'low' | 'medium' | 'high';
  headBinding: 'BOUND_TO_HEAD' | 'NOT_BOUND_TO_HEAD' | 'UNDETERMINED';
  reasonCodes: string[];
  evidenceRefs: EvidenceRef[];
  titleKey: string;
  detailKey: string;
  templateData: Record<string, string | number | boolean | null>;
  historical: boolean;
}

type InsightStatus = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'RESOLVED' | 'WITHDRAWN';
```

- 这些是**目标语义**，并非宣称所有字段已存在。必须对照 S0 冻结 contracts 保持兼容；有冲突写 ADR。
- 程序输出文本必须通过固定模板和白名单参数生成，模板参数需要长度上限、路径脱敏、转义；不能让 P0 的任意 message 成为建议正文。
- `confidence` 表示证据支持级别，不等于模型概率。
- `headBinding` 默认 `UNDETERMINED`，不可由 `headBound:false` 自动提升为 `NOT_BOUND_TO_HEAD`。

### 3.3 证据引用

```ts
type InsightEvidenceRef = {
  projectId: string;
  sourceEventId: string;
  snapshotId?: string;
  role: 'trigger' | 'baseline' | 'context' | 'resolution';
  quality: 'OBSERVED' | 'UNKNOWN' | 'STALE' | 'UNAVAILABLE';
  observedAt: string;
};
```

每条可见洞察至少有 1 个有效 trigger。优先保存原始 ID 与有限审计摘要，详情页（S3）通过 `/observe/:id` 导航；本阶段只验证指针可访问性和正确归属。`UNAVAILABLE` 为 P1 派生状态，不能冒称来自 P0 原字段。

## 4. S2.0 — Entry Gate（阻断入口）

### 4.1 必须核验

- S1.2 是否已经实现并通过：`signal_inbox`、消费 checkpoint、projectId/epoch/version 绑定、P1 单库原子事务、并发 CAS/单 writer、失败注入、源重置冻结。
- 当前 P1 SQLite schema version 与迁移状态；是否存在旧格式或脏数据。
- S1.1 Signal 的真实 kind/subject/payload/evidence shape。尤其 JUnit 的有效性、relativePath、前后结果可比较字段。
- P0 `removeProject` tombstone 与历史事件硬删除限制。
- 是否有真正的 event/source 证据可按 ID 追溯；不能只持有内存对象。
- 与原 `docs/16-PROJECT-INSIGHT-P1.md`、ADR-INSIGHT-001/002 的差异。

### 4.2 结果

- 全部前置能力 PASS 才能执行 S2.1。
- S1.2 未实现或 FAIL：立即停止 S2 功能开发，输出 BLOCKED_PRECONDITION 和最小缺口，不越权补作或宣称已完成。
- 某个非必需 rule 因 P0 事实不充分而 BLOCKED：可以禁用该规则继续，但不得降低全局证据门禁。
- 如果有未提交的 P0.5 文件，不在未经明确授权情况下清理或提交。

**交付**：`docs/verification/insight-p1-s20-entry-audit.md`。

## 5. S2.1 — 首批规则设计

### 5.1 明确可以启用的规则

| 规则 ID | 默认 | 触发/门槛 | 输出语义 | 严重度 | 恢复要求 |
|---|---|---|---|---|---|
| `R-TEST-FAILURE` | ON | 有效 JUnit 报告源 `relativePath`，failures+errors > 0，trigger 证据可达 | “观察到该报告源包含失败” | attention | 同一报告源**新的有效可比较报告**失败数归零 |
| `R-TEST-REGRESSION` | ON（证据不足自动 NO_INSIGHT） | 同来源前值可比较且失败从 0→>0 | “同一路径报告的观测结果由无失败变为有失败” | important | 同源可信恢复报告；不可说当前 HEAD 回归 |
| `R-OBSERVATION-GAP` | ON | P0 明确 OBSERVATION_GAP 事件 | “这段时间存在观测空窗，期间过程未知” | info | 默认不自动解释空窗过程；可后续用户处理/有证据恢复 |
| `R-OBSERVER-HEALTH` | ON（需证据） | P0 信号足以证明连续异常≥3，**或**同故障持续≥15分钟 | “持续采集异常” | attention | 明确稳定恢复证据；单次失败 NO_INSIGHT |
| `R-REPOSITORY-UNAVAILABLE` | ON（需证据） | 同项目仓库持续不可用，有源状态事件/有效持续性证据 | “项目源持续不可访问” | attention | 明确恢复信号与成功扫描 |
| `R-TEST-EVIDENCE-GAP` | **OFF** | HEAD 归属缺失，当前前置不支持 | 不生成 | — | 未来在 HEAD 绑定能力成熟后单独立项 |

**必需澄清**：`R-TEST-REGRESSION` 为历史规则 ID，不能据 ID 对用户暗示代码回归；对外描述必须是“同报告源的观测结果变化”。如改名为 `R-TEST-RESULT-TRANSITION`，需 ADR + 兼容映射 + golden test，不能静默替换已落库 ID。

### 5.2 否决规则 (hard veto)

- 触发证据丢失、项目/epoch 不匹配、legacy 顺序不可用于强因果判断。
- `UNKNOWN/STALE/UNAVAILABLE` 被当作 PASS 或 FAIL；无 HEAD 绑定却声称当前代码版本已验证。
- 报告源 relativePath 不确定、跨不同报告源做数值比较、JUnit 报告无可靠前后口径。
- 单次偶发采集失败、普通 git dirty/clean、branch 切换、单个 commit、空扫描。
- 用户在后续策略中明确禁用了该规则或项目（S2 只消费已有冻结策略，无 UI 设置）。
- 同一 issue family 已有活跃 episode，且没有实质升级，或已被 dismiss。
- P0 明确 PROJECT_REMOVED/EPOCH_MISMATCH/REWIND 时，不能生成新的普通 insight。

### 5.3 无变化与噪声原则

- 一次普通 HEAD 更新可形成内部 Signal，但默认为 NO_INSIGHT。
- 不依据提交次数、时间未提交或文件数量生成进度评价。
- 同一 JUnit 指纹或重复 observer 错误：同一个 ongoing issue，不重复创建。
- 异常信号不满足持续性阈值时：NO_INSIGHT，不为了“输出一张卡片”降低阈值。

### 5.4 可复现实例（期望行为）

| 输入 | 正确结果 |
|---|---|
| Git clean→dirty→clean，无其他证据 | NO_INSIGHT |
| 有效 JUnit（src A）2 failures，headBinding UNDETERMINED | TEST_FAILURE 候选，文案限定为报告失败 |
| src A 0 failures → src A 2 failures、统计口径可比较 | 1 张聚合卡片，优先描述“同报告源结果变化” |
| src A 0 failures → src B 2 failures | 不声称回归；src B 可独立作为失败观察 |
| src A invalid / report too large | 不生成“测试失败” |
| 单次 adapter error | NO_INSIGHT |
| 明确 observation gap | 1 张 info card，不重建空窗过程 |
| 普通新 commit + 旧测试报告 | NO_INSIGHT（证据缺口规则关闭） |

## 6. S2.2 — Episode 与生命周期

### 6.1 身份模型

**Project identity 必须包括 epoch。** 推荐：

- `issueKey = hash(canonical({projectId, streamEpoch, issueFamily, subjectKey}))`
- `episodeKey = hash(canonical({issueKey, openingSignalId}))`
- `insightId = hash(canonical({episodeKey}))`（或使用独立稳定前缀）。
- `ruleId/ruleVersion` 作为决策来源保留，但**同义规则不因 ruleId 不同而产出两张卡**。原 P1 文档若以 ruleId 构成去重键，须用 ADR 明确“语义去重键与规则执行幂等键”分离。

规则版本变更不得改变同一 ongoing issue 的 issueKey；重大语义变更必须显式启动迁移/重评估模式并保留已 dismiss 的历史状态。

### 6.2 Episode 生命周期

```text
                     acknowledge
               ┌──────────────────┐
               ▼                  │
        OPEN ──────▶ ACKNOWLEDGED  │
         │               │        │
         └──── dismiss ──┴────▶ DISMISSED
         │               │           │
         └──── verified resolution ───┴──▶ RESOLVED
         │               │           │
         └──── invalid evidence ─────┴──▶ WITHDRAWN

        RESOLVED + 新的有效激活事件 → 新 Episode
```

在 S2 没有 UI 反馈入口，先实现/验证 reducer 与存储状态；acknowledge/dismiss/useful/not_useful 的 HTTP API 留给 S3。已 dismiss 的 ongoing issue 不得因重放、下一次错误或版本变化重开。

### 6.3 确切恢复 vs 证据缺失

- `RESOLVED` 必须有明确、同一 subject 的新有效恢复证据；在恢复事务里追加 resolution ref。
- P0 源暂不可读 / 证据丢失 / 进入 SOURCE_RESET_REQUIRED ≠ RESOLVED。
- 如果首次判断因证据破坏而不成立，进入 `WITHDRAWN`，保留审计轨迹（彻底删除请求例外）。
- 如果新事件只是同样的失败或同样的错误，保持旧 Episode（无实质变化则不更新用户可见时间）。
- 确认 `RESOLVED` 后再次失败才开新 Episode；旧 Episode 仍存在。
- 同一 subject 的同源多条规则发生冲突时，按 `issueFamily` 聚合，一次输出一张主要卡；`R-TEST-REGRESSION` 比 `R-TEST-FAILURE` 文案更具体。即使后续 primary rule 变化，也不换卡 ID。

### 6.4 规则冲突优先级

1. 测试结果变化和测试失败属于 `test-report-failure` issue family，同一主体合并为一张 Insight。
2. 同一个仓库的采集健康异常与仓库不可用若有相同根源/同一证据区间，应归并或明确 suppress reason；不根据文案字符串做模糊相似度。
3. `R-OBSERVATION-GAP` 为单独 issue family，默认 info，不提升为严重故障。
4. 优先级 `important > attention > info`，置信度 `high > medium > low`；排序稳定且可解释，不引入黑盒数值概率。

## 7. S2.3 — 持久化与事务

### 7.1 数据归属

继续使用 S1.2 的 `insights.sqlite`（`HEARTH_INSIGHT_DB`），复用其 schema migration、单 writer、事务及 checkpoint 机制。**不创建第二个 P1 DB**。

建议 S2 增量表（按实际 S1.2 Schema 调整）：

```sql
CREATE TABLE insight_episodes (
  insight_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stream_epoch INTEGER NOT NULL,
  issue_key TEXT NOT NULL,
  episode_key TEXT NOT NULL UNIQUE,
  subject_key TEXT NOT NULL,
  issue_family TEXT NOT NULL,
  opening_signal_id TEXT NOT NULL,
  primary_rule_id TEXT NOT NULL,
  primary_rule_version TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  title_key TEXT NOT NULL,
  detail_key TEXT NOT NULL,
  template_data_json TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_material_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  historical INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX insight_episodes_feed_idx
  ON insight_episodes(project_id, status, last_material_observed_at DESC, insight_id DESC);

CREATE TABLE insight_evidence_refs (
  insight_id TEXT NOT NULL REFERENCES insight_episodes(insight_id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL,
  role TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  quality TEXT NOT NULL,
  PRIMARY KEY(insight_id, evidence_key, role)
);

CREATE TABLE insight_rule_progress (
  project_id TEXT NOT NULL,
  stream_epoch INTEGER NOT NULL,
  ruleset_version TEXT NOT NULL,
  last_signal_position INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, stream_epoch, ruleset_version)
);

CREATE TABLE insight_issue_state (
  issue_key TEXT PRIMARY KEY,
  active_episode_key TEXT,
  last_verified_recovery_signal_id TEXT,
  state_json TEXT NOT NULL
);
```

注意：上述 SQL 仅为**逻辑示例**，不能在未知 S1.2 实际列名和 SQLite 约束下直接硬套。`last_signal_position` 必须引用**P1 inbox 的稳定可恢复顺序**，不得把全局 P0 append_seq 当作 Signal Inbox 的连续行号。应审计 S1.2 的唯一键/序列/分页策略，以稳定 position + tie-breaker 或逐事件处理键做幂等。需要额外的 active episode 唯一约束时，考虑以 issue_state 的事务 CAS 维护，不要依赖可能失效的 `status IN ('OPEN')` 部分索引。

### 7.2 消费事务

```text
读取 P1 signal_inbox：per-project、per-epoch、bounded batch
  ↓
对每条按稳定顺序计算规则结果（纯函数）
  ↓
解决同义规则竞争 + episode reducer
  ↓
BEGIN IMMEDIATE on insights.sqlite
  ├─ 核对规则处理游标 revision / rulesetVersion / epoch
  ├─ upsert 实质变化的 issue state / episode / evidence
  ├─ 增量记录状态迁移（可选受限审计表）
  ├─ 将规则处理游标推进到完整处理边界
  └─ COMMIT
```

- 结果和规则游标**同一事务**；无法在同一事务内完成则不能标 PASS。
- 同一条 Signal 重放不重复创建卡片、证据引用或更新 lastMaterialObservedAt。
- `NO_INSIGHT` 批次可以推进规则游标，但不创建卡片；这属于 checkpoint 必要写入，不能把“NO_INSIGHT”理解为连已消费的新 Signal 都不能推进游标。**没有新增 Signal 时才必须零写入。**
- 多 worker 并发必须由 single writer / revision CAS 隔离。冲突重试需要重新读取 checkpoint 和 issue state，再重新计算，不可盲目复用过时状态。
- 规则崩溃：整个批次不推进游标；可对其他项目继续处理。不能静默吞错跳过有意义信号。
- 规则配置或 version 升级：冻结旧 progress，显式 migrate/replay 到隔离测试库验证后才能在生产启用；不得把同一历史 episode 重新发卡。
- 来源 `SOURCE_RESET_REQUIRED`：冻结该项目规则/消费链，保留已存在 Insight 并标明不可继续验证；不自行归零游标。

### 7.3 初次启用与历史回放

- 初次启用默认**基线模式**：将已在 S1 inbox 的旧 Signal 识别为 historical，不把多月前失败当作今天的新洞察。
- 启用后信号正常参与规则；初始界限应记录 `activatedAt` + 最小可信 inbox 位置，并有重启测试。
- 若需显式历史分析，提供一个 CLI 内部测试模式，不在 S2 制作 UI；标记 `historical=true`。
- 不允许简单按 `created_at` 过滤历史，因为迟到的信号或重放可能改变插入时间。

### 7.4 数据保留和删除

- 存有限 evidence ID、模板参数和理由码；不复制源码、完整 XML、绝对路径明文进卡片正文。
- P0 删除项目后，S2 不访问已删除 payload；由未来统一删除流程清理 P1 关联内容。S2 需给出可测试的 `purgeProjectInsights` 纯数据 API 或明确 BLOCKED，避免旧库成为用户不知情的影子存储。
- 禁止通过删除/重新注册同一目录偷换旧 epoch 历史。
- 保护已 dismiss 的状态与审计（用户明确要求彻底删除时除外）。

## 8. S2.4 — 测试矩阵

以下用例均应有可复现 fixture、输入、断言和记录；不只统计“新增多少个 tests”。

### 8.1 规则与证据（RU）

| 用例 | 断言 |
|---|---|
| RU-01 | 普通 HEAD / branch / dirty/clean 信号 → NO_INSIGHT |
| RU-02 | 有效同来源 JUnit 有失败 → 有证据的候选 |
| RU-03 | UNKNOWN/STALE/过大/无效报告 → 不发布测试失败 |
| RU-04 | 相同 relativePath、可比较 0→失败 → 限定文案 |
| RU-05 | 不同 relativePath / 不同统计口径 → 不声称结果回归 |
| RU-06 | headBinding UNDETERMINED → 从不使用“当前 HEAD 回归”表述 |
| RU-07 | R-TEST-EVIDENCE-GAP 默认禁用 |
| RU-08 | OBSERVATION_GAP 有源事件才产出，过程未知 |
| RU-09 | 单次采集错误 NO_INSIGHT；持续性不足时拒绝 |
| RU-10 | 连续错误阈值、稳定恢复按现存证据判定 |
| RU-11 | 证据缺失或 epoch 不匹配 → 硬否决 |
| RU-12 | legacy reconstructed 不被用于推断强因果先后 |

### 8.2 Episode 与规则冲突（EP）

| 用例 | 断言 |
|---|---|
| EP-01 | 相同 Signal 重放 → 同一 insight ID |
| EP-02 | 同一报告持续失败 10 次 → 一张卡 |
| EP-03 | 失败→有效同源恢复→再次失败 → 两个 episode |
| EP-04 | dismiss 同一 episode 后更多相同失败 → 不重开 |
| EP-05 | acknowledge 不等于 resolved |
| EP-06 | SOURCE_RESET_REQUIRED/无证据不是 resolved |
| EP-07 | regression + failure 同一触发 → 最多一张用户卡 |
| EP-08 | 新 epoch 不能继承旧 episode 和 feedback |
| EP-09 | 规则小版本变化不复制旧卡 |
| EP-10 | fixed canonical serialization 黄金样例身份稳定 |

### 8.3 SQLite、崩溃与并发（TX）

| 用例 | 断言 |
|---|---|
| TX-01 | 写 episode 后、规则 checkpoint 前失败 → 整段回滚 |
| TX-02 | 写 checkpoint 后 commit 前失败 → 整段回滚 |
| TX-03 | commit 后模拟进程退出 → 重启不重复卡 |
| TX-04 | 两 worker 处理同一项目 → CAS/锁冲突不丢不重 |
| TX-05 | 多项目一项目规则异常 → 其他项目可继续 |
| TX-06 | 1000 次无新增 Signal → P1 零写入、文件/逻辑状态稳定 |
| TX-07 | 有新 Signal 但 NO_INSIGHT → checkpoint 前进且零新 Insight |
| TX-08 | 源删除、epoch 失配、数据库回绕 → 冻结，不自动重建 |
| TX-09 | schema 迁移中途注入故障 → 无半迁移 |
| TX-10 | P0/P1 证据指针错误或外键错误 → 不生成可信卡 |
| TX-11 | 历史首次基线、迟到事件、重新启动 → 不把旧异常当新事件 |
| TX-12 | 项目删除/彻底清理 → 明确执行或 BLOCKED，不隐瞒保留 |

### 8.4 安全与性能（PF）

| 用例 | 断言 |
|---|---|
| PF-01 | 规则纯函数不访问 FS/网络/模型，也不修改 P0 数据库 |
| PF-02 | 模板参数恶意字符、超长路径等输入被截断/转义/脱敏 |
| PF-03 | 200 信号批次 n=30，p50/p95、CPU/RSS、SQLite 增量有原始证据 |
| PF-04 | 10k 混合信号及重复事件回放，结果/去重与小样本一致 |
| PF-05 | 无变化扫描不新增 P1 洞察/事件写入；不新增扫描器 |
| PF-06 | 两个真实项目只读运行；无新有效洞察也可为 PASS |
| PF-07 | 第三项目路径缺失如实 BLOCKED_PATH_UNAVAILABLE |

## 9. Gate 定义

| Gate | 判定内容 | 硬要求 |
|---|---|---|
| S2-G0 | S1.2 gate、工作区与设计审计 | **阻断型 PASS** |
| S2-G1 | RU-01..12 + 规则纯函数/证据门禁 | 全 PASS |
| S2-G2 | EP-01..10 + Episode/冲突/复发 | 全 PASS |
| S2-G3 | TX-01..12 + 事务/重放/删除 | 全 PASS；若删除策略有明确隔离的产品决策未完成，标出 BLOCKED，不可掩盖 |
| S2-G4 | Source Reset / headBinding / data safety | 全 PASS |
| S2-G5 | PF-01..05 性能、安全与零写入 | 实测+披露，未过已批准预算不得标 PASS |
| S2-G6 | 真实试点只读验证 | 2 个可用仓库 PASS；第三缺路径可条件豁免 |
| S2-G7 | 全仓回归、tsc、eslint、测试 | 全 PASS |
| S2-G8 | ADR、门禁、JSON 原始数据、Git 交接 | 全 PASS |

### 总结论

- `PASS`：S2-G0..G8 全 PASS，真实试点和性能没有未豁免阻塞。
- `CONDITIONAL_PASS`：除了第三试点缺路径及明确认可的真实大仓库环境限制之外，所有强制不变量/门禁通过；不可用条件必须逐项披露。
- `BLOCKED`：缺 S1.2 前置、跨库原子性被错误宣称、source reset 不安全、无法提供关键证据、迁移不可恢复。
- `FAIL`：误称 HEAD 回归、重复可见洞察、dismiss 重开、游标提前推进、真实仓库被修改或安全漏洞。
- 不允许以额外测试数量抵消任何硬门禁未通过。

## 10. 交付物与验收报告模板

必须生成：

1. `packages/project-insight/src/rules/**` + rules fixtures。
2. `packages/project-insight/src/episodes/**` + 状态机 golden tests。
3. `packages/project-insight/src/insights/**` + 增量 schema migrations。
4. 受控手动重放 CLI + benchmark CLI（无自动后台服务）。
5. `docs/adr/ADR-INSIGHT-003.md`：Episode key、规则版本、历史 baseline、S1.2 checkpoint 与规则 checkpoint 分离、hard delete 语义。
6. `docs/verification/insight-p1-s20-entry-audit.md`。
7. `docs/verification/insight-p1-s2-gate.md`。
8. `docs/verification/data/insight-s2-bench-<timestamp>.json`。
9. `pnpm typecheck`、`pnpm lint`（或实际项目等价命令）、`pnpm test` 原始输出摘要。
10. Commit、HEAD、工作区 dirty 列表；未纳入/未修改的 P0.5 文件单独披露。

验收报告建议：

```markdown
# S2 Gate Review
Baseline HEAD:
Implemented commits:
S1.2 prerequisite: PASS/BLOCKED + evidence
S2-G0..G8:
Rule cases RU-01..12:
Episode cases EP-01..10:
Transaction cases TX-01..12:
Perf cases PF-01..07:
P0/P1 data integrity:
Real pilot 1/2/3:
Noisiness: raw signals / candidates / visible insight count
Known blocks:
Files changed:
Final result: PASS / CONDITIONAL_PASS / BLOCKED / FAIL
```

## 11. 提交策略

- 从当前 HEAD 与 `git status` 开始，不擅自 reset/clean、修改未提交 P0.5 文件。
- 推荐按切片分别提交；先 S2.0 审计，接着规则、episode、store、gate 文档。
- 建议 Conventional Commits：
  - `feat(insight): add deterministic rule evaluation`
  - `feat(insight): implement episode lifecycle and dedup`
  - `feat(insight): persist insight decisions with rule checkpoint`
  - `test(insight): verify S2 replay and noise suppression`
- 未经明确授权不要自动 push，不要修改真实项目。

## 12. 交给 Agent 的最小执行约束

> 读取本文件并复核当前仓库。先执行 S2.0 门禁审查，若 S1.2 未完成则输出 BLOCKED_PRECONDITION 并停止 S2 功能开发。否则按 S2.1→S2.2→S2.3→S2.4 的顺序实施。每个阶段只在证据支持时标 PASS，所有规则必须用确定性 fixture 验收。保持 R-TEST-EVIDENCE-GAP 关闭、headBinding UNDETERMINED 不得被推导成当前 HEAD 回归；只读 P0，所有新写入仅进入 P1 insights.sqlite。规则结果、Episode 变化和规则游标必须同一个 SQLite 事务提交；无 Signal 时零写入；同一 dismissed episode 不重开；确证恢复后复发必须创建新 episode。不要实现 API/UI/通知/模型调用/自动测试执行。最后输出 G0..G8 逐项门禁、真实试点、原始 benchmark 与 Git/未提交文件清单。
