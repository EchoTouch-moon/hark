# Insight P1 · S0 gate

- Date: 2026-10-28
- Workspace: `/Users/v/new-idea/hark`
- Spec: `docs/16-HEARTH_PROJECT_INSIGHT_P1.md`
- Audit: `docs/verification/insight-p1-s0-contract-audit.md`
- ADR: `docs/adr/ADR-INSIGHT-001.md`
- HEAD: `5cfbdcc feat(observer): add local project observer and reliability gates`
- Working tree: dirty (S0 files uncommitted; P0.5 close-out files also present). No commit this round.

## Overall

**P1-G0 = PASS** with explicit S1 blockers. S1–S4 **NOT_RUN**.

This is a contract freeze, not an Insight Engine. Missing P0 consume/HEAD-binding APIs are **BLOCKED**, not treated as implemented.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/project-insight` | **PASS** 11 tests / 2 files |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **PASS** |
| `pnpm exec eslint packages/project-insight vitest.config.ts --max-warnings=0` | **PASS** |
| Notifications / model calls / pilot-repo writes | **NOT_RUN** (forbidden in S0) |
| P0 v3 `append_seq` implementation | **NOT_RUN** (S1 prerequisite, not S0) |

## Gates

| Gate | Result | Evidence |
|---|---|---|
| P1-G0 contract audit | **PASS** | Audit + ADR answer spec §19; Zod freeze in `packages/project-insight` |
| P1-G1 Signal engine | **NOT_RUN** | S1 |
| P1-G2 Rule/episode engine | **NOT_RUN** | S1–S2 |
| P1-G3 Persistence | **NOT_RUN** | S2; `insights.sqlite` not created |
| P1-G4 API/security | **NOT_RUN** | S3 |
| P1-G5 UI | **NOT_RUN** | S4 |
| P1-G6 Performance | **NOT_RUN** | S4 |
| P1-G7 Pilots | **NOT_RUN** | S4; no real-repo writes |
| P1-G8 Full-repo regression | **NOT_RUN** | Full `pnpm test` not required to freeze S0; insight package + tsc/eslint ran |
| P1-G9 Delivery pack | **NOT_RUN** | Engine not built |

## Capability blockers (not G0 failures)

| Item | Result | Why |
|---|---|---|
| Lossless P0 consume API | **BLOCKED** | No `append_seq`; public `listEvents` is `occurred_at DESC, id DESC` |
| HEAD-bound JUnit | **BLOCKED** | `headBound` always false; parser has no commit SHA |
| Event push / 5s p95 wakeup | **BLOCKED** | No callback; 60s poll only until a hook exists |

## S1 must not start until

1. P0 schema v3 ships `append_seq` + `listEventsForward` (insert-order tests; not `observedAt`; not implicit `rowid`).
2. Insight adapter uses that API in-process; UI DESC pagination stays as-is.
3. `R-TEST-EVIDENCE-GAP` remains default-off.

## Frozen artifacts

- `packages/project-insight/src/contracts.ts` — Signal / Candidate / Insight / EvidenceRef
- `packages/project-insight/src/observer-port.ts` — `P0_CAPABILITIES` inventory
- `packages/project-insight/src/contracts.test.ts` and `p0-port.audit.test.ts`
