# Project Observer P0.5 Gate Review

Binding checklist: `docs/15-PROJECT-OBSERVER-P05-HARDENING.md` (original G0–G8). Status vocabulary is only `PASS` / `FAIL` / `NOT_RUN` / `BLOCKED` (plus overall `CONDITIONAL_PASS` as defined by the waiver rule).

- Commit / branch: `5cfbdcc` on `master`, plus uncommitted close-out (bench coverage, PF-03 tests, this report). No product-scope expansion.
- Node / pnpm / Git / SQLite / macOS: Node v22.23.2, Git 2.49.0, SQLite 3.51.3, darwin 27.0.0 arm64 M1 16 GB
- DB migration & backup: v2; `VACUUM INTO` restore PASS; WAL-reset: SQLite 3.51.3 + single-writer lock
- Typecheck / observer tests / full tests / browser: `pnpm typecheck` PASS; observer+HTTP 57 PASS; `pnpm test` **188 PASS**; browser fixture register on `:4326` — UNKNOWN is not `is-success` (`handoff/EVIDENCE/observer-p05-projects.png`, `observer-p05-detail.png`)

## Gates

| Gate | Result | Evidence |
|---|---|---|
| G0 | PASS | HEAD `5cfbdcc`; observer schema v2; tests reproducible; no Vitest JSON / LLM / notify / execute |
| G1 | PASS | `observer.h01.test.ts` ID-01..07 |
| G2 | PASS | `observer.h02.test.ts` RE-01..08 |
| G3 | PASS | `observer.h03.test.ts` SE-01..08; HTTP CSRF/session |
| G4 | PASS | `observer.h04.test.ts` DB-01..07 |
| G5 | PASS | four scenarios × **n=30** after warmup 3; idle **1 800 066 ms** / 61 samples; DB/WAL growth; `GIT_TIMEOUT`/`OUTPUT_LIMIT`/`REPORT_TOO_LARGE`. PF-05 real large repo **BLOCKED_ENVIRONMENT** (synthetic 10 001 tracked). See `observer-p05-performance.md` |
| G6 | BLOCKED (waiver path) | pindou PASS; prototype-skill-lab PASS; **agent-internet-lab BLOCKED_PATH_UNAVAILABLE**. No homedir search, no fabricated register |
| G7 | PASS | typecheck, 188 tests, browser UNKNOWN not green |
| G8 | PASS | commands and files listed below; no invented PASS |

## Real pilots (read-only)

Command: `HEARTH_PILOT_PINDOU=… HEARTH_PILOT_SKILL_LAB=… pnpm exec tsx scripts/observer-pilot-verify.ts`

| Repo | Result | Notes |
|---|---|---|
| pindou | PASS | `main` `f57fc770361e`; two extra scans → 0 events; git fingerprint unchanged; test UNKNOWN |
| prototype-skill-lab | PASS | `feat/m3-host-native` `3352b3615e49`; same; test UNKNOWN |
| agent-internet-lab | BLOCKED_PATH_UNAVAILABLE | documented path absent; not searched elsewhere |

## Performance snapshot

Dataset: `docs/verification/data/observer-p05-bench-2026-10-28T13-13-18-000Z.json` (+ `.csv`)

- Idle 30 min this-process CPU 0.06 %, RSS peak 121.31 MB
- 1 000 unchanged scans: **eventDelta 0**; WAL/sqlite still grew (run log, not timeline)
- 100 changes: eventDelta 100
- Limits: GIT_TIMEOUT sibling collection OK; OUTPUT_LIMIT; REPORT_TOO_LARGE → UNKNOWN

## Safety

Malicious fixtures: `observer.h03.test.ts`. SE-08 HEAD/status/index unchanged. Pilots: `repoUnchanged: true`.

## Commands run this close-out

```text
pnpm exec vitest run packages/project-observer apps/server/src/http/observer.http.test.ts
pnpm typecheck
pnpm test                                          # 188 passed
OBSERVER_BENCH_ITERS=30 OBSERVER_BENCH_IDLE_MS=1800000 pnpm exec tsx scripts/observer-bench.ts
HEARTH_PILOT_* pnpm exec tsx scripts/observer-pilot-verify.ts
node /tmp/observer-p05-browser.mjs                 # :4326 fixture only
```

## Waivers / next

- G6 third repo: supply an absolute path, re-run the pilot script, then G6 can become PASS and overall can become PASS.
- PF-05: optional later sample of a real 10k–50k working tree; do not treat 10 001 synthetic files as a real large repo.
- Unchanged-scan WAL growth: implement run retention without deleting event chains (already specified, not a G4 fail).

## Overall

**CONDITIONAL_PASS**

Rule: G0–G5, G7, G8 PASS; G6 is two real-pilot PASS + one `BLOCKED_PATH_UNAVAILABLE` only. Not 3/3 pilots. Not a full `PASS`.
