# ADR-INSIGHT-002 · Observer v3 append_seq and hard-delete gaps

- Status: Accepted for S1.0
- Date: 2026-10-28
- Supersedes: the “not implemented” clause of ADR-INSIGHT-001 decision 3

## Decision

1. **Global durable counter** `observer_meta.append_seq` allocates `append_seq`. Allocation is `UPDATE value = value + 1` in the **same SQLite transaction** as the event `INSERT`. The next value is never `MAX(observer_events.append_seq)` and never implicit `rowid`.

2. **No reuse after committed delete.** Rolling back an uncommitted insert also rolls back the counter (the number was never published). Deleting a committed tail event leaves the counter in place; the next insert is strictly greater.

3. **`listEventsForward`** is the consume API. `listEvents` remains `occurred_at DESC, id DESC` for UI/HTTP. Forward pages are `append_seq ASC`, keyset `append_seq > afterSeq AND append_seq <= highWatermark`. `highWatermark` defaults to the allocated counter and may be frozen by the caller so inserts during pagination cannot enter that batch.

4. **`streamEpoch` is per project** in `observer_event_stream` (no FK; survives project delete):
   - First register: `epoch = 1`, `retired_at = NULL`.
   - `removeProject`: hard-delete events/snapshots/runs/reports/health/project; set `retired_at` and `last_seq`; **do not** decrement the global counter; **do not** keep event payloads.
   - Re-register same path (same `prj_` hash): `epoch = epoch + 1`, clear `retired_at`.
   - VACUUM: epoch and `append_seq` values unchanged.
   - Opening an existing DB: epoch unchanged.
   - Restoring an older backup: epoch and counter come from the backup file. If the consumer’s `afterSeq` is greater than the restored allocated counter, `listEventsForward` returns `CURSOR_AHEAD_OF_STREAM`.

5. **Hard delete vs lossless consume.** Event bodies are gone after `removeProject`. That history cannot be replayed. S1.0 therefore **does not claim lossless consume across project deletion**. It **does** make the hole visible:
   - live project, matching epoch → `OK`
   - unknown id → `PROJECT_NOT_FOUND`
   - tombstone present → `PROJECT_REMOVED`
   - live stream with a different epoch → `STREAM_EPOCH_MISMATCH`
   - `afterSeq > allocated` → `CURSOR_AHEAD_OF_STREAM`

6. **Cursor ownership.** Observer does not persist P1 consume cursors. P1 must advance `(afterSeq, streamEpoch)` only after it has durably processed a page.

7. **v2 → v3 backfill** numbers leftover rows by current `rowid ASC` and sets `observer_meta.legacy_order_reconstructed = 1` when any row existed. That order is **reconstructed**, not original insert order (v2 rebuild and VACUUM can change rowids).

## Consequences

- HTTP `GET .../events` is unchanged (DESC + `nextCursor` string).
- P1 Insight Store (S1.1+) must treat `PROJECT_REMOVED` / `STREAM_EPOCH_MISMATCH` / `CURSOR_AHEAD_OF_STREAM` as `SOURCE_RESET_REQUIRED` and must not replay the new epoch as a continuation of the old cursor.
- A tombstone of `(project_id, epoch, retired_at, last_seq)` is retained after user delete. It is consume-safety metadata, not observation evidence.

## Alternatives rejected

- SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` on events (would replace the TEXT event id PK).
- Per-project sequences (violates “unique in the database”).
- Soft-delete of events (violates the user’s full-delete intent).
- Using DESC `listEvents` with a reversed walk (same-ms lexical id is not insert order).
