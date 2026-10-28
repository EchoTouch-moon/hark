# Insight P1 · S1.1 gate

- Date: 2026-10-28
- Workspace: `/Users/v/new-idea/hark`
- Base HEAD before this work: `483b999`
- S1.1 commit: `57191f9 feat(insight): add read-only observer port and signal extractor`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md`
- ADRs: `docs/adr/ADR-INSIGHT-001.md`, `ADR-INSIGHT-002.md`, `ADR-INSIGHT-003.md`

## Overall

**PASS** for read-only consume, deterministic extraction, evidence fidelity, and source-reset detection.

S1.2 Insight Store / rule engine / UI: **NOT_RUN**.

## Commands

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/project-insight packages/project-observer apps/server/src/http/observer.http.test.ts` | **PASS** 96 tests / 16 files |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **PASS** |
| `pnpm exec eslint packages/project-insight packages/project-observer/src/index.ts` | **PASS** |
| Notifications / Hermes / Pi / Insight Store | **NOT_RUN** |
| Real pilot repo writes | **NOT_RUN** |

## Required scenarios

| Scenario | Result |
|---|---|
| Repeat read → same signalKey | **PASS** |
| Same timestamp ordered by append_seq | **PASS** |
| A→B→A HEAD changes | **PASS** |
| Frozen highWatermark | **PASS** |
| Restart resume from proposedCursor | **PASS** |
| Cross-project seq holes ≠ lost events | **PASS** |
| Delete / re-register / rewind → SOURCE_RESET_REQUIRED | **PASS** |
| PROJECT_NOT_FOUND → EVIDENCE_UNAVAILABLE | **PASS** |
| Missing snapshot → EVIDENCE_UNAVAILABLE, cursor not advanced | **PASS** |
| JUnit headBound false → UNDETERMINED | **PASS** |
| Multi reportSource paths | **PASS** (unit + payload path) |
| legacy reconstructed order flag | **PASS** |
| Git signals ≠ Insight objects | **PASS** |
| No P0 DB / git writes during extract | **PASS** |
| Observer + HTTP + S0 contracts | **PASS** |

## Design deltas vs the task sketch

- Field name remains S0 `kind`, not a second `signalType`.
- `SignalBatch.outcome` uses the four requested values. `PROJECT_NOT_FOUND` is `EVIDENCE_UNAVAILABLE` + `reasonCode=PROJECT_NOT_FOUND` (not silent `NO_SIGNAL`).
- Additive Signal kinds for Git / adapter / single unavailable observation. `REPOSITORY_UNAVAILABLE_PERSISTENT` is not emitted (needs a stored consecutive window in S1.2).
- `TEST_EVIDENCE_NOT_CURRENT` is never emitted (`R-TEST-EVIDENCE-GAP` stays off).
- `proposedCursor` is returned and **not** written.

## Limits (not PASS as stronger claims)

1. P0 snapshot `.test` is still the last JUnit source. Extractor keys off **event payload** `relativePath`; it cannot recover a non-last report that P0 never stored on the event.
2. Successful SignalBatch is **not** exactly-once Insight processing.
3. Worktree/HEAD signals exist for later rules to ignore; S1.1 does not rank or hide them.
4. Hard-deleted events remain unreplayable (S1.0 BLOCKED). S1.1 only detects the hole.

## S1.2 entry

Allowed: persist Insight rows + consume cursor using `proposedCursor` only after a durable transaction, treating `SOURCE_RESET_REQUIRED` as `SOURCE_RESET_REQUIRED`.

Not allowed yet: rule scoring UI, notifications, enabling `R-TEST-EVIDENCE-GAP`, model calls.
