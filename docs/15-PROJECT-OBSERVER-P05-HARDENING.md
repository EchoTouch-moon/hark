# 15｜Project Observer P0.5 Hardening Gates

Binding gates are the original G0–G8 from the P0.5 taskbook. This file is the in-repo checklist. Product scope stays P0 observation only.

| Gate | Must hold | Waiver |
|---|---|---|
| G0 | Current commit, schema, reproducible tests; no extra product scope | none |
| G1 | ID-01..07 PASS | none |
| G2 | RE-01..08 PASS | none |
| G3 | SE-01..08 PASS | none |
| G4 | DB-01..07 PASS | none |
| G5 | PF-01..05 with 4 scenarios × ≥30 samples, 30 min idle, DB/WAL growth, limit degradation | real large-repo absence may be `BLOCKED_ENVIRONMENT` with synthetic 10k–50k |
| G6 | Two real pilots full read-only; third missing path = `BLOCKED_PATH_UNAVAILABLE` | only the missing third path |
| G7 | `pnpm typecheck`, observer/HTTP, `pnpm test`, browser key regression | none |
| G8 | Commands, logs, files; no invented PASS | none |

Overall `PASS` requires G0–G8 PASS and three real pilots. `CONDITIONAL_PASS` only when G0–G5/G7/G8 PASS and G6 is two PASS + one `BLOCKED_PATH_UNAVAILABLE`.
