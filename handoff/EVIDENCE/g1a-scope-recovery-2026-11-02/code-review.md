# G1-A project-scope and recovery evidence review

Date: 2026-11-02

## Scope reviewed

- `docs/verification/g1a-project-scope-recovery-2026-11-02.md`
- `handoff/EVIDENCE/g1a-scope-recovery-2026-11-02/`
- New handoff entries in `STATUS.md`, `DECISIONS.md`, `BLOCKERS.md`, and `MORNING-REPORT.md`
- Current baseline `bot/hearth-g0-contract@6ef6fe00c90545749f8beef25ac5753e13ccc8e9`
- Relevant current routes: `routes/chat.ts`, `routes/threads.ts`, `routes/cards.ts`, and `routes/runs.ts`

## Evidence independently checked

- `git diff --check`: passed.
- Re-ran `pnpm exec vitest run apps/server/src/http/g1a-security.test.ts packages/storage/src/storage.test.ts packages/core/src/orchestration/orchestrator.test.ts`: 3 files / 50 tests passed.
- Queried Actions run `41414610654`: its head SHA is `6ef6fe00c90545749f8beef25ac5753e13ccc8e9`; Linux, Windows, and `ci-gate` all completed successfully.
- Read both behavior-characterization sources and their sanitized logs. The scope source genuinely uses two seeded project IDs and two pre-bound threads, invokes the real Fastify routes, and its logged state transitions agree with the current `chat.ts` and `threads.ts` code. The recovery source uses a separate process for setup, actually receives `SIGKILL`, then starts another process to call the default-disabled recovery path. Its claims are bounded to the stated pre-seeded `executing`/`verifying` cases.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Assessment

The documents do not turn the single-principal project-context observations into a multi-tenant vulnerability claim. They correctly identify the incompatible `projectId` and thread-ID behavior as a contract/consistency gap and hold the required binding model for review. They also correctly retain cards, runs, SSE, concurrency, reset provenance, and broader recovery faults as separate work; no scope creep is presented as completed.

The recovery evidence is especially bounded: its source creates a database state and then kills a waiting setup process, rather than interrupting a running executor. The documentation says so and excludes the completed-to-evidence window, real providers, Windows, and running-executor faults. The executor spy is only a defense-in-depth assertion for a branch that exits before execution; it is not used to overclaim execution interruption coverage.

Existing reset tests support the stated fail-closed behavior for unclassified data. The documents do not claim a trusted demo-provenance model exists, and do not suggest loosening reset as a workaround.

## Skill-perspective check

The `remove-ai-slops` and `programming` skills were not available through a readable skill entry in this review environment, so their criteria were applied directly. The characterization sources are not permanent tests that merely codify the requested fix: they preserve current behavior as forensic evidence and are deliberately kept outside the default test suite. The production diff has no production code, parser, normalization, untyped escape hatch, or new abstraction. The evidence-only private executor replacement is constrained to a temporary recovery probe and is paired with explicit limits; it does not impose maintenance burden on shipped code. No test or document violates either perspective.

## Result

- `codeQualityStatus`: CLEAR
- `recommendation`: APPROVE
- `blockers`: none
