# S3 Gate Review

- Date: 2026-10-29
- Baseline HEAD: `0001fa0`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md` §S3, user P1-S3 task
- S3.0 entry: `docs/verification/insight-p1-s30-entry-audit.md`
- ADR: `docs/adr/ADR-INSIGHT-006.md`

## S3.0 G6 pilots

| Pilot | Env | Result |
|---|---|---|
| pindou | `HEARTH_PILOT_PINDOU` | **BLOCKED_PATH_UNAVAILABLE** (unset) |
| prototype-skill-lab | `HEARTH_PILOT_SKILL_LAB` | **BLOCKED_PATH_UNAVAILABLE** (unset) |
| agent-internet-lab | `HEARTH_PILOT_AGENT_INTERNET` | **BLOCKED_PATH_UNAVAILABLE** (unset) |

No HOME scan. Feed/API tests use isolated fixture DBs. Playwright uses `HEARTH_INSIGHT_DB=data/e2e-insights.sqlite`.

## Overall

**CONDITIONAL_PASS**

S3 API, persistence, UI, and isolated tests passed. Real-pilot G6 remains blocked. Full-repo `pnpm test` has one pre-existing failure in dirty `cards.ts` snooze schema (`toISOString` vs second-precision regex); that file is not part of S3.

## S3.1 API

| Check | Result | Evidence |
|---|---|---|
| Session on GET | PASS | `insights.http.test.ts` 401 without cookie |
| CSRF on POST | PASS | dismiss without `x-csrf-token` → 403 |
| Stable pagination | PASS | query + HTTP cursor pages |
| Default feed hides dismiss | PASS | query + HTTP |
| acknowledge ≠ resolved | PASS | status stays `ACKNOWLEDGED` |
| feedback whitelist / idempotent upsert | PASS | useful twice, flip to not_useful, `love-it` → 400 |
| missing insight | PASS | 404 |
| invalid cursor / status | PASS | 400 |
| observeHref relative | PASS | `/observe/{projectId}`; JSON has no `/Users/` |
| GET does not write | PASS | row counts and `updated_at` unchanged |
| evidence MISSING | PASS | inbox deleted → `MISSING`, refs remain |
| unconfigured store | PASS | 503 `UNAVAILABLE` |
| observer hard delete purges insight | PASS | `purgeProject` + DELETE hook |

## S3.2 UI

| Check | Result | Evidence |
|---|---|---|
| `/insights` empty is not fake-success | PASS | e2e + `handoff/EVIDENCE/insight-feed-empty.png` |
| missing detail | PASS | `insight-detail-missing.png` |
| Projects still renders | PASS | `insight-projects-with-summary.png` |
| Insights nav | PASS | AppShell + screenshots |
| Filters | PASS | status + severity + project chips |
| Actions | PASS | acknowledge / dismiss / useful / not_useful |
| Observe link | PASS | detail `observeHref` |

Observe detail with a registered repo was not driven in empty e2e (no observer project). The Projects register form and `/insights` navigation still load.

## S3.3 lifecycle

| Check | Result |
|---|---|
| dismiss keeps evidence | PASS |
| useful/not_useful does not change status | PASS |
| dismiss survives store reopen | PASS |
| new episode after resolve is OPEN, no inherited feedback | PASS |
| historical epoch flag | PASS |
| purgeProject removes feedback | PASS |

## S3.4 automation

| Command | Result |
|---|---|
| `pnpm --filter @hearth/web typecheck` | PASS |
| `pnpm exec tsc -p tsconfig.json --noEmit` | PASS |
| insight package + `insights.http.test.ts` | **93 passed** |
| Playwright `insights.spec.ts` | **3 passed** |
| eslint on S3 files | PASS `--max-warnings=0` |
| `pnpm test` full repo | **292 passed / 1 failed** (`app.test.ts` snooze; dirty `cards.ts`, not S3) |

## Non-goals kept

No Hermes/Pi, notifications, auto planning/code, `R-TEST-EVIDENCE-GAP`, or new progress-inference rules. No `POST /reconcile` in S3.

## Workspace hygiene

Uncommitted P0.5 docs/bench, `packages/contracts`, `packages/core`, and dirty `config.ts` / `session.ts` / `services.ts` / `cards.ts` / `runs.ts` were left as-is. User-requested source comments outside the S3 commit set remain uncommitted with that work.

## Final result

**CONDITIONAL_PASS**
