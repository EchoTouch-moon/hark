# 分支保护配置单（G2，2026-11-01）——**拟定，未应用**

> 状态：**NOT APPLIED**。本文件里所有写命令都未被执行。
> 配套：`docs/engineering/ci-gate-refactor-2026-11-01.md`（G1，`ci-gate` 状态名的来源）
> 前置条件：G1 在两条线上都已合并、稳定运行，且 `ci-gate` 名字不再变动。

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

应对方式：命令里先写 Rulesets，若返回 403/404 则回退到 classic branch protection（第 6 节）。两者在本场景要达成的效果一致，不需要为此争论。

## 3. 推荐配置

### 3.1 两条线的共同项

| 规则 | 值 | 理由 |
| --- | --- | --- |
| 要求先有 PR（`pull_request` 必需，approvals = **0**） | 开启，**批准数 0** | 目标是把直推主干这条路堵掉，而不是要求第二个人。这是单人仓库：若写 `required_approving_review_count > 0`，唯一有权限的人就是你自己 approve 自己——GitHub 默认也不允许自己审自己的 PR，会把自己锁死 |
| 必需状态检查 | `ci-gate`（严格模式：分支须与基线同步） | G1 的产物。只列这一个名字，以后加 job 不必改保护配置 |
| 禁止删除 | 开启 | G3 要清理历史分支，但这是**有意、逐项批准**的动作，不该由误操作完成 |
| 禁止强推 | 开启 | 同上；历史 PR 里 SHA 被多处引用，一次 force push 会让所有审计证据失效 |
| 绕过名单 | **留空**，或仅给 repository admin 且 `bypass_mode: always` | 留空最安全。若给 admin 绕过，则每次绕过都会写审计日志，是可事后追责的；但没有绕过意味着真正紧急时也只能走正常流程 |
| 必需检查是否「严格」（`strict_required_status_checks_policy`） | **true** | 要求分支与基线同步后再判定。代价：#12、#15 两个 draft 长期不 rebase 会一直卡在「未与基线同步」，见第 4 节 |

### 3.2 两条线的差异

| 分支 | 额外要求 | 理由 |
| --- | --- | --- |
| `master` | 无 | 发布基线 |
| `bot/hearth-g0-contract` | 同样开启，但**在 G3 的分支清理批准之前，暂缓开启「禁止删除」** | G0 是当前事实上的集成主线，G5 的收敛设计还在进行；过早锁死删除会让 staging integration 失去回旋余地 |

## 4. 开启前必须先处理的影响面

开启必需检查会立刻作用于**已存在的开放 PR**，这些 PR 现在挂在 quote-start / 旧 head 上：

| PR | base | 现状 | 开启后的影响 |
| --- | --- | --- | --- |
| #12 | G0 | draft，`ahead=20 / behind=9`（相对新 G0 `b2b70c27`） | 需要 rebase 并重跑；`strict` 模式下不 rebase 会一直判「未与基线同步」→ 无法合并 |
| #15 | G0 | draft，`ahead=1 / behind=9`（相对新 G0 `b2b70c27`） | 成本较低，建议先 rebase 到 `b2b70c27` 再谈 |
| #1 #3 #4 | master | open | #4 内容已在 G0，#5 为 CONFLICTING；开启后这些 PR 的 red/conflict 状态会变成显式的合并阻塞项，反而更清楚 |
| #6 | `codex/ember-narrative-motion` | open，base 是另一条分支 | **不受影响**——保护规则只配在 `master` 和 G0 上 |

结论：开启前先把 #12、#15 两个 draft 的目标说清楚（继续 / rebase / 关闭），否则它们会长期挂在「无法合并」状态，看起来像被遗忘，实际是被规则挡住。这属于决策，不是执行，放进 Decision Queue。

## 5. 待批准才执行的命令（**本轮未运行任何一条**）

### 5.1 Rulesets（首选）

`master`：

