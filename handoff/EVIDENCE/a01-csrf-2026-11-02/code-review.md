# A-01 CSRF code review

Date: 2026-11-02

## Scope inspected

- `apps/server/src/http/app.ts`
- `apps/server/src/http/hearth.http.test.ts`
- `apps/web/src/features/api/client.ts`
- `apps/web/src/features/hearthViewModel.tsx`
- `tests/unit/api-csrf.test.ts`
- `tests/e2e/hearth-permissions-csrf.spec.ts`
- supplied A-01 evidence under `handoff/EVIDENCE/a01-csrf-2026-11-02/`

## Evidence independently checked

- `pnpm exec vitest run tests/unit/api-csrf.test.ts apps/server/src/http/hearth.http.test.ts`: 2 files, 34 tests passed.
- `git diff --check`: passed.
- The red evidence shows both missing and incorrect CSRF token paths returned 200 before the fix. The state evidence shows the old paths wrote `observe: false -> true`; the fixed paths returned 403 and retained `observe: false`, with research/model and audit snapshots unchanged.
- The focused browser evidence records both real first-session/authorization/refetch and a routed `ORIGIN_DENIED` response with one write only.

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

The server removes only the former permissions-PUT exemption. The common pre-handler now validates the session, CSRF token, and Origin before the route can persist observe. The route still parses the strict `{ observe: boolean }` body and delegates only the observe mutation; the response contract continues to force `execute: false`.

The client retries a write once only after parsing exactly `401 UNAUTHORIZED` or `403 CSRF_DENIED`, only for normalized same-origin `/api/v1/` requests and replayable null/string bodies, and only while the abort signal remains live. `ORIGIN_DENIED` and other business responses cannot enter that branch. The retry tests cover the gate cases, unrelated 401/403 combinations, a second rejection, streams, network failure, cancellation before both the write and retry, and non-local URLs. The browser test confirms the view-model path gets a session, writes with a CSRF header, then re-fetches; the failure path keeps its inline error and does not duplicate the write.

## Skill-perspective check

The required `remove-ai-slops` and `programming` skill files were not available under the configured local skill roots, so their documented perspectives were applied directly. No deletion-only or tautological test was found: the persistence assertions exercise observable state and audit behavior; retry tests distinguish allowed gate errors from same-status business errors; the browser tests exercise the UI flow. Production changes do not add unnecessary parsing, normalization, escape hatches, or abstractions beyond the explicit retry safety classifier needed for the task.

## Result

- `codeQualityStatus`: CLEAR
- `recommendation`: APPROVE
- `blockers`: none
