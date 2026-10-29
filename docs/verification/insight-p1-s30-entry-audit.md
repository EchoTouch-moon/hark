# Insight P1 · S3.0 entry audit

- Date: 2026-10-29
- HEAD: `0001fa0`
- S2 gate: `docs/verification/insight-p1-s2-gate.md` **CONDITIONAL_PASS**

## S2 G6 pilots

| Pilot | Env | Result |
|---|---|---|
| pindou | `HEARTH_PILOT_PINDOU` | **BLOCKED_PATH_UNAVAILABLE** (unset) |
| prototype-skill-lab | `HEARTH_PILOT_SKILL_LAB` | **BLOCKED_PATH_UNAVAILABLE** (unset) |
| agent-internet-lab | `HEARTH_PILOT_AGENT_INTERNET` | **BLOCKED_PATH_UNAVAILABLE** (unset) |

No HOME scan. S3 UI tests use isolated fixture DBs, not real pilots.

## Existing data

- Episodes: `insight_episodes` + `insight_evidence_refs` + `insight_issue_state`
- Rule cursor: `insight_rule_progress` (separate from extractor checkpoints)
- Feedback: **not present in v2** → S3 adds schema v3 `insight_feedback`
- Actions: `acknowledgeEpisode` / `dismissEpisode` already exist; S3 adds HTTP + useful/not_useful

## Workspace

Uncommitted P0.5, `packages/contracts`, `packages/core`, and dirty `apps/server` config/session/services files are left as-is. S3 wires `InsightStore` on `AppDeps` without editing `config.ts`.
