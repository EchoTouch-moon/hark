# 分支保护配置单（G2，2026-11-01）——**拟定，未应用**

> 状态：**NOT APPLIED · 最终配置已锁定，等待你的明确确认**。本文件里所有写命令都未被执行。
> 配套：`docs/engineering/ci-gate-refactor-2026-11-01.md`（G1，`ci-gate` 状态名的来源）
> 前置条件：G1 已合并验收通过（见下方第 1 节三张真机证据表），`ci-gate` 名字稳定。

## 1. 前置条件：三件，均已满足（2026-11-01 更新）

保护规则一旦开启，**写代码的人（包括这台机器上的 agent）也会被同一个规则挡住**。所以当初列了三条前置条件，现已逐条用真机运行兑现：

| # | 前置条件 | 兑现证据 |
| --- | --- | --- |
| 1 | `ci-gate` 名字不再改 | #20、#21 已合并并稳定运行，检查名实测就是 `ci-gate` |
| 2 | 它在**两条线**上都真的跑过并变绿 | master push [#62](https://github.com/EchoTouch-moon/hark/actions/runs/41299786155)、G0 push [#63](https://github.com/EchoTouch-moon/hark/actions/runs/41300110831)，四作业全 success |
| 3 | 纯文档 PR 能走到绿色 `ci-gate`（而非永久 Pending） | PR [#22](https://github.com/EchoTouch-moon/hark/pull/22)：日志 `mode=docs-only reason=all-documents`，Linux/Windows **skipped**，`ci-gate` **pass 19s** |

第 3 条是当初最担心的一条：改造前纯文档 PR 完全没有 run，一旦设为必需检查会永远停在 Expected。现在它变成了「有检查、且快速变绿」，**启用必需检查的最后一块障碍已经清除**。

配套的反例也已验证：PR #23（文档 + 一行源码注释）日志为 `mode=code reason=code-changed`，Linux 1m18s / Windows 2m1s 实际执行——混合改动不会被误判成纯文档而跳过检查。

**即便如此，本文件里的写命令仍未执行。** 启用保护规则属于「会挡住写代码的人」的不可逆感操作，仍需单独批准（决策队列 D-04）。

## 2. 已确认的事实（本次实取，非假设）

| 项 | 实取值 | 命令 |
| --- | --- | --- |
| 仓库可见性 | public | `gh api repos/EchoTouch-moon/hark --jq .visibility` |
| 所有者类型 | `User`（个人账号，非组织） | `gh api users/EchoTouch-moon --jq .type` |
| 套餐 | **`plan` 字段为 null** | `gh api user --jq .plan` |
| 令牌对该仓权限 | `admin=true, maintain=true, push=true` | `gh api repos/EchoTouch-moon/hark --jq .permissions` |
| 现有 rulesets | **空数组** | `gh api repos/EchoTouch-moon/hark/rulesets` |
| `master` 保护 | **HTTP 404 Branch not protected** | `gh api repos/EchoTouch-moon/hark/branches/master/protection` |
| `bot/hearth-g0-contract` 保护 | **HTTP 404 Branch not protected** | 同上，分支名 URL 编码 |
| 必需检查名（实测） | **`ci-gate`** | run #62 / #63 / #22 / #23 的检查名 |
| Actions app id（实测） | **`15368`** | master check-run 返回 `app={id:15368, slug:github-actions}` |

**关于「个人公开仓库能不能用 Rulesets」**：`plan` 返回 null，按 GitHub 的表现对应 Free 方案。Rulesets 对公开仓库的能力与私有仓库不同，**而 available 与否的最终判据只有一条：真正执行写入时 API 返回什么**。本轮**没有**执行写入，因此**不声称任何规则已启用**。

应对方式：先写 Rulesets（§5.1），若 API 返回 403/404 则回退到 classic branch protection（§5.5）。注意两者并非完全等价——见 §5.5 对 classic 局限的说明与 §9 未决项。

## 3. 推荐配置（最终锁定版，对应你的 6 条要求）

| 你的要求 | 本方案落点 |
| --- | --- |
| 唯一必需检查 = `ci-gate`，绑定 App ID `15368` | §5.1 ruleset 的 `required_status_checks`，`context=ci-gate`、`integration_id=15368` |
| 必须通过 PR 合并 | `pull_request` 规则（必需），`required_approving_review_count=0` |
| 禁止删除 | `deletion` 规则 |
| 禁止强推 | `non_fast_forward` 规则 |
| 单人 + 编码 Agent，暂不强制他人审批 | `required_approving_review_count=0`（仍强制走 PR，但不要求第二人 approve） |
| 先 master 验证，再 G0；启用前提交配置与回退、等待确认 | §6 执行序列 + §5.3/§5.4 禁用与回退 + 状态仍为「NOT APPLIED」 |

### 3.1 两条线的共同项

| 规则 | 值 | 理由 |
| --- | --- | --- |
| 要求先有 PR（`pull_request` 必需，approvals = **0**） | 开启，**批准数 0** | 目标是把直推主干这条路堵掉，而不是要求第二个人。这是单人仓库：若写 `required_approving_review_count > 0`，唯一有权限的人就是你自己 approve 自己——GitHub 默认也不允许自己审自己的 PR，会把自己锁死 |
| 必需状态检查 | `ci-gate`（严格模式：分支须与基线同步） | G1 的产物。只列这一个名字，以后加 job 不必改保护配置 |
| 禁止删除 | 开启 | G3 要清理历史分支，但这是**有意、逐项批准**的动作，不该由误操作完成 |
| 禁止强推 | 开启 | 同上；历史 PR 里 SHA 被多处引用，一次 force push 会让所有审计证据失效 |
| 绕过名单 | **不配置任何 bypass actor**（最终决策，见 §3.2） | `bypass_actors` 显式为空。仓库管理员的应急出路是「编辑/暂停 ruleset 本身」，该动作进审计日志、可事后追责 |
| 必需检查是否「严格」（`strict_required_status_checks_policy`） | **true** | 要求分支与基线同步后再判定。代价：#12、#15 两个 draft 长期不 rebase 会一直卡在「未与基线同步」，见第 4 节 |

### 3.2 两条线的最终决策：配置完全一致，仅执行顺序有先后

| 项 | 决策 |
| --- | --- |
| 配置内容 | **master 与 G0 完全一致**：要求 PR 合并、`ci-gate` 为唯一必需检查（app id `15368`）、禁止删除、禁止强推、审批数 0 |
| 执行顺序 | **先 master，验证通过后再 G0**（见 §6 的执行序列）。不并行、不一次全上 |

关于「禁止删除」的澄清：这里的 `deletion` 规则**只禁止删除受保护的主线本身**（master / G0），
**不影响** G3 清理历史 feature 分支（那些分支不受本规则覆盖）。所以 master 与 G0 都应开 `deletion`，无需为此留例外。

关于「绕过」的最终决策：**不配置任何 bypass actor**。仓库管理员（也就是你）在紧急情况下的出路是
「编辑 / 暂停该 ruleset 本身」，而这个动作会进审计日志、可事后追责。比留一个静默绕过更符合本仓库
「append-only 审计」的取向。

## 4. 开启前必须先处理的影响面

开启必需检查会立刻作用于**已存在的开放 PR**，这些 PR 现在挂在 quote-start / 旧 head 上：

| PR | base | 现状 | 开启后的影响 |
| --- | --- | --- | --- |
| #12 | G0 | draft，`ahead=20 / behind=9`（相对新 G0 `b2b70c27`） | 需要 rebase 并重跑；`strict` 模式下不 rebase 会一直判「未与基线同步」→ 无法合并 |
| #15 | G0 | draft，`ahead=1 / behind=9`（相对新 G0 `b2b70c27`） | 成本较低，建议先 rebase 到 `b2b70c27` 再谈 |
| #1 #3 #4 | master | open | #4 内容已在 G0，#5 为 CONFLICTING；开启后这些 PR 的 red/conflict 状态会变成显式的合并阻塞项，反而更清楚 |
| #6 | `codex/ember-narrative-motion` | open，base 是另一条分支 | **不受影响**——保护规则只配在 `master` 和 G0 上 |

结论：开启前先把 #12、#15 两个 draft 的目标说清楚（继续 / rebase / 关闭），否则它们会长期挂在「无法合并」状态，看起来像被遗忘，实际是被规则挡住。这属于决策，不是执行，放进 Decision Queue。

## 5. 待批准才执行的命令（本轮未运行任何一条）

### 5.0 配置模板（惰性文件，GitHub 不会自动应用）

两个 JSON 是唯一事实来源，随本 PR 入库、可评审、可版本化：

- `.github/rulesets/protect-master.json`
- `.github/rulesets/protect-g0.json`

⚠ **重要**：GitHub **不会**扫描 `.github/rulesets/` 目录自动生效。规则只有通过 §5.1 的显式 `POST` 才会创建。
这两个文件只是模板；其结构、目标范围与双线一致性由本地只读脚本 `scripts/validate-rulesets.ts` 校验（见 §5.2）。

### 5.1 创建（Rulesets 首选）

```bash
# ⛔ 需要批准后才执行 —— 阶段 A（先 master）
gh api --method POST repos/EchoTouch-moon/hark/rulesets --input .github/rulesets/protect-master.json

# ⛔ 阶段 A 验证通过后 —— 阶段 B（G0）
gh api --method POST repos/EchoTouch-moon/hark/rulesets --input .github/rulesets/protect-g0.json
```

每条命令成功后，把返回体里的 `id` 记下来（禁用与回退都要用）。
两条线的 JSON 只有 `name` 与 `conditions.ref_name.include` 不同，其余字段逐字节一致（§5.2 脚本会再验证）。

### 5.2 只读验证（不写任何东西）

```bash
# 1) 列出当前全部 ruleset
gh api repos/EchoTouch-moon/hark/rulesets --jq '.[] | "\(.id)\t\(.name)\t\(.enforcement)"'

# 2) 读单个 ruleset（用创建时返回的 id）
gh api repos/EchoTouch-moon/hark/rulesets/<id>

# 3) 本地只读校验模板（结构 / 覆盖范围 / 双线一致性；不联网、不写）
pnpm exec tsx scripts/validate-rulesets.ts
```

第 3 步只读两个本地 JSON，检查：JSON 结构与 `target=branch`、`enforcement=active`、
目标分支**精确匹配**（拒绝 `~DEFAULT_BRANCH` 与通配）、四条规则参数、`context=ci-gate` +
`integration_id=15368`、审批数 0、`bypass_actors` 为空，以及 master 与 G0 规则语义一致。
该脚本有单元测试覆盖（`tests/unit/ruleset-schema.test.ts`，含正例与反例）。

### 5.3 禁用（软回退，不删规则）

```bash
# 暂停但不删除：只把 enforcement 改成 disabled。PATCH 仅改这一个字段。
printf '{"enforcement":"disabled"}' | gh api --method PATCH \
  repos/EchoTouch-moon/hark/rulesets/<id> --input -
```

禁用后规则仍在，随时 PATCH 回 `"enforcement":"active"` 重新启用，比删除温和。

### 5.4 完整回退（删除，精确到单个 id）

```bash
# 先列出确认 id（不要凭记忆）
gh api repos/EchoTouch-moon/hark/rulesets --jq '.[] | "\(.id)\t\(.name)"'

# 只删除本方案创建的那一个 ruleset 的 id
gh api --method DELETE repos/EchoTouch-moon/hark/rulesets/<该 ruleset 的 id>
```

⚠ 回退只删 **`protect-master` / `protect-g0`** 两个、用创建时记录的具体 id。
**绝不**用「遍历全部 ruleset 逐个 DELETE」的写法——那会误删未来可能存在的其他 ruleset。

### 5.5 备用方案：classic branch protection（仅当 §5.1 返回 403/404 时）

先说明它的局限：classic 的 `required_pull_request_reviews` 把「要求 PR」与「要求审批」绑在一起，
无法像 ruleset 那样干净表达「必须走 PR 但 0 审批」。所以退到此方案时，PR 门槛的语义会退化，
属于需要你拍板的问题（见 §9 未决项）。

```bash
# ⛔ 需要批准后才执行 —— 完整 JSON 请求体（master）
gh api --method PUT repos/EchoTouch-moon/hark/branches/master/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [ { "context": "ci-gate", "app_id": 15368 } ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

G0 同理，把 URL 里的 `master` 换成 `bot%2Fhearth-g0-contract`（分支名中的 `/` 需 URL 编码）。
回退 classic：`gh api --method DELETE repos/EchoTouch-moon/hark/branches/master/protection`（以及 G0 的同名端点）。

### 5.6 JSON 字段与 GitHub API Schema 对照（校验结果）

下列字段经 GitHub REST API 文档（`POST /repos/{owner}/{repo}/rulesets`）逐项核对：

| 字段 | 类型 | 必填 | 本方案值 | 结论 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | `protect-master` / `protect-g0` | ✅ |
| `target` | `branch` \| `tag` \| `push` | 是 | `branch` | ✅ |
| `enforcement` | `disabled` \| `active` \| `evaluate` | 是 | `active` | ✅ |
| `bypass_actors` | array | 否（默认空） | `[]` | ✅ 显式空，无绕过 |
| `conditions.ref_name.include` | string[] | 是 | `["refs/heads/<branch>"]` 精确匹配 | ✅ 无通配 |
| `conditions.ref_name.exclude` | string[] | 否 | `[]` | ✅ |
| `rules[].type` | string enum | 是 | `pull_request` / `required_status_checks` / `non_fast_forward` / `deletion` | ✅ |
| `pull_request.parameters.required_approving_review_count` | integer | 是 | `0` | ✅ |
| `pull_request.parameters.dismiss_stale_reviews_on_push` | boolean | 是 | `true` | ✅ |
| `pull_request.parameters.require_code_owner_review` | boolean | 是 | `false` | ✅ |
| `pull_request.parameters.require_last_push_approval` | boolean | 是 | `false` | ✅ |
| `pull_request.parameters.required_review_thread_resolution` | boolean | 是 | `false` | ✅ |
| `required_status_checks.parameters.required_status_checks[].context` | string | 是 | `ci-gate` | ✅ |
| `required_status_checks.parameters.required_status_checks[].integration_id` | integer | 否 | `15368` | ✅ 绑定 Actions |
| `required_status_checks.parameters.strict_required_status_checks_policy` | boolean | 是 | `true` | ✅ |
| `deletion` / `non_fast_forward` | 无参数独立规则 | 是（各自独立列出） | 两者单独列出 | ✅ |

`pull_request` 的 5 个参数在 Schema 中均为 required，本方案已全部给出。审批数为 0 时，
`dismiss_stale_reviews_on_push` / `require_code_owner_review` / `require_last_push_approval` 对当前配置是惰性的，
但必须传以通过 schema 校验——它们只在将来把审批数调成 >0 时才会起作用。

## 6. 执行序列与验证清单（先 master，后 G0）

**总原则：两步走，绝不一次全上。** 先在 master 上把「规则 + 正常 PR 流程」跑通，确认没有把自己锁在门外，再对 G0 重复。

### 阶段 A：master

按序执行，任一步失败就停：

1. 写 master ruleset → 记录返回 HTTP 状态。**403 表示当前套餐不支持**，转 §5.2 classic；**201/200 表示成功**。
2. `gh api repos/EchoTouch-moon/hark/rulesets` 确认规则存在、`conditions.ref_name.include` 精确命中 `refs/heads/master`（不是 `~DEFAULT_BRANCH`、不含通配）。
3. 开一个**正常功能 PR → master**，确认 `ci-gate` 出现、变绿、合并按钮可用（证明没把自己锁死）。
4. 建一个**故意失败**的 PR，确认 `ci-gate` 变红且合并按钮被挡。
5. 尝试 `git push --force-with-lease` 与直接 `git push` 到 master，确认均被拒。
6. 到 Settings → Rules 人工复核一次。

**只有阶段 A 全部通过，才进入阶段 B。**

### 阶段 B：G0

对 `bot/hearth-g0-contract` 重复同一 ruleset（`conditions` 改为包含该分支），并重复步骤 2–6。
因为 #12 / #15 两个 draft 挂在 G0 上，阶段 B 开始前先确认它们的处置（见 §4），避免它们被 `strict` 模式卡成「长期无法合并」的观感。

### 验收判据（阶段 A / B 通用，不做步骤，只做判据）

- 只读脚本 `pnpm exec tsx scripts/validate-rulesets.ts` 输出两行 OK 且「语义一致 = YES」。
- 纯文档 PR 的 `ci-gate` 变**绿**而非停在 Expected（这是 D2 的唯一真机判据，已在 #22 / #24 复验）。
- 故意失败 PR 的 `ci-gate` 变**红**、合并按钮被挡。
- 直接 `git push` 与 `git push --force-with-lease` 到受保护主线都被拒。
- Settings → Rules 页面与 API 返回一致（API 成功不等于 UI 符合预期）。

只有全部满足，才叫「保护规则」而不是「保护阻碍」。

## 7. 已知风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 把自己锁在门外 | 单人仓库 + `strict` 必需检查 | 不配 bypass actor；管理员应急出路是「编辑/暂停 ruleset 本身」（进审计日志）。若担心，可先以 `enforcement: evaluate` 影子模式跑一轮再切 `active` |
| G0 被两块规则同时覆盖 | Rulesets 与 classic protection 可以叠加 | 只用一种机制，避免语义冲突 |
| 必需检查名漂移 | 若 G1 再改 job 名，保护配置会指空导致永久 Pending | Todo-check 名固定为 `ci-gate`，改动需走同一 PR 同步更新保护配置 |
| 历史 draft PR 长期阻塞 | #12 #15 挂着 | 见第 4 节，需先决策 |
| **CI green 被误读为安全通过** | 这是最需要写下来的一条 | `ci-gate` 只证明「Mock 工程在 Linux/Windows 上类型正确、测试通过、能构建」。它**不**证明安全入口、跨项目隔离或 H1 真实项目价值验收通过。保护规则强度再高，也不改变这个覆盖边界 |

## 8. 本轮边界

未执行任何写命令。截至本文件生成：`rulesets=0`，`protected=0`，`deleted=0`，`closed=0`，`merged=0`。

**这就是最终方案。** 是否进入 §6 阶段 A（在 master 上启用），等你一句明确的「开始执行 G2」。
在那之前，我不会写入任何 ruleset、不会开 classic protection、也不会改仓库的任何设置。


## 9. 未决项（需要你决定）

1. **Rulesets 可用性尚未实测**。仓库 `plan` 字段为 null（个人 Free 倾向），rulesets 对公开仓库的能力
   需在真正 `POST` 时才见分晓。若返回 403/404 才走 §5.5 classic，此时「必须 PR 但 0 审批」无法干净表达，
   需要你在「退化为要求 ≥1 审批」与「退化为只保留状态检查 + 禁删禁强推（放弃强制 PR）」之间选一个。
2. **`deletion` 的语义确认**：只禁止删除受保护的 master / G0 本身，不影响 G3 清理 feature 分支。
3. **#12 / #15 两个 G0 draft 的处置**：进入阶段 B 前需先定（rebase / 继续 / 关闭），否则会被 `strict` 卡成「长期无法合并」。
4. **`dismiss_stale_reviews_on_push=true` 在 0 审批下是惰性的**：当前无影响，仅当未来审批数调 >0 才生效，保持为 true 是否认可。
