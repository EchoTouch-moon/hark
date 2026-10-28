# Insight P1 · S1.2 gate

- Date: 2026-10-28
- Workspace: `/Users/v/new-idea/hark`
- Base HEAD: `17aa2ed`
- S1.1 feature: `57191f9`
- ADR: `docs/adr/ADR-INSIGHT-004.md`

## Overall

**PASS**

Durable inbox, atomic checkpoint, replay safety, and source-reset freeze are in place. No Insight cards, notifications, or model calls.

## Commands

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/project-insight packages/project-observer apps/server/src/http/observer.http.test.ts` | **PASS** 110 tests / 17 files |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **PASS** |
| `pnpm exec eslint packages/project-insight --max-warnings=0` | **PASS** |
| Insight Store / rule UI / Hermes / Pi / notifications | **NOT_RUN** |
| Real pilot repo writes | **NOT_RUN** |

## Scenario matrix

| ID | Result | Notes |
|---|---|---|
| ST-01 | **PASS** | Second consume inserts 0; unique `signal_id` |
| ST-02 | **PASS** | `after-signals` rolls back inbox and checkpoint |
| ST-03 | **PASS** | `after-cursor` / `before-commit` roll back |
| ST-04 | **PASS** | Reopen store; cursor and ids match |
| ST-05 | **PASS** | Second process `WRITER_LOCKED`; in-process mutex serializes |
| ST-06 | **PASS** | `NO_SIGNAL` advances `after_seq` |
| ST-07 | **PASS** | Missing snapshot does not create checkpoint |
| ST-08 | **PASS** | `PROJECT_REMOVED` freezes, OPEN interruption, inbox purged |
| ST-09 | **PASS** | Epoch 2 ACTIVE at 0-based consume; epoch 1 frozen |
| ST-10 | **PASS** | `CURSOR_AHEAD_OF_STREAM` freezes; cursor not zeroed |
| ST-11 | **PASS** | Frozen watermark; remainder on next round |
| ST-12 | **PASS** | Persisted payload `orderUncertainty=reconstructed_rowid` |
| ST-13 | **PASS** | Failed v1 migration; no `signal_inbox` |
| ST-14 | **PASS** | Garbage file → `InsightError` / `SOURCE_UNREADABLE` |
| ST-15 | **PASS** | Commit after P0 delete can succeed; next consume freezes |

## Gates

| Gate | Result |
|---|---|
| G0 baseline Observer + S1.1 | **PASS** |
| G1 storage / unique / atomic tx | **PASS** |
| G2 cursor monotonic + idempotent replay | **PASS** |
| G3 crash injection + concurrent lock | **PASS** |
| G4 epoch / delete / rewind / evidence | **PASS** |
| G5 typecheck / eslint / regression | **PASS** |
| G6 this report | **PASS** |

## Limits

1. P0 and P1 are two SQLite files. There is **no** cross-database exactly-once. ST-15 documents the gap.
2. `PROJECT_REMOVED` purges inbox payloads and keeps frozen checkpoints + interruptions. Full wipe is `purgeProject`.
3. Interruptions stay `OPEN` until a later stage acknowledges them.
4. `consumeProjectBatch` is manual. No scheduler.
5. Fastify is not wired; path helper is `defaultInsightDbPath` / `HEARTH_INSIGHT_DB`.

## S1.3 entry

Allowed: rule engine over `signal_inbox` using committed checkpoints.

Not allowed: treating a new epoch as the old cursor; auto-resolving interruptions; enabling `R-TEST-EVIDENCE-GAP`; notifications; LLM.
