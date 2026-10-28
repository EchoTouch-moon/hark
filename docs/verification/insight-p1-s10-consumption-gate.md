# Insight P1 · S1.0 consumption gate

- Date: 2026-10-28
- Workspace: `/Users/v/new-idea/hark`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md`
- ADRs: `docs/adr/ADR-INSIGHT-001.md`, `docs/adr/ADR-INSIGHT-002.md`
- S0 commit: `b59d380 feat(insight): freeze P1 S0 contracts and observer consume audit`
- S1.0 commit: `0c6ca4f feat(observer): add schema v3 append_seq and listEventsForward`

## Overall

**Forward consume for live, registered projects: PASS.**

**Lossless consume across hard project delete: BLOCKED** (event payloads are destroyed; hole is detectable).

**Signal Extractor / Insight Store / notifications / models: NOT_RUN** (out of S1.0 scope).

## Commands

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/project-observer apps/server/src/http/observer.http.test.ts` | **PASS** 68 tests / 12 files |
| `pnpm exec vitest run packages/project-insight` | **PASS** 11 tests / 2 files |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **PASS** |
| `pnpm exec eslint` on S1.0 paths | **PASS** |
| HTTP `GET .../events` contract | **PASS** (still `{ events, nextCursor }`, DESC) |
| Notifications / model calls / pilot-repo writes | **NOT_RUN** |

## Required tests

| Requirement | Result | Test |
|---|---|---|
| Same `occurred_at`, insert order | **PASS** | `observer.s10.test.ts` same-time |
| A → B → A consume order | **PASS** | `observer.s10.test.ts` HEAD A/B/A |
| Pagination + inserts, frozen watermark | **PASS** | `observer.s10.test.ts` highWatermark |
| Restart continues sequence | **PASS** | `observer.s10.test.ts` restart |
| VACUUM keeps `append_seq` | **PASS** | `observer.s10.test.ts` VACUUM |
| Injected tx fault: no half-commit, counter rolls back | **PASS** | `observer.s10.test.ts` + H04 DB-01 |
| Tail delete does not reuse seq | **PASS** | `observer.s10.test.ts` tail |
| v2 → v3 migrate + failed v3 rollback | **PASS** | `observer.s10.test.ts` migrate |
| DESC UI pagination unchanged | **PASS** | `observer.s10.test.ts` UI + H04 DB-07 + HTTP |
| Project delete / re-register gap | **PASS** (detectable) | `PROJECT_REMOVED` / `STREAM_EPOCH_MISMATCH` |
| Empty page at watermark | **PASS** | `observer.s10.test.ts` empty |
| Older-backup rewind | **PASS** (detectable) | `CURSOR_AHEAD_OF_STREAM` |

## Gate table

| Item | Result | Notes |
|---|---|---|
| Schema v3 `append_seq` unique, counter-backed | **PASS** | `observer_meta.append_seq`; not `MAX(remaining)` |
| `listEventsForward` ASC + `hasMore` + frozen hw | **PASS** | in-process; HTTP DESC left unchanged |
| v2 UI/HTTP compatibility | **PASS** | extra optional `appendSeq` on events |
| Repeat open is idempotent | **PASS** | H04 DB-02 now expects version 3 |
| Hard-delete event replay | **BLOCKED** | payloads gone by design |
| Delete-gap detection | **PASS** | tombstone + `streamEpoch` |
| DB rewind detection | **PASS** | `CURSOR_AHEAD_OF_STREAM` |
| S1.1 Signal Extractor | **NOT_RUN** | next stage |

## Contract limits (must not be reported as PASS)

1. Deleted events cannot be consumed later. Call that **BLOCKED**, not lossless.
2. v2 backfill order is reconstructed from post-v2 `rowid` (`legacy_order_reconstructed=1`). Original insert order of pre-v3 rows is unrecoverable.
3. `streamEpoch` does not change on ordinary process restart or VACUUM. It changes on re-register after delete. Backup restore is detected by cursor vs allocated counter, not by bumping epoch inside the restored file.

## S1.1 entry

Allowed: Signal Extractor on `listEventsForward` for **live** projects, advancing a P1-owned cursor only after durable processing.

Not allowed until S1.1 designs it: treating a new epoch as continuation of an old cursor; enabling R-TEST-EVIDENCE-GAP; notifications; model calls.
