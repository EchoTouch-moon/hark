# Insight P1 · S2.0 entry audit

- Date: 2026-10-29
- Workspace: `/Users/v/new-idea/hark`
- HEAD at audit: `15f5f3c`
- Spec: `docs/17-PROJECT-INSIGHT-S2-IMPLEMENTATION.md` (untracked at audit time)

## S1.2 prerequisite

| Capability | Evidence | Result |
|---|---|---|
| `signal_inbox` | `packages/project-insight/src/store/schema.ts` v1 | **PASS** |
| Unique identity | PK `signal_id` = extractor `signalKey`; UNIQUE (project, epoch, extractor, event, type, subject) | **PASS** |
| Checkpoints | `consumer_checkpoints` PK (project, epoch, extractor) + CAS `revision` | **PASS** |
| Atomic commit | `InsightStore.commitSignalBatch` BEGIN IMMEDIATE; signals then cursor | **PASS** |
| Fault injection | ST-02/ST-03 `after-signals` / `after-cursor` / `before-commit` | **PASS** (`s12.test.ts`) |
| Source reset freeze | ST-08/09/10 PROJECT_REMOVED, new epoch, CURSOR_AHEAD | **PASS** |
| Single writer | `${db}.writer.lock` + in-process keyed mutex | **PASS** |
| Gate | `docs/verification/insight-p1-s12-gate.md` overall PASS | **PASS** |

S1.2 feature commit: `f3ec3a3`. Gate SHA commit: `15f5f3c`.

**S2.0 = PASS.** S2.1 may start. Not `BLOCKED_PRECONDITION`.

## Interface mapping for S2

| S2 need | Actual S1.2/S1.1 |
|---|---|
| Inbox order | `append_seq ASC, signal_id ASC` (global seq, holes between projects are normal) |
| Rule cursor | **New** `insight_rule_progress`; must not reuse extractor `consumer_checkpoints` |
| Signal shape | `kind`, `subject`, `signalKey`, `appendSeq`, `streamEpoch`, `facts`, `evidenceRefs`, `headBinding` |
| JUnit compare | `facts.relativePath`, `previousFailed`/`currentFailed`, `comparable` |
| HEAD binding | Always `UNDETERMINED`; `headBound` is a fact only |
| Delete | P0 hard-deletes events; P1 inbox purged on PROJECT_REMOVED; interruptions stay OPEN |
| Legacy | `facts.orderUncertainty=reconstructed_rowid` |

## Contract deltas vs spec §3.2

- S0 `InsightCandidate.ruleVersion` is a **number**; S2 rules keep integer `1` and store `"1"` in SQL.
- Semantic dedup is `issueKey(projectId, streamEpoch, issueFamily, subjectKey)`, not S0 `insightDedupKey(ruleId, ...)`.
- `R-TEST-REGRESSION` ID is kept; user-facing copy must not say “HEAD regression”.
- `R-TEST-EVIDENCE-GAP` remains disabled.

## Workspace

Uncommitted P0.5 files (bench, pilots, screenshots, `observer.pf.test.ts`, `docs/14`, `docs/15`) are **left untouched** and will not be part of S2 commits.

## S2-G0

**PASS**
