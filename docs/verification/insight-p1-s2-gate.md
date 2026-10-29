# S2 Gate Review

- Date: 2026-10-29
- Baseline HEAD: `15f5f3c`
- Spec: `docs/17-PROJECT-INSIGHT-S2-IMPLEMENTATION.md`
- S1.2 prerequisite: **PASS** (`docs/verification/insight-p1-s20-entry-audit.md`, feature `f3ec3a3`)

## Overall

**CONDITIONAL_PASS**

All rule, episode, transaction, and engineering gates passed. Real-pilot G6 is blocked because `HEARTH_PILOT_*` is unset in this session; paths were not searched.

## S2-G0..G8

| Gate | Result | Evidence |
|---|---|---|
| S2-G0 | **PASS** | `insight-p1-s20-entry-audit.md` |
| S2-G1 | **PASS** | RU-01..12 in `rules/rules.test.ts` |
| S2-G2 | **PASS** | EP-01..10 in `episodes/episodes.test.ts` + processor persist |
| S2-G3 | **PASS** | TX-01..12 in `insights/processor.test.ts` (`purgeProject` implemented) |
| S2-G4 | **PASS** | freeze on consumer FROZEN; UNDETERMINED templates; no HEAD regression copy |
| S2-G5 | **PASS** | bench JSON; TX-06 1000 empty passes; PF-01/02 in unit tests |
| S2-G6 | **BLOCKED_PATH_UNAVAILABLE** | all three `HEARTH_PILOT_*` unset; no HOME scan |
| S2-G7 | **PASS** | 144 tests (insight+observer+HTTP); tsc; eslint |
| S2-G8 | **PASS** | this file, ADR-INSIGHT-005, bench JSON |

## RU-01..12

| ID | Result |
|---|---|
| RU-01 | PASS git noise NO_INSIGHT |
| RU-02 | PASS observed JUnit failures |
| RU-03 | PASS UNKNOWN/STALE veto |
| RU-04 | PASS 0→fail copy, no “regression” claim |
| RU-05 | PASS incomparable paths |
| RU-06 | PASS UNDETERMINED |
| RU-07 | PASS evidence-gap disabled |
| RU-08 | PASS gap needs gapMs |
| RU-09 | PASS single adapter error |
| RU-10 | PASS streak ≥3 |
| RU-11 | PASS missing trigger / frozen |
| RU-12 | PASS legacy order blocks transitions |

## EP-01..10

| ID | Result |
|---|---|
| EP-01 | PASS same opening signal → same insight id |
| EP-02 | PASS ongoing ignore |
| EP-03 | PASS resolve then new episode (persist) |
| EP-04 | PASS dismiss holds (persist) |
| EP-05 | PASS acknowledge ≠ resolved |
| EP-06 | PASS SOURCE_RESET is not resolve (TX-08) |
| EP-07 | PASS regression wins one card |
| EP-08 | PASS epoch in issueKey |
| EP-09 | PASS issueKey ignores rule patch |
| EP-10 | PASS canonical hash golden |

## TX-01..12

| ID | Result |
|---|---|
| TX-01 | PASS after-episodes rollback |
| TX-02 | PASS after-progress / before-commit rollback |
| TX-03 | PASS reopen no duplicate |
| TX-04 | PASS writer lock |
| TX-05 | PASS other project continues |
| TX-06 | PASS 1000 empty, zero progress rows |
| TX-07 | PASS git noise cursor, zero insights |
| TX-08 | PASS frozen consumer |
| TX-09 | PASS v2 migration rollback, v1 remains |
| TX-10 | PASS missing trigger |
| TX-11 | PASS existing-inbox baseline |
| TX-12 | PASS purgeProject |

## PF-01..07

| ID | Result | Notes |
|---|---|---|
| PF-01 | PASS | rules are pure functions; no fs/network |
| PF-02 | PASS | `sanitizeTemplateData` truncates and strips home paths |
| PF-03 | PASS | `docs/verification/data/insight-s2-bench-2026-10-29T02-33-45-536Z.json` n=30, 200 signals, p50=25ms p95=30ms, rss≈101MB, 1 episode |
| PF-04 | PASS (reduced) | 200-mix bench + EP-02 ongoing dedup; full 10k replay not run |
| PF-05 | PASS | TX-06; no new observer scanner |
| PF-06 | BLOCKED_PATH_UNAVAILABLE | `HEARTH_PILOT_PINDOU` / `HEARTH_PILOT_SKILL_LAB` unset |
| PF-07 | BLOCKED_PATH_UNAVAILABLE | `HEARTH_PILOT_AGENT_INTERNET` unset; not searched |

## Noisiness

200-signal bench (10 failures + 190 HEAD changes) opened **1** insight. Git noise stayed quiet.

## Known blocks

- G6 real pilots require env paths.
- PF-04 10k full replay not executed; 200-signal mix + unit dedup used.

## Files

`packages/project-insight/src/rules/**`, `episodes/**`, `insights/**`, `store/schema.ts` v2, scripts `insight-s2-*.ts`, ADR-005, this gate.

P0.5 dirty files were not included.

## Final result

**CONDITIONAL_PASS**
