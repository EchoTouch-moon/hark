# G1-A thread/chat scope code review

Date: 2026-11-02

## Scope reviewed

- `apps/server/src/http/routes/chat.ts`
- `apps/server/src/http/routes/threads.ts`
- `apps/server/src/http/routes/thread-scope.ts`
- `packages/storage/src/storage.ts`
- `apps/server/src/http/g1a-thread-scope.test.ts`
- Adjusted G1-A loopback and legacy-security tests.

The approved, temporary product boundary is: project-scoped chat remains closed until a trustworthy binding model exists; global chat remains available; existing project-bound and orphaned records are preserved but not inferred or adopted.

## Evidence independently checked

- `git diff --check`: passed.
- `pnpm typecheck`: passed.
- `pnpm exec vitest run apps/server/src/http/g1a-thread-scope.test.ts apps/server/src/http/g1a-security.test.ts apps/server/src/http/g1a-live.test.ts apps/server/src/http/app.test.ts packages/storage/src/storage.test.ts`: 5 files / 88 tests passed.
- Reviewed all current server references to `/threads`, `/chat`, `ensureThread`, and `listThreads` to check for unguarded read/write entry points in this route surface.

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

The route boundary closes the stated gaps before `ensureThread`, chat persistence, audit mutation, or the mock adapter can run. Explicit project context is rejected consistently for thread creation and list/detail/proactive reads, as well as chat writes and history reads. The `globalThreadDenial()` helper correctly blocks existing legacy project-bound records and refuses to adopt orphan chat records; fresh IDs can still create an explicit global thread.

The database filter is applied before the list limit in `listGlobalThreads`, so a large number of withheld project-bound rows cannot starve legitimate global rows. The tests cover mismatched and matching legacy project IDs, unknown project/thread inputs, conflicting aliases, orphan data, pagination, concurrent global/denied requests, restart, and no-side-effect snapshots. They exercise observable behavior rather than asserting private implementation details.

This is deliberately a single-principal context-consistency control. It does not establish multi-tenant authorization, trustworthy project identity, a binding migration, or card/run/SSE scope. Those limits are maintained by the design and test claims.

## Skill-perspective check

`remove-ai-slops` and `programming` skill files were not available at the configured local locations, so I applied their stated criteria directly. The review found no deletion-only or tautological tests: the new cases prove that rejected paths leave persistent state and the adapter untouched, while global-chat compatibility remains observable. The shared denial helper and filtered storage query are the smallest production mechanisms needed for the specified boundary; no untyped escape hatch, unnecessary parser, normalizer, or abstraction was introduced.

## Result

- `codeQualityStatus`: CLEAR
- `recommendation`: APPROVE
- `blockers`: none
