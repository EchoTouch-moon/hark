# A-01 cold-start code review

Date: 2026-11-02

## Scope inspected

- `apps/web/src/features/api/client.ts`
- `apps/web/src/features/hearthViewModel.tsx`
- `tests/unit/hearth-cold-start.test.ts`
- `tests/e2e/hearth-permissions-csrf.spec.ts`
- Supplied red/green evidence: `<local-evidence>`, `<local-evidence>`, and `<local-evidence>`

## Evidence independently checked

- `git diff --check`: passed.
- `pnpm exec vitest run tests/unit/hearth-cold-start.test.ts tests/unit/api-csrf.test.ts`: 2 files / 26 tests passed.
- `pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/hearth-permissions-csrf.spec.ts`: 3 browser tests passed. The cold-start test uses a separate temporary directory for all relevant server stores, verifies the server session setting is null and browser storage is empty, delays session creation until an actual first `/hearth` response, then observes 401 -> session 200 -> Hearth 403 permission view. It verifies one successful PUT, a later 200 GET, and successful reload.
- The supplied red log shows the original implementation failed the same new cold-start scenario at the missing `去授权` control after the initial 401.

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

`fetchHearthViewModel()` retains its dedicated parsing path so valid 403 `permission_denied` and 503 error ViewModels remain renderable. It only initializes a session and retries once for an exact 401 body whose `error.code` is `UNAUTHORIZED`; a malformed or different 401 is not retried. The AbortSignal reaches the first read, session bootstrap, and retry; cancellation before bootstrap prevents a session request, and cancellation during bootstrap prevents the second Hearth read.

The new integration scenario proves the previously missing condition rather than pre-seeding it: a real isolated server is launched with a null session record, and the browser has no cookie or local storage. It records the required cold-start state transition and checks the later authorization write and post-write read. This is a behavior-oriented regression, not a fixture-only or implementation-mirroring test.

## Skill-perspective check

The `remove-ai-slops` and `programming` skill files were not available in this review environment, so their stated criteria were applied directly. No deletion-only or tautological tests were found. The new unit tests distinguish the security-relevant retry condition from malformed/non-gate 401s, preserve 403/503 response semantics, and exercise abort paths. The production change adds one narrowly scoped response-code/body discriminator and reuses the existing session function; it introduces no untyped escape hatch, needless abstraction, or unrelated parsing.

## Result

- `codeQualityStatus`: CLEAR
- `recommendation`: APPROVE
- `blockers`: none
