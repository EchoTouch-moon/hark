# Insight P1 · S0 contract audit

Spec file in repo: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md` (not `16-PROJECT-INSIGHT-P1.md`).

Audit date: 2026-10-28. Code path: `packages/project-observer`, `apps/server`. HEAD: `5cfbdcc`. Full gate record: `insight-p1-s0-gate.md`.

This audit records **what the current P0/P0.5 code actually does**. Unimplemented fields are listed as absent.

## 1. P0 SQLite, pagination, IDs, evidence

### Schema (actual, `schema_version.version = 2`)

| Table | What exists | What does not exist |
|---|---|---|
| `observer_events` | `id` TEXT PK (`evt_`+8 random hex bytes), `project_id`, `run_id`, `type`, `before_snapshot_id`, `after_snapshot_id`, `occurred_at`, `payload_json`, `evidence_json`; FKs to project/run/snapshots (v2) | **`append_seq`**, consume cursor, consumed flag |
| `observer_snapshots` | `id` (`snap_`+random), `head_sha`, `branch`, git worktree JSON, `test_json`, `fingerprint`, `accessibility` | reportSourceId inside `test_json`; report HEAD SHA |
| `observation_runs` | per scan; inserted even when fingerprint unchanged | not a user timeline |
| `report_sources` | `id` (`rpt_`+random), `relative_path`, UNIQUE(project, path) | SHA in this table |
| `observer_health` | `last_snapshot_id`, `current_revision`, `last_gap_at`, collection/watch | event seq high-water |

`newId` = `prefix_` + `randomBytes(8).toString('hex')`. **Not monotonic.**

P0 `Evidence.quality` enum: `OBSERVED | UNKNOWN | STALE`. **No `UNAVAILABLE`.** Repo/collection unavailability is `accessibility` / `collection_status`.

### Pagination (actual)

`ObserverStore.listEvents`: `ORDER BY occurred_at DESC, id DESC`, cursor `observedAt|eventId`, limit cap 200, fetches `limit+1` to decide `nextCursor`.

This is a **UI newest-first** page, not a loss-free append consumer. Frozen clocks produce identical `occurred_at`; then order is **lexical event id**, not insert order.

HTTP: `GET /api/v1/observer/projects/:id/events` wraps that API and returns `{ events, nextCursor }`. **No `hasMore`.**

### Snapshots and evidence (actual)

- Unchanged scans **reuse** the previous snapshot id (no extra snapshot row).
- Changed scans insert a new snapshot; events point `fromSnapshotId` / `toSnapshotId`.
- Event `evidence` JSON: `{ source: git\|fs\|junit\|system, observationRunId, quality, errorCode? }`.
- `TEST_REPORT_UPDATED` payload is `{ previous, current }` TestSummary objects.
- `ProjectObserver` has **no** `getSnapshot(id)`. `observer.store.getSnapshot(id)` works in-process. HTTP snapshot route returns **latest only**.

### Deletes

- `deleteProject` explicitly deletes events, snapshots, runs, reports, health, then the project.
- `pruneRuns` exists but **scanner does not call it**. When used, it keeps runs still referenced by events.
- There is **no TTL** on events or snapshots.

## 2. JUnit adapter (actual)

| Field | Stored? | Notes |
|---|---|---|
| Report source ID | **Yes, table `report_sources.id`** | Not copied onto `TestSummary` |
| `relativePath` | Yes, on `TestSummary` | Frozen P1 subject: `reportSource:{relativePath}` |
| Counts tests/passed/failed/skipped/errors | Yes | Tag counts (`<testcase>`, `<failure>`, `<error>`, `<skipped>`); not suite-set identity |
| `generatedAt` | Yes if XML `timestamp` parses, else file mtime | `sourceTimeKind` records which |
| `observedAt` | Yes, scan clock | P0 observation time |
| `reportFingerprint` | Yes, SHA-256 of file bytes | |
| HEAD SHA in report | **No** | parser ignores commit metadata |
| Snapshot `headSha` | Yes | Git HEAD of the scan, **not** report provenance |
| `headBound` | Always **`false`** | Hardcoded in `TestReportSource.scan` |
| `stale` | Yes | `generatedAt <= last HEAD-change snapshot time` |
| `BOUND_TO_HEAD` | **Not representable** | P1 must use `UNDETERMINED` |

Latest snapshot `.test` is the **last** enabled report source in list order (`scanner.ts` overwrites `test` in a loop). Multiple JUnit files are not all retained on the snapshot.

`ADAPTER_ERROR` payload includes `relativePath` + `errorCode`. Missing file → `unknownTestSummary()` without adapter error.

## 3. Cross-restart consumption

| Need | P0 today |
|---|---|
| Events survive process restart | **Yes** (SQLite) |
| Snapshots fetchable by id after restart | **Yes** via store |
| Loss-free “events after cursor” | **No** public API |
| Push/callback into P1 on commit | **No** |
| Polling hint | `health.currentRevision` increments on each committed scan |

SQLite implicit `rowid` on `observer_events` increases with insert (verified in `p0-port.audit.test.ts`). **Not** a public contract: live `VACUUM` can renumber implicit rowids.

**Minimal extension (S1 prerequisite, not done in S0):** P0 schema v3 `append_seq` + `listEventsForward`. Until then P1 must not claim lossless consume. S0 does not ship that column.

## 4. Integration with Hearth

| Piece | Recommendation |
|---|---|
| Package | `@hearth/project-insight` (S0: contracts + audit tests only) |
| DB | `HEARTH_INSIGHT_DB` → `data/insights.sqlite`; own writer lock (S1) |
| Fastify | Optional `insightEngine` on `AppDeps`, `onClose` stop/close, routes `/api/v1/insights*` with existing session/CSRF (S1) |
| P0 | In-process `ProjectObserver` already on `AppDeps.observer` |
| `@hearth/storage` | Do not mix; different `events` table |
| `@hearth/contracts` | Keep for cards/runs; P1 Zod stays in `project-insight` (same pattern as observer) |
| Server config | Follow `HEARTH_OBSERVER_DB` in `apps/server/src/config.ts`; add `insightDbPath` in S1 |

S0 does **not** register Fastify routes, open `insights.sqlite`, or call models/notifications.

## 5. Evidence retention vs Insight pointers

- While a project remains registered, P0 event/snapshot/run IDs are durable enough for EvidenceRef.
- `removeProject` **destroys** those IDs → P1 must `SOURCE_RESET_REQUIRED` / `evidenceAvailability=UNAVAILABLE`.
- P1 must **not** copy JUnit bodies or diffs. Store EvidenceRef + small template fields only.
- If P0 later adds event TTL, it must be ≥ open Insight lifetime; S0 freezes “no TTL today”.

## 6. Frozen P1 schemas

See `packages/project-insight/src/contracts.ts`: `Signal`, `InsightCandidate`, `EvaluationResult`, `EvidenceRef`, `Insight`, plus S0-additive `headBinding` and `evidenceAvailability`.

Default rule posture given P0 facts:

| Rule | S0 posture |
|---|---|
| R-TEST-FAILURE | Allowed at `UNDETERMINED` binding; wording must not claim current HEAD |
| R-TEST-REGRESSION | Allowed only as “same relativePath result changed”; **no** “current version regression” |
| R-TEST-EVIDENCE-GAP | **Default off** (already in spec; P0 cannot prove binding) |
| R-OBSERVER-HEALTH | Allowed from health + runs |
| R-OBSERVATION-GAP | Allowed from P0 event type |
| R-REPOSITORY-UNAVAILABLE | Allowed from accessibility/health |

## Answers to spec §19

1. **Stable append sequence?** Not in the public API. Implicit rowid exists. Required: `append_seq` + forward list. Do not use `observedAt`.
2. **JUnit fields?** Source id in `report_sources`; stats/time/fingerprint/relativePath on snapshot test JSON; **no** report SHA; `headBound === false`. Snapshot has Git `headSha`.
3. **Retention?** Delete only on project remove. P1 pointers valid until then.
4. **Wakeup?** No callback; 60s poll of revision/forward cursor. 5s p95 **not committed**.
5. **Fastify?** Same process, separate DB, same session/CSRF, `onClose` cleanup. Not wired in S0.
6. **Feedback?** acknowledge / dismiss / useful / not_useful only; no undismiss in MVP.

## S0 gate

See `docs/verification/insight-p1-s0-gate.md`. Summary:

| Item | Result |
|---|---|
| P1-G0 contract audit | **PASS** (boundaries explicit; missing P0 APIs listed) |
| P1 schemas + tests | **PASS** (`pnpm exec vitest run packages/project-insight`, 11 tests) |
| Lossless P0 consume API | **BLOCKED** until P0 `append_seq` / `listEventsForward` |
| HEAD-bound JUnit | **BLOCKED** (field never true); rules downgraded |
| S1–S4 engine/UI | **NOT_RUN** (out of S0 scope) |

### S1 entry blockers

1. Implement P0 v3 `append_seq` + `listEventsForward` (or an equivalent documented integer cursor with tests against insert order, not `observedAt`).
2. Optionally copy `reportSourceId` onto test payloads (nice-to-have; `relativePath` is enough).
3. Do not enable `R-TEST-EVIDENCE-GAP` until binding exists.

No notifications, model calls, or pilot-repo writes were performed in S0.
