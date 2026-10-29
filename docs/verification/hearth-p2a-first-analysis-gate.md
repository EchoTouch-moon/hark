# Hearth P2-A first analysis gate

- Date: 2026-10-29
- Baseline: `a0d845b`
- Spec: `docs/18-HEARTH_P2_AGENT_INTELLIGENCE.md`
- ADR: `docs/adr/ADR-ANALYSIS-001.md`

## Overall

**CONDITIONAL_PASS**

The click-to-analyze loop works on the registered `pindou` repo. Mock Provider produced an evidence-backed card and did not mutate Git. Live Pi is **LIVE_BLOCKED** (invalid API key); mock output was not presented as a real Pi analysis.

## A. Entry

| Check | Result |
|---|---|
| Observe page 「分析当前项目」 | PASS |
| Insight page 「深入分析」 | PASS (same `POST /api/v1/analysis/runs`) |
| GET does not call a model | PASS (`analysis.http.test.ts`) |
| Click required | PASS |

## C. Context assembly

| Check | Result |
|---|---|
| Snapshot, HEAD, events, allowlisted docs | PASS |
| Path traversal / symlink escape rejected | PASS |
| `.env` / secrets not included | PASS |
| UNKNOWN tests not described as pass | PASS |
| No commit-count completion claim | PASS |

## D. Provider

| Check | Result |
|---|---|
| `AnalysisProvider` + Mock | PASS |
| Pi adapter `--no-tools` | Implemented |
| Timeout / cancel / in-flight 409 | PASS |
| Default env sanitization | PASS |
| Live Pi | **LIVE_BLOCKED** `authentication_error` / invalid x-api-key |

## E–F. Card and run record

| Check | Result |
|---|---|
| Zod recommendation schema | PASS |
| Unverified evidence marked | PASS |
| Run binds snapshotId / HEAD / fingerprint | PASS |
| Stale flag when snapshot/HEAD changes | PASS (computed on read) |
| Card shows evidence, no execute/edit | PASS |

## G. Verification

| Command | Result |
|---|---|
| analysis unit + HTTP | 8 passed |
| `pnpm typecheck` | PASS |
| eslint on P2-A files | PASS `--max-warnings=0` |
| `pnpm test` | **301 passed** |
| Browser mock analysis on pindou | PASS, Git fingerprint unchanged `f57fc770361e` |
| Live Pi | LIVE_BLOCKED |

Screenshot: `handoff/EVIDENCE/p2a-first-analysis-card.png`  
JSON: `docs/verification/data/hearth-p2a-first-analysis.json`

The card honestly says tests are UNKNOWN, the worktree is dirty, and the provider is Mock. Suggested next step requires user confirmation.

## Open issues

1. Live Pi needs a working provider credential; current CLI probe fails auth even when allowlisted env names are passed.
2. Real pindou still has no JUnit, so analysis stays observation-level.
3. Full-page observe screenshot includes the existing canonical path field; only the card crop is stored as gate evidence.

## Non-goals kept

No notifications, schedulers, code edits, multi-agent, or P2-B/C.

## Final result

**CONDITIONAL_PASS**
