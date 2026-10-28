# Observer P0.5 H02 Recovery

| ID | Result | Evidence |
|---|---|---|
| RE-01 / RE-02 | PASS | close + HEAD change + startup: one `OBSERVATION_GAP`, latest HEAD, no fabricated intermediates |
| RE-03 | PASS | GIT_TIMEOUT isolated; other repo still OK |
| RE-04 | PASS | chmod 000 → UNAVAILABLE keeps last-good HEAD; restore → RECOVERED |
| RE-05 | PASS | corrupt JUnit is not OBSERVED PASS; git HEAD unchanged |
| RE-06 | PASS | covered by P0 T16 reconcile after missed watch + this suite's rescan |
| RE-07 | PASS | paused project rejects reconcile; remove drops registry |
| RE-08 | PASS | 20 unavailable/recovered cycles, ≤1 gap, no event storm |
