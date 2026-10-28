# ADR-INSIGHT-003 · S1.1 read port and deterministic signals

- Status: Accepted for S1.1
- Date: 2026-10-28
- Depends on: ADR-INSIGHT-001, ADR-INSIGHT-002

## Decision

1. **In-process `ObserverReadPort`** wraps `ProjectObserver` query APIs only (`listEventsForward`, `store.getSnapshot`, stream/project inspect, `observer_meta` read). It does not scan, register, delete, insert, or migrate.

2. **One consume call freezes `highWatermark`** and re-inspects stream epoch before and after paging. `PROJECT_REMOVED`, `STREAM_EPOCH_MISMATCH`, and `CURSOR_AHEAD_OF_STREAM` map to `SOURCE_RESET_REQUIRED`. `PROJECT_NOT_FOUND` and missing snapshots map to `EVIDENCE_UNAVAILABLE`, never to an empty `OK`/`NO_SIGNAL` page.

3. **Historical snapshots come only from `fromSnapshotId` / `toSnapshotId`.** The adapter never calls `getLatestSnapshot`.

4. **Signal identity** is `sha256(canonicalSerialize({ extractorVersion, projectId, streamEpoch, sourceEventId, kind, subject }))`. `headBinding` is always `UNDETERMINED`. `headBound: false` is recorded in facts only.

5. **S0 `Signal.kind` stays the field name** (`signalType` in the task text). Additive kinds: `ADAPTER_ERROR_OBSERVED`, `REPOSITORY_UNAVAILABLE_OBSERVED`, `REPOSITORY_HEAD_CHANGED`, `REPOSITORY_BRANCH_CHANGED`, `WORKTREE_STATE_CHANGED`. `TEST_EVIDENCE_NOT_CURRENT` is never emitted.

6. **`proposedCursor` is a suggestion.** S1.1 does not persist it. A successful SignalBatch is not exactly-once Insight processing.

7. **Git worktree/HEAD signals are facts, not Insights.** S1.1 does not create Insight rows.

## Consequences

- Global `append_seq` holes between projects are normal.
- `legacy_order_reconstructed=1` is copied onto signal facts as `orderUncertainty=reconstructed_rowid`.
- Multiple JUnit files are keyed by `reportSource:{relativePath}` from the event payload, not by the latest snapshot’s last report.
