# S3 Gate Review · P1 close-out

- Date: 2026-10-29
- Feature HEAD: `6979dda` / docs `6a51c1d`
- Snooze fix: `b6785c7`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md` §S3
- ADR: `docs/adr/ADR-INSIGHT-006.md`

## Overall

**CONDITIONAL_PASS**

P1-C is product-complete. Clean-tree tests are green after the snooze clock fix. Two known pilots are registered in the Hearth default observer DB and survived read-only scan + insight consume. `agent-internet-lab` is `NOT_RUN_ENV_UNSET`.

## T1 · snooze clock

| Check | Result |
|---|---|
| Root cause | Hardcoded `2026-10-28T18:00:00Z` became past on 2026-10-29 |
| Business validator | Unchanged (`until` must be future and ≤ 7 days, second-precision ISO) |
| Fix | `apps/server/src/http/app.test.ts` uses relative past/future second-precision timestamps |
| Commit | `b6785c7` |
| Clean worktree `pnpm test` | **290 passed / 0 failed** (33 files) |
| Other dirty workspace files | Untouched |

## T2 · runtime DB and real pilots

S3.5 queried `data/observer.sqlite` (0 rows) while a previous UI process used `/tmp/hearth-obs-ui/observer.sqlite` (pindou + prototype-skill-lab already present). Those two Git paths exist. This close-out registered them through Hearth `/projects` into the **default** `data/observer.sqlite`.

| Pilot | Result | Evidence |
|---|---|---|
| pindou | **PASS** | `/projects` card, `main` `f57fc770361e`, collection OK, two extra scans added no change events, fingerprint unchanged, test UNKNOWN |
| prototype-skill-lab | **PASS** | `/projects` card, `feat/m3-host-native` `3352b3615e49`, same quiet scan path |
| agent-internet-lab | **NOT_RUN_ENV_UNSET** | env unset; not present at bounded siblings `new-idea/agent-internet-lab` or `new-idea/design/agent-internet-lab`; no HOME scan |

Insight consume on both pilots: `NO_SIGNAL` / 0 episodes. Only `PROJECT_REGISTERED` plus idempotent rescans. Empty Feed is **尚未评估洞察**, not a fake healthy-pass. Git noise stayed quiet (RU-01).

Screenshots: `handoff/EVIDENCE/p1-projects-registered.png`, `p1-insights-after-pilots.png`  
JSON: `docs/verification/data/insight-p1-pilots-closeout.json`  
Harness: `scripts/p1-pilot-register-verify.ts` (paths from `HEARTH_PILOT_*` only)

## S3.5 positive UI (fixture)

Unchanged **PASS**. Isolated `/tmp/hark-s35-ui` still covers acknowledge / dismiss / useful / restart. That path is fixture data, not these two real repos.

## Limits

1. Third pilot remains env-unset. Do not treat that as a confirmed missing disk path beyond the two bounded sibling checks.
2. Real pilots currently have no failing JUnit, so they correctly produce zero Insight cards.
3. Starting Hearth with `HEARTH_OBSERVER_DB=/tmp/hearth-obs-ui/observer.sqlite` still points at a different file than the default `data/observer.sqlite`. Default path is now populated.
4. Original workspace still has unrelated uncommitted comment/P0.5 files.

## Final result

**CONDITIONAL_PASS** — product loop complete; G6 waiver is the unset third pilot, same shape as P0.5.