```bash
# ⛔ 需要批准后才执行
gh api --method POST repos/EchoTouch-moon/hark/rulesets \
  -f name="protect-master" \
  -f target=branch \
  -f enforcement=active \
  -f 'conditions[ref_name][include][]'='~DEFAULT_BRANCH' \
  -f 'conditions[ref_name][exclude][]'='refs/heads/bot/**' \
  -f 'rules[][type]'=deletion \
  -f 'rules[][type]'=non_fast_forward \
  -f 'rules[][type]'=pull_request \
  -f 'rules[][type]'=required_status_checks \
  -f 'rules[][parameters][required_status_checks][][context]'=ci-gate \
  -f 'rules[][parameters][required_status_checks][][integration_id]'=15368 \
  -f 'rules[][parameters][strict_required_status_checks_policy]'=true \
  -f 'rules[][parameters][dismiss_stale_reviews_on_push]'=true \
  -f 'rules[][parameters][require_code_owner_review]'=false \
  -f 'rules[][parameters][require_last_push_approval]'=false \
  -f 'rules[][parameters][required_approving_review_count]'=0
```

`bot/hearth-g0-contract`（同样内容，`conditions` 改为包含该分支，且先不含 `deletion`）：

> `integration_id=15368` 用于把必需检查绑定到 GitHub Actions,而不是任意第三方上报的同名 check——少了这一项,同名检查可被外部伪造,不建议去掉。该值已**在本仓库实取确认**:现有 master check-run 返回 `app={'id': 15368, 'slug': 'github-actions'}`。复核命令:
> `gh api repos/EchoTouch-moon/hark/commits/79fa67e0.../check-runs --jq '.check_runs[] | {name, app_id: .app.id, app_slug: .app.slug}'`

### 5.2 回退方案 A：改用 classic branch protection

```bash
# ⛔ 需要批准后才执行
gh api --method PUT repos/EchoTouch-moon/hark/branches/master/protection \
  -f 'required_status_checks[strict]'=true \
  -f 'required_status_checks[contexts][]'=ci-gate \
  -f 'required_pull_request_reviews[dismiss_stale_reviews]'=true \
  -f 'required_pull_request_reviews[required_approving_review_count]'=0 \
  -f 'enforce_admins'=true \
  -f 'allow_force_pushes'=false \
  -f 'allow_deletions'=false
```

### 5.3 回退方案 B：整体撤销

```bash
# ⛔ 需要批准后才执行
gh api repos/EchoTouch-moon/hark/rulesets --jq '.[] | "\(.id)\t\(.name)"'
gh api --method DELETE repos/EchoTouch-moon/hark/rulesets/<id>
# classic 版本：
gh api --method DELETE repos/EchoTouch-moon/hark/branches/master/protection
```

## 6. 应用时的验证清单

按序执行，任一步失败就停：

1. 写 ruleset → 记录返回的 HTTP 状态。**403 表示当前套餐不支持该能力**，转 5.2；**201 表示成功**。
2. `gh api repos/EchoTouch-moon/hark/rulesets` 确认规则存在、`targets` 命中预期分支。
3. `gh api repos/EchoTouch-moon/hark/branches/master/protection` 确认不再是 404。
4. 建一个**纯文档 PR**，确认 `ci-gate` 出现并变**绿**（这是 D2 是否真修好的唯一真机判据）。
5. 建一个**故意失败**的 PR，确认 `ci-gate` 变**红**且合并按钮被挡住。
6. 尝试 `git push --force-with-lease` 到 master，确认被拒。
7. 到 Settings → Rules 页面人工复核一次：API 成功不等于 UI 显示符合预期。

只有第 4 步变绿，才能说「保护规则」而不是「保护阻碍」。

## 7. 已知风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 把自己锁在门外 | 单人仓库 + `strict` 必需检查 | 保留 Token 的 admin 权限；`enforce_admins=true` 时管理员也被管——若不想被自己制定的规则挡住，需显式决定是否启用该字段，二选一：安全 or 便利 |
| G0 被两块规则同时覆盖 | Rulesets 与 classic protection 可以叠加 | 只用一种机制，避免语义冲突 |
| 必需检查名漂移 | 若 G1 再改 job 名，保护配置会指空导致永久 Pending | Todo-check 名固定为 `ci-gate`，改动需走同一 PR 同步更新保护配置 |
| 历史 draft PR 长期阻塞 | #12 #15 挂着 | 见第 4 节，需先决策 |
| **CI green 被误读为安全通过** | 这是最需要写下来的一条 | `ci-gate` 只证明「Mock 工程在 Linux/Windows 上类型正确、测试通过、能构建」。它**不**证明安全入口、跨项目隔离或 H1 真实项目价值验收通过。保护规则强度再高，也不改变这个覆盖边界 |

## 8. 本轮边界

未执行任何写命令。截至本文件生成：`rulesets=0`，`protected=0`，`deleted=0`，`closed=0`，`merged=0`。
