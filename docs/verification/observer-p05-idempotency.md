# Observer P0.5 H01 Idempotency

Call chain: `hintDirty` / `scanProject(manual|reconcile|startup)` → in-flight coalesce → per-project mutex → global semaphore(2) → `GitSource.scan` → normalize fingerprint (no observedAt) → diff(previous pointer only) → SQLite `BEGIN IMMEDIATE` insert run/snapshot/events + CAS `current_revision`.

| ID | Result | Evidence |
|---|---|---|
| ID-01 | PASS | `observer.h01.test.ts` 100 identical scans, event count unchanged |
| ID-02 | PASS | A→B→A two `WORKTREE_STATE_CHANGED` |
| ID-03 | PASS | 60 concurrent requests, `maxActiveScans === 1` |
| ID-04 | PASS | retry after commit, snapshot id stable |
| ID-05 | PASS | second `ProjectObserver` on same DB throws `WRITER_LOCKED` |
| ID-06 | PASS | real git rename + 中文/空格/newline |
| ID-07 | PASS | 20 identical adapter faults, ADAPTER_ERROR count stable |
