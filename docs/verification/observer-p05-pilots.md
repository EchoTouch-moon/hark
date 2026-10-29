# Observer P0.5 H06 Real pilots

Read-only. No files, index, or HEAD were modified in the real repos.

```bash
HEARTH_PILOT_PINDOU=<absolute git path>
HEARTH_PILOT_SKILL_LAB=<absolute git path>
pnpm exec tsx scripts/observer-pilot-verify.ts
```

Temp observer DB (not `data/observer.sqlite`).

| Repo | Result | HEAD | Branch | Two extra scans | Repo fingerprint | Test |
|---|---|---|---|---|---|---|
| pindou | PASS | `f57fc770361e` | main | 0 change events | unchanged | UNKNOWN / UNKNOWN |
| prototype-skill-lab | PASS | `3352b3615e49` | feat/m3-host-native | 0 change events | unchanged | UNKNOWN / UNKNOWN |
| agent-internet-lab | BLOCKED_PATH_UNAVAILABLE | — | — | — | path not present at the documented location; no extra search | — |

Worktrees were already dirty before observation. Collection OK.
