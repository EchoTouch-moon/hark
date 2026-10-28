# ADR-INSIGHT-001 · P0 read port, storage isolation, and evidence retention

- Status: Accepted for S0 freeze
- Date: 2026-10-28
- Context: P1 Insight Engine must consume Observer facts without treating unimplemented P0 fields as real. Spec file in repo is `docs/16-HEARTH_PROJECT_INSIGHT_P1.md`.

## Decision

1. **P1 uses a separate SQLite file** `data/insights.sqlite` (env `HEARTH_INSIGHT_DB`), never writes `observer.sqlite`. Same process as Fastify, own writer lock, `onClose` lifecycle parallel to `ProjectObserver`. Do not reuse `@hearth/storage` (that is Hearth cards/runs; it already has an unrelated `events` table). S1 wires `AppDeps.insightEngine` the same way as `AppDeps.observer`. **S0 does not create the file or Fastify routes.**

2. **Do not consume `GET /api/v1/observer/projects/:id/events` as an append log.** That API is `ORDER BY occurred_at DESC, id DESC` with cursor `observedAt|eventId`. Response is `{ events, nextCursor }` with **no `hasMore`**. Event IDs are `evt_` + 8 random hex bytes. Same-millisecond order follows lexical id, not insert order.

3. **Required P0 compatibility work before S1 consumption (not implemented in S0):** add observer schema **v3** `observer_events.append_seq INTEGER NOT NULL UNIQUE` populated by SQLite `AUTOINCREMENT` (or an explicit counter table) and `ProjectObserver.listEventsForward({ projectId, afterSeq, limit })` returning ASC by `append_seq` plus `hasMore`. Do **not** document implicit `rowid` as the public cursor: live `VACUUM` can renumber implicit rowids. `VACUUM INTO` backup does not rewrite the live file.

4. **In-process snapshot lookup exists only on `observer.store.getSnapshot(id)`.** The facade has no `getSnapshot`. HTTP `GET .../snapshot` returns the **latest** snapshot only. S1 adapter may call the store method in-process; HTTP evidence links go to `/observe/:id`, never raw filesystem paths.

5. **JUnit cannot bind HEAD.** Parser reads tag counts and optional `timestamp`; it does not read a commit SHA. `TestSummary.headBound` is always `false`. Snapshot `headSha` is Git HEAD, not report provenance. P1 `headBinding` is `UNDETERMINED` unless a future adapter stores a verifiable SHA. `R-TEST-REGRESSION` may only say “same relativePath result changed”. `R-TEST-EVIDENCE-GAP` stays **default-off**.

6. **Report identity for subjects is `relative_path`.** Table `report_sources.id` exists (`rpt_` + random hex) but is **not** copied onto `TestSummary`. Frozen subject key: `reportSource:{relativePath}` via `reportSourceSubjectKey`. Latest snapshot `.test` is the **last** enabled report source in list order.

7. **Retention:** P0 deletes events/snapshots/runs only in `ObserverStore.deleteProject` (`removeProject`). `pruneRuns` exists but is **not** called from the scanner; it also refuses to delete runs still referenced by events. There is **no TTL**. P1 may reference P0 IDs for the life of a registered project. On remove/reset: `SOURCE_RESET_REQUIRED`, never replay old events as new. P1 stores EvidenceRef pointers and small template fields, not JUnit bodies. If P0 later adds TTL, it must not be shorter than open Insight evidence.

8. **Wakeup:** P0 has no event callback. S1 default is poll `health.currentRevision` / the future forward cursor every 60s. The 5s p95 “event to feed” target is **not** a S0 commitment until a same-process hook exists.

9. **Feedback MVP:** `acknowledge` / `dismiss` / `useful` / `not_useful` only. No undismiss, no preference learning. `DISMISSED` same episode does not reopen in MVP.

10. **S0 schema extensions vs spec §4:** `headBinding` is required on Signal, Candidate, and Insight. `evidenceAvailability` is required on Insight. These are additive freezes so rules cannot omit binding/availability. P1 `EvidenceQuality` includes `UNAVAILABLE` as a **derived** value; P0 `Evidence.quality` never emits it.

## Frozen P1 objects

Canonical Zod lives in `packages/project-insight/src/contracts.ts`:

- `Signal`, `InsightCandidate`, `EvaluationResult` (`NO_INSIGHT` | `CANDIDATE`), `EvidenceRef`, `Insight`
- Dedup: `dedupKey = sha256(canonicalSerialize({projectId, ruleId, ruleMajorVersion, subjectKey, episodeKey}))` with sorted keys
- Default rule policy: `R-TEST-EVIDENCE-GAP.enabled === false`

## Proposed insight tables (not created in S0)

Logical names only; physical migration is S1:

- `insight_items` unique on `(project_id, dedup_key)`
- `insight_event_ack` unique on `(consumer_version, project_id, p0_event_id)`
- `insight_consume_cursors` per `project_id` storing opaque `last_append_seq`
- `insight_feedback` last-write-wins per insight (`useful` | `not_useful`)

## Consequences

- S1 must not start full consumption until `listEventsForward` exists **or** an equivalent documented integer sequence is merged and tested against **insert order**, not `observedAt`.
- SQLite `rowid` on `observer_events` currently increases with inserts; that is an implementation accident, not the frozen cursor.
- Multiple declared JUnit files: the latest snapshot `test` object is the last scanned source only.
- Do not say “current HEAD regression” or “tests are green” from P0 JUnit.

## Alternatives rejected

- Using `observedAt` as a consume cursor (clock freeze, same-ms events, reorder).
- Putting insight tables inside `observer.sqlite` (writer lock and migration blast radius).
- Treating `headBound: false` as `NOT_BOUND_TO_HEAD` (that requires contrary SHA evidence).
- Using `report_sources.id` as the user-facing subject (random; lost on re-register after remove).
- Implementing P0 v3 inside S0 (this ADR freezes the gap; it does not ship the column).
