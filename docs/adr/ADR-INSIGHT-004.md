# ADR-INSIGHT-004 · Durable signal inbox and consumption checkpoints

- Status: Accepted for S1.2
- Date: 2026-10-28
- Depends on: ADR-INSIGHT-001, ADR-INSIGHT-002, ADR-INSIGHT-003

## Decision

1. **P1 uses `data/insights.sqlite`** (`HEARTH_INSIGHT_DB`). It never writes `observer.sqlite`. Writer lock is `${db}.writer.lock`. Schema v1: `signal_inbox`, `consumer_checkpoints`, `source_interruptions`.

2. **Signal identity is the extractor `signalKey`**, stored as `signal_id`. A second unique key is `(project_id, stream_epoch, extractor_version, source_event_id, signal_type, subject)`. Replays use `INSERT OR IGNORE`.

3. **`commitSignalBatch` is one SQLite transaction:** CAS `revision` → insert signals → advance `after_seq` only if the proposed cursor is strictly greater → commit. `NO_SIGNAL` may advance. `SOURCE_RESET_REQUIRED` and `EVIDENCE_UNAVAILABLE` do not. Cursor cannot regress.

4. **Checkpoints are keyed by `(project_id, stream_epoch, extractor_version)`.** A new epoch starts at `after_seq = 0`. Other ACTIVE epochs are frozen with `STREAM_EPOCH_MISMATCH`. `CURSOR_AHEAD_OF_STREAM` freezes the current epoch and does **not** zero the cursor.

5. **Two databases, no cross-db transaction.** Repeat reads are safe. P1 local processing and checkpoint are atomic. A P0 delete that races a P1 commit is detected on the **next** consume (ST-15). This is not exactly-once across P0+P1.

6. **Project delete policy.** `PROJECT_REMOVED` freezes checkpoints, records an OPEN interruption, and **purges `signal_inbox` for that project_id** so derived payloads do not outlive the source. Interruptions and frozen checkpoints remain as consume-safety metadata. `InsightStore.purgeProject(projectId)` deletes inbox, checkpoints, and interruptions when the user wants P1 rows gone too. Interruptions are never auto-resolved.

7. **Scheduling.** `InsightConsumer.consumeProjectBatch` is a manual, bounded (max 200 events) entry. No timers, no notifications. Same-process concurrency uses a per-project mutex; cross-process uses the writer lock.

## Consequences

- S1.3 rule engine must read inbox + checkpoint, not call Observer DESC pagination.
- Enabling `R-TEST-EVIDENCE-GAP` is still forbidden.
- Fastify `AppDeps.insightEngine` is still unwired.
