# CI 门禁改造说明（G1，2026-11-01）

> 配套：`docs/engineering/ci-baseline-2026-11-01.md`（改造前基线）
> 工作分支：`ops/g1-ci-gate-master`（基于 master），G0 等价同步另行 PR
> 本轮**没有**任何远端写操作：未推送、未建 PR、未改保护规则。

## 1. 改了什么

| 文件 | 变更 |
| --- | --- |
| `.github/workflows/ci.yml` | 重写。trigger 层不再过滤；G0 线纳入 push 触发；新增 `detect-changes` / `verify-windows` / `ci-gate` |
| `scripts/ci-change-detection.ts` | 新增。按真实 diff 判定 `docs-only` / `code`，失败一律偏保守 |
| `scripts/ci-gate-decision.ts` | 新增。`ci-gate` 判定规则，禁止「非成功即绿」 |
| `tests/unit/ci-change-detection.test.ts` | 新增。12 个用例 |
| `tests/unit/ci-gate-decision.test.ts` | 新增。9 个用例 |

### 缺陷 → 修复对照

| id | 缺陷 | 修复 | 佐证 |
| --- | --- | --- | --- |
| D1 | G0 合并后无 push 验证 | `push.branches: [master, bot/hearth-g0-contract]` | YAML 解析确认；G0 需放行 PR 后由真实运行复核 |
| D2 | trigger 层 `paths-ignore` 导致 required check 永久 Pending | trigger 仅剩 `push` / `pull_request` / `workflow_dispatch`，**零 `paths-ignore`**；过滤下沉到 `detect-changes` | YAML 解析：`has paths-ignore at trigger: false` |
| D3 | 无聚合 gate | 新增固定名 job `ci-gate`（`needs` 三个 job，`if: always()`） | YAML 解析输出 job 列表 |
| D4 | 无 Windows 门禁 | 新增 `verify-windows`（windows-latest，阶段一只做 typecheck / test / build，**不跑浏览器**） | YAML 解析确认 jobs 含 windows-latest |
| D5 | 取消导致静默缺档 | `ci-gate` 把 `cancelled` 判为失败 | gate 矩阵第 4 用例退出码 1 |
| D6 | 无保护、无 ruleset | **本轮不修**，属 G2 范围，且需用户批准 | 明确留到 G2 |
| D7 | 孤儿 workflow `diag / coordinator flake probe` | **本轮不动**，进入 Decision Queue 待批准 | 见治理报告 D-07 |
| D8 | CI 只覆盖 Mock 工程 | 不改，但在 `verify-linux` 注释中固化「green 不等于真实 provider 通过」的表述 | 代码注释 |

## 2. 为什么把两段逻辑做成脚本而不是内联 YAML

`ci-gate` 是整条流水线最容易出错、后果最严重的一行：它若判错，坏分支会显示成绿的。内联 bash 只能靠肉眼评审，脚本化后可以：

1. 用单元测试把「取消 / 跳过 / 未知」三种暧昧状态的判定钉死；
2. 评审时看到的是一份有类型、有测试的模块，而不是 Workflow 里缩进敏感的字符串块；
3. 以后加矩阵只改 job 列表，`ci-gate` 的规则不变。

代价是 `ci-gate` job 需要 `pnpm install`（约几十秒）。这个代价换来的是「账单式可验证」，且失败方向是**变红**而非变绿——即使安装失败，结果也是 gate red，符合安全方向。

## 3. `ci-gate` 判定规则

1. `detect-changes` 必须 `success`；否则无论下游如何，一律 red。理由：检测都失败了，就无从知道本该运行什么。
2. 每个验证 job 必须 `success`。
3. `skipped` **仅当** `skip-heavy=true`（已判定纯文档）才允许；代码改动下出现 skipped，说明 job 矩阵配错，判 red。
4. `cancelled` 判为失败。取消什么都没证明，把它当良性就是「红 PR 从检查列表里消失」而不是被修好的原因。
5. 任何无法识别的结果判为失败。**安全方向恒为 red。**

## 4. 本地已验证矩阵（真实输出见 `handoff/EVIDENCE/g1-*`）

### 4.1 gate 判定矩阵（`scripts/ci-gate-decision.ts`，退出码 0=绿 / 1=红）

