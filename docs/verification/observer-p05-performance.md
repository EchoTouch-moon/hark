# Observer P0.5 H05 Performance

`NO_PRIOR_BASELINE`. Binding command:

```bash
OBSERVER_BENCH_ITERS=30 OBSERVER_BENCH_IDLE_MS=1800000 \
  pnpm exec tsx scripts/observer-bench.ts
```

Script coverage (confirmed in JSON `coverage` object): four scenarios after 3 warmup runs; idle 1 800 000 ms; 1 000 unchanged + 100 changed DB growth; `GIT_TIMEOUT` / `OUTPUT_LIMIT` / `REPORT_TOO_LARGE`.

- Raw JSON: `docs/verification/data/observer-p05-bench-2026-10-28T13-13-18-000Z.json`
- Raw CSV: `docs/verification/data/observer-p05-bench-2026-10-28T13-13-18-000Z.csv`
- Log: local `~/.grok/long-running-background-tasks/observer-bench-p05.log` (not committed)
- Machine: darwin 27.0.0 arm64, Apple M1 8c / 16 GB, Node v22.23.2, Git 2.49.0, SQLite 3.51.3, `journal_mode=wal`
- Large repo: **synthetic 10 001 tracked files** (10k–50k band). No real 10k–50k working tree was measured (`PF-05` `BLOCKED_ENVIRONMENT`).

Warmup: 3 discarded first-scans per size, then 30 measured.

| Suite | tracked | first n/p50/p95/max ms | unchanged | changed | burst 300 hints | max in-flight git |
|---|---|---|---|---|---|---|
| small | 201 | 30 / 109.65 / 114.19 / 115.83 | 30 / 54.11 / 58.26 / 60.32 | 30 / 54.41 / 59.48 / 60.01 | 30 / 114.49 / 131.25 / 139.67 | 1 |
| medium | 2 001 | 30 / 113.67 / 116.75 / 118.59 | 30 / 56.20 / 60.19 / 64.87 | 30 / 55.36 / 59.84 / 62.75 | 30 / 115.85 / 119.65 / 120.00 | 1 |
| large-synthetic | 10 001 | 30 / 135.97 / 146.32 / 149.39 | 30 / 68.38 / 71.71 / 72.87 | 30 / 67.79 / 71.57 / 73.71 | 30 / 137.86 / 144.32 / 146.86 | 1 |

Idle 30 min (`durationMs` 1 800 066, 61 samples / 30 s): this-process CPU mean **0.06 %**, RSS peak **121.31 MB** → end **59.28 MB**. Idle WAL 206 032 → 683 952 bytes (reconcile every 60 s).

DB growth (medium-small growth fixture, 400 tracked files):

| Workload | user event delta | sqlite+wal+shm before | after |
|---|---|---|---|
| 1 000 unchanged scans | **0** | 222 296 | 4 456 024 |
| 100 real worktree changes | **100** | 4 456 024 | 4 652 704 |

Unchanged scans do not append timeline events. Observation **runs** still grow WAL (bounded-retention item, not user timeline).

Resource limits (sibling repo stayed `OK`):

| Case | Result |
|---|---|
| Git timeout | `GIT_TIMEOUT` |
| Git stdout cap | `OUTPUT_LIMIT` |
| JUnit oversize | `REPORT_TOO_LARGE`, test `UNKNOWN` (not PASS) |

p95 on these fixtures is far under 10 s. Hard gates: per-project git scans ≤ 1 (observed), global default ≤ 2.

| ID | Result |
|---|---|
| PF-01 | PASS |
| PF-02 | PASS |
| PF-03 | PASS (`observer.pf.test.ts` + bench `resourceLimits`) |
| PF-04 | PASS (H01/H02 still green; no untracked skip) |
| PF-05 | BLOCKED_ENVIRONMENT for a real 10k–50k repo; synthetic 10 001 tracked used |
