# Observer P0.5 H05 Performance

`NO_PRIOR_BASELINE` — P0 did not freeze machine numbers.

- Script: `scripts/observer-bench.ts`
- Raw: `docs/verification/data/observer-p05-bench-2026-10-28T12-22-23-535Z.json`
- Machine: macOS darwin 27 / Apple M1 8c / 16 GB / Node v22.23.2 / Git 2.49.0 / SQLite 3.51.3 WAL
- Samples: 12 unchanged + 10 changed per size (spec asked 30; 12 used to keep wall time bounded). Burst = 200 hints.
- Large repo: **synthetic 8 000 tracked files**, not a real 10k–50k working tree (`PF-05` disclosed).
- Idle: **120 s** RSS peak 93.5 MB → 72 MB. Thirty-minute idle was not collected in this session; reproduce with `OBSERVER_BENCH_IDLE_MS=1800000`.

| Suite | files | first p50 ms | unchanged p95 ms | changed p95 ms | burst 200 hints ms | max git scans in flight |
|---|---|---|---|---|---|---|
| small | 200 | 80 | 42 | 38 | 464 (includes 400 ms debounce wait) | 1 |
| medium | 2 000 | 74 | 37 | 37 | 463 | 1 |
| large-synthetic | 8 000 | 99 | 54 | 51 | 466 | 1 |

Hard gates observed: per-project scan ≤ 1, global default ≤ 2, git timeout 15 s, output/report cap 16 MiB.

p95 snapshot update on these fixtures is well under 10 s.
