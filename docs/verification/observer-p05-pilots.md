# Observer P0.5 H06 Real pilots

Read-only. No files, index, or HEAD were modified in the real repos.

Command: `pnpm exec tsx scripts/observer-pilot-verify.ts` (temp DB, not `data/observer.sqlite`).

| Repo | Result | HEAD | Branch | Two extra scans | Repo fingerprint |
|---|---|---|---|---|---|
| pindou | PASS | `f57fc770361e` | main | 0 change events | unchanged |
| prototype-skill-lab | PASS | `3352b3615e49` | feat/m3-host-native | 0 change events | unchanged |
| agent-internet-lab | BLOCKED_PATH_UNAVAILABLE | — | — | — | path not present; not searched beyond the documented location |

Test status: UNKNOWN / UNKNOWN (no declared JUnit). Collection OK. Worktrees were already dirty before observation.
