# S3 Gate Review · S3.5 close-out

- Date: 2026-10-29
- Baseline HEAD: `9890ba2`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md` §S3
- S3.0 entry: `docs/verification/insight-p1-s30-entry-audit.md`
- ADR: `docs/adr/ADR-INSIGHT-006.md`
- Clean worktree: `/Users/v/new-idea/hark-s35-verify` at `9890ba2` (0 dirty files)
- Original workspace uncommitted files were left in place and were not used for this close-out

## Overall

**CONDITIONAL_PASS**

Positive Insight UI, isolated API/lifecycle tests, and clean-tree typecheck passed. Real-pilot G6 is blocked: Observer Registry has zero projects and `HEARTH_PILOT_*` is unset. Clean-tree `pnpm test` still has one pre-existing snooze-window failure in `9890ba2` itself.

## S3.5-G0 clean baseline

| Check | Result | Evidence |
|---|---|---|
| Independent worktree at `9890ba2` | PASS | `git worktree add … 9890ba2`; `git status` empty |
| `pnpm install --frozen-lockfile` | PASS | lockfile reused, 309 packages |
| `pnpm typecheck` | **PASS** | root tsc + `@hearth/web` |
| `pnpm lint` | **PASS** (warnings) | eslint exit 0, 0 errors / 6 warnings, no `--max-warnings=0` |
| `pnpm test` | **CONDITIONAL** | 289 passed / 1 failed |

Failed test on **clean HEAD**: `apps/server/src/http/app.test.ts` `snooze validates window and persists`.

- Request body `until=2026-10-28T18:00:00Z`
- Today UTC `2026-10-29`; `cards.ts` in `9890ba2` already requires `until` in the future
- HTTP 400 `INVALID_SNOOZE_WINDOW`
- This is **not** caused by the original workspace’s uncommitted `cards.ts`
- Test expectation was not changed; user files were not deleted

Raw: `docs/verification/data/insight-s35-clean-baseline.json`

## S3.5-G1 API / lifecycle (fixture)

Unchanged from S3 isolated tests; re-run on clean worktree as part of `pnpm test`.

| Check | Result |
|---|---|
| Session / CSRF | PASS |
| Empty feed has no fake cards | PASS |
| Stable pagination | PASS |
| acknowledge ≠ resolved | PASS |
| feedback whitelist + idempotent upsert | PASS |
| GET does not write | PASS |
| missing / unavailable evidence | PASS |
| dismiss keeps evidence; survives reopen | PASS |
| new episode after resolve does not inherit feedback | PASS |

## S3.5-G2 positive UI (isolated fixture)

Harness: `scripts/insight-s35-ui-verify.ts`  
DBs: `/tmp/hark-s35-ui/*` only  
Server: clean worktree `9890ba2` on `127.0.0.1:4325`  
JSON: `docs/verification/data/insight-s35-ui-verify.json`

| Step | Result | Screenshot |
|---|---|---|
| Seed TEST_REPORT_FAILURE_OBSERVED + `processProjectRules` | PASS | live `ins_6ec653ca835bb761` OPEN |
| Feed shows two real cards, no empty-success wall | PASS | `insight-s35-feed-open.png` |
| Detail: rule, reason code, evidence pointer, undetermined HEAD | PASS | `insight-s35-detail.png` |
| acknowledge → 已查看 | PASS | `insight-s35-acknowledged.png` |
| useful → not_useful, status unchanged | PASS | `insight-s35-feedback.png` |
| dismiss hidden after refresh | PASS | `insight-s35-dismissed-hidden.png` |
| 含已处理: OPEN new episode vs RESOLVED vs DISMISSED | PASS | `insight-s35-resolved-and-new.png` |
| Service restart keeps dismiss + 没用 | PASS | `insight-s35-after-restart.png` |

Resolved episode `ins_07ba87bd1a939805` and new OPEN episode `ins_7bc642ce78ac830d` are different IDs.

## S3.5-G3 real pilots

Read-only. No HOME scan. No Git / report / worktree writes.

| Source | Result |
|---|---|
| `data/observer.sqlite` `observer_projects` | **0 rows** |
| `HEARTH_PILOT_PINDOU` | unset |
| `HEARTH_PILOT_SKILL_LAB` | unset |
| `HEARTH_PILOT_AGENT_INTERNET` | unset |
| `scripts/insight-s2-pilot.ts` | all three **BLOCKED_PATH_UNAVAILABLE** |

| Pilot | Result |
|---|---|
| pindou | **BLOCKED_PATH_UNAVAILABLE** |
| prototype-skill-lab | **BLOCKED_PATH_UNAVAILABLE** |
| agent-internet-lab | **BLOCKED_PATH_UNAVAILABLE** |

Paths were not guessed. Raw: `docs/verification/data/insight-s35-pilots.json`

## Fixture vs real

| | Fixture | Real pilots |
|---|---|---|
| Data | Synthetic signals in `/tmp/hark-s35-ui` | Would be registered local Git repos |
| Insight cards | Created and driven in UI | Not available this session |
| Repo mutation | None | N/A (blocked before register) |

## Limits and risks

1. Real G6 cannot run until Observer Registry has projects or `HEARTH_PILOT_*` is set to existing absolute Git paths.
2. Clean `pnpm test` fails one time-dependent snooze case already present in `9890ba2`.
3. `pnpm lint` reports 6 existing unused-var warnings; S3 files were not the source.
4. Observe-detail click-through from an Insight was not driven against a registered observer project (registry empty). Detail still exposes `/observe/{projectId}`.
5. Original workspace remains dirty with P0.5 / comment files; those files were not part of the clean-tree run.

## Non-goals kept

No Hermes/Pi, notifications, auto planning/code, `R-TEST-EVIDENCE-GAP`, new progress rules, or P2.

## Final result

**CONDITIONAL_PASS**