| 用例 | detect | linux | windows | skip-heavy | 期望 | 实测退出码 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 纯文档 PR | success | skipped | skipped | true | 绿 | 0 | ✅ |
| 代码 PR 全绿 | success | success | success | false | 绿 | 0 | ✅ |
| 代码 PR linux 失败 | success | failure | success | false | 红 | 1 | ✅ |
| windows 被取消（D5） | success | success | cancelled | false | 红 | 1 | ✅ |
| 代码 PR 却被跳过 | success | skipped | skipped | false | 红 | 1 | ✅ |
| 检测失败 | failure | success | success | true | 红 | 1 | ✅ |
| 检测被取消 | cancelled | success | success | true | 红 | 1 | ✅ |
| 未知结果 `oops` | success | oops | success | false | 红 | 1 | ✅ |
| 输入全空 | (空) | (空) | (空) | (空) | 红 | 1 | ✅ |

**9/9 通过。**

### 4.2 变更检测矩阵（`scripts/ci-change-detection.ts`）

| 用例 | 输入 | mode | reason |
| --- | --- | --- | --- |
| 纯文档分支真实 diff（G0 审计分支 vs master） | `docs/engineering/*.md` | `docs-only` | `all-documents` |
| 单文件 README.md | `README.md` | `docs-only` | `all-documents` |
| 源码文件 | `apps/web/src/App.tsx` | `code` | `code-changed` |
| workflow 自身改动 | `.github/workflows/ci.yml` | `code` | `verification-tooling-changed` |
| 依赖/编译配置改动 | `pnpm-lock.yaml` 等 8 类 | `code` | `verification-tooling-changed` |
| diff 不可读 / 空 | (空) | `code` | `unknown-diff-conservative` |

单元测试另覆盖：任意深度 `.md` 算文档、工具链优先于代码作为归因、40 文件路径回显截断为 10 条。

### 4.3 仓库既有检查

- `pnpm typecheck`：通过（0 错误）。
- `pnpm lint`：0 error；6 条 warning **全部为改动前既有**（`packages/*` 与 `scripts/register-observer-pilots.ts` 的未使用变量），本分支新增文件未产生任何新告警。
- `pnpm test`：**44 test files passed / 363 passed / 1 skipped / 0 failed**，退出码 0。其中 2 个文件（`tests/unit/ci-change-detection.test.ts` 12 例、`tests/unit/ci-gate-decision.test.ts` 9 例）为本轮新增。**未改动任何既有测试的断言**。证据：`handoff/EVIDENCE/g1-full-unit-test.txt`。
- YAML 结构化校验：解析通过，并核对 `triggers`、`push.branches`、`permissions=contents: read`、job 依赖与 `if` 条件、无 `pull_request_target`。

## 5. 诚实标注：哪些还没验证

以下必须在真机上验证，本地无法替代，**且都需要你批准推送后才能发生**：

| 待验项 | 为什么本地做不到 | 验证方式 |
| --- | --- | --- |
| G0 `push` 是否真的产生 check-run | 需要向 G0 推送或合并 | 合并后 `GET /commits/<G0_HEAD>/check-runs` ≠ 0 |
| Windows runner 是否真能跑通 | 本地 Windows ≠ `windows-latest` 镜像 | 观察 `verify-windows` 真实结论 |
| `ci-gate` 是否可作为 required check | 需先写入保护规则（G2，待批准） | 设为必需后开一个纯文档 PR，确认从 Expected 变绿 |
| `tsx` 在 Actions 环境可用 | 本地有 root devDependency，CI 依赖 `--frozen-lockfile` 安装成功 | 观察 `detect-changes` 步骤 |

`docs-only → 跳过 → gate 绿` 这条链路本地已完成端到端（用例 1），但对 GitHub 而言「是否存在检查」与「是否变绿」是两件事：前者靠 trigger 保证，本改造已消除 trigger 过滤；后者需真实运行才能确认。

## 6. 保持的约束

- 未引入 `pull_request_target`。
- `permissions: contents: read` 未提升。
- 全部 action 仍固定到 SHA。
- `verify-linux` 保持 mock-only：`HEARTH_ANALYSIS_PROVIDER=mock`、`HEARTH_PI_BIN` 指向不存在路径。
- 未触碰 Hearth 的 Agent 授权边界：本次只改 CI 外壳，未修改任何 `risk/approved/completed` 决策逻辑、未放宽审计日志、未新增外部副作用路径。

## 7. 有意不做的事（留痕）

- **不开 macOS job**。Mac runner 分钟数成本高、收益低；本轮的收益来自 Windows 与 gate 语义，不是把矩阵再拉宽一倍。若需要可在后续独立 PR 追加。
- **Windows 不跑浏览器 E2E**。分阶段：先建立 typecheck/test/build 的稳定性记录，再单独评估 Windows E2E。一次性全开会引入不可归因的 flaky。
- **不改 G0 上的 `ci.yml`**。按交接文档要求，master 与 G0 各自独立 PR、独立验证，本 PR 只针对 master。
