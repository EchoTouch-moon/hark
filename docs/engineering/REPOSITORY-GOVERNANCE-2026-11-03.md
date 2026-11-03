# Repository governance: current development entry (2026-11-03)

> Status: review proposal, not a Gate approval, merge instruction, or permission to run agents. Verify remote GitHub state before using any snapshot below. All dates in Asia/Shanghai (UTC+08).

## One-minute navigation

- **Public default branch**: `master`. This is not automatically the freshest product integration line.
- **Current product integration line**: `bot/hearth-g0-contract` (observed at `e62f57d00a26ba6fd034be82a2daf97e77926b3a` after PR #34 merged). It is the proposed starting point for scoped G1 work, not a declaration that G0/G1 passed.
- **Branch relationship**: GitHub compare returned `diverged`; from `master` to G0: 109 commits ahead, 25 behind (snapshot, not a patch application recipe). Preserve both lines. Do not merge, rebase, force push, or change the default branch without a separate reviewed plan, overlap inventory, and explicit owner decision.
- **Gate truth**: G0 contract `CONDITIONAL_PASS` pending revised review; G1-A `IN_PROGRESS / NOT_PASSED`; G1-B / G1-C `BLOCKED`; H1 user-value `NOT_MEASURED`. Successful CI is **not** a Gate PASS.
- **Latest verified slice**: PR [#34](https://github.com/EchoTouch-moon/hark/pull/34) merged into G0 at `e62f57d`; its scoped thread/chat and old Action fail-closed work had `TARGETED_P1_PASS`, with post-merge [CI 41585596367](https://github.com/EchoTouch-moon/hark/actions/runs/41585596367) successful. This does not prove full project authorization, restart recovery, or complete G1-A.

## Document precedence and status

1. **Security and live restrictions**: `AGENTS.md`, `docs/05-SECURITY.md`, server-side contracts, and verified tests. An old product narrative never overrides them.
2. **Current intended product direction** (contract is still under review): `docs/mvp/00-START-HERE.md`, `docs/mvp/01-PRODUCT-CONTRACT.md`, `docs/mvp/g0/02-contract-and-decisions.md`, and `docs/mvp/g0/05-dual-track-and-viewmodel.md`. The latter explicitly refines the older linear gate plan. Do not mark proposed features as implemented.
3. **Current runtime capability**: `README.md`, `README-dev.md`, code under `apps/` + `packages/`, and CI. Actual evidence must be tied to an exact commit, target platform and test scope.
4. **Tasks, approvals, and evidence**: [Issue #36](https://github.com/EchoTouch-moon/hark/issues/36) indexes current scoped tasks; the individual Issue is the work boundary, not an implementation approval. GitHub PR state, commit, checks and reviews are engineering facts. Notion holds mirrored gate/decision context with verification timestamps and cannot silently change GitHub.
5. **Historical/reusable assets only**: root `00-START-HERE.md`, `RUN-TONIGHT.md`, `tasks/manifest.json`, `tasks/progress.json`, old `handoff/` diary entries, previous `STYLE-BIBLE-*`, screenshots and design prototypes. These may contain pre-pivot goals (e.g. automated execution, "添柴", or chat-count heat). They are **not** instructions to restore them.

`NARRATIVE.md` sets presentation intent, not authorization, objective project facts, or proof of a running feature. If two active documents conflict, record the conflict in a review Issue; do not silently choose a less restrictive reading.

## Live feature boundary: what exists / what does not

| Area | Current supported fact | Scope / remaining work |
| --- | --- | --- |
| Observer | Local read-only Git / explicitly configured JUnit observation | No automatic running of user project tests |
| Insight | Deterministic observation -> signals -> insights with checkpoint/recovery | No guarantee of an AI-produced opinion |
| Analysis | Manual preview-and-confirm Pi path, default Mock | Not a code audit; external model request needs explicit configuration and privacy review |
| Chat | Global Mock demonstration continues | Project-scoped chat is temporarily fail-closed until trusted project/thread binding is designed and reviewed |
| Frontend | React experience, flame/Story assets and a G0 ViewModel contract | End-to-end truthful project-lifecycle narrative/UX and value validation incomplete |
| Research / durable Opinion | Contracts, examples and experimental PoCs | No autonomous public research / durable Opinion revision loop deployed as the intended MVP |

Read [README](../../README.md) for concrete startup and privacy boundaries, not this document as a substitute for runtime tests.

## Open PR inventory (triage only; no implied merge/close)

| PR | Type | Recommended handling |
| --- | --- | --- |
| [#1](https://github.com/EchoTouch-moon/hark/pull/1), [#4](https://github.com/EchoTouch-moon/hark/pull/4), [#5](https://github.com/EchoTouch-moon/hark/pull/5) | Earlier visual implementation / narrative | Preserve for Q-02 per-file reuse; do not merge old whole-page behavior |
| [#3](https://github.com/EchoTouch-moon/hark/pull/3) | Older backend G3 empty-hearth fix | Q-02 checks overlap with G0; no blind cherry-pick |
| [#6](https://github.com/EchoTouch-moon/hark/pull/6) | Product pivot/contract | Confirm supersession and reusable text, do not equate Draft with approved gate |
| [#12](https://github.com/EchoTouch-moon/hark/pull/12) | DeepSeek architecture research | Independent review input; not an implemented feature |
| [#15](https://github.com/EchoTouch-moon/hark/pull/15) | Offline presentation-eligibility PoC | Review under [#47](https://github.com/EchoTouch-moon/hark/issues/47); not a release/real research approval |
| [#31](https://github.com/EchoTouch-moon/hark/pull/31) | Draft gated plan | Track extracted tasks through #36; keep original until adjudicated |
| [#33](https://github.com/EchoTouch-moon/hark/pull/33) | Trae positioning | Keep as reviewable positioning proposal |
| [#35](https://github.com/EchoTouch-moon/hark/pull/35) | G1-A slice status synchronization | Review separately; don't overwrite `handoff/STATUS.md` here |

**Full file-level triage is already assigned as [#38](https://github.com/EchoTouch-moon/hark/issues/38).** Do not duplicate its deliverable or close any PR based only on this inventory.

## G1-A remaining security exits (not tested in this docs-only change)

- [#40](https://github.com/EchoTouch-moon/hark/issues/40): PATCH Origin/CSRF negative probes (confirm write-method boundary without creating a new production route).
- [#41](https://github.com/EchoTouch-moon/hark/issues/41): A/B projects, orphan threads, Card/Run/SSE direct-API negative matrix, GET zero writes and executor=0.
- [#42](https://github.com/EchoTouch-moon/hark/issues/42): trusted ownership of Demo reset and rejection/deletion boundary.
- [#43](https://github.com/EchoTouch-moon/hark/issues/43): execution admission, crash-window recovery and no false completion.
- [#44](https://github.com/EchoTouch-moon/hark/issues/44): durable ProjectSource / ThreadProjectBinding identity and migration contract.
- [#39](https://github.com/EchoTouch-moon/hark/issues/39): isolated concurrent Playwright ports, databases and artifacts.
- [#37](https://github.com/EchoTouch-moon/hark/issues/37): authoritative per-head G0->G1 evidence matrix (already separately assigned).

Require a fixed head, reproducible tests, zero unauthorized side effects, independent security review and an explicit human Gate decision. Until then, G1-A stays `IN_PROGRESS / NOT_PASSED`. G1-B/C and downstream G3 integration stay blocked.

## Non-destructive cleanup protocol

1. **Now**: use this entry, correct stale README/Agent pointers, reference #37/#38, and keep historical evidence and UI experiments accessible.
2. **After #38 review**: inventory each old branch's unique commits and open PR linkage; separately propose which branches to retain/archive/delete. Do not delete branches with pending PRs or unreviewed unique commits.
3. **After master/G0 diff review**: decide an explicit integration method, dry-run conflict/test matrix, required CI, rollback path and owner approval. Do not force-sync 109/25 divergent commits.
4. **After G1-A evidence complete**: review and approve the Gate; then authorize G1-B Chronicle / G1-C Opinion Memory in small scoped PRs. Do not replace this with more design mockups.

## Board / Notion consistency

Engineering [GitHub Project #2](https://github.com/users/EchoTouch-moon/projects/2/views/1) can show stale item statuses. The existing connector does not provide Project-v2 write capabilities. Verify before editing, avoid duplicate items, and record `NOT_SYNCED` where unknown. GitHub Issue/PR state is not interchangeable with Board Status; Board Status is not Gate Status.

**Change scope for this document**: navigation and governance only. No product code changes, runtime tests, data migrations, PR merges, branch deletions, external model calls, or user-project operations.
