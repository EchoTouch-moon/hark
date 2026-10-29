# ADR-INSIGHT-005 · S2 issue identity, rule cursor, baseline

- Status: Accepted for S2
- Date: 2026-10-29
- Depends on: ADR-INSIGHT-001..004

## Decision

1. **Semantic dedup key** is `issueKey = sha256(projectId, streamEpoch, issueFamily, subjectKey)`. `episodeKey` adds `openingSignalId`. Visible `insight_id` is `ins_` + 16 hex of `episodeKey`. S0 `insightDedupKey(ruleId, …)` is **not** the user-card identity.

2. **`R-TEST-REGRESSION` ID is kept.** User-facing copy describes same-path observed result change. It never says current HEAD regression. Same `test-report-failure` family merges with `R-TEST-FAILURE`; regression ranks higher.

3. **Extractor checkpoint ≠ rule checkpoint.** `consumer_checkpoints` stay on the inbox consumer. `insight_rule_progress` stores `(last_append_seq, last_signal_id, ruleset_version=s2-rules/1)` with CAS `revision`.

4. **Baseline.** First production pass may use `baseline: 'existing-inbox'` so already-buffered signals do not open live cards. Tests use `baseline: 'none'`.

5. **Hard delete.** `purgeProject` removes inbox, checkpoints, interruptions, episodes, evidence, issue state, and rule progress. `PROJECT_REMOVED` still freezes and purges inbox first; S2 then freezes rule progress. Interruptions are not auto-resolved.

6. **`R-TEST-EVIDENCE-GAP` remains disabled.**

## Consequences

- Dismissed episodes stay dismissed on replay.
- Verified recovery plus a later failure opens a new episode.
- Git HEAD/worktree signals stay NO_INSIGHT.
