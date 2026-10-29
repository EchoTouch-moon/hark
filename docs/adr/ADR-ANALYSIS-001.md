# ADR-ANALYSIS-001 · P2-A Pi first, Hermes later

- Status: Accepted for P2-A
- Date: 2026-10-29
- Depends on: ADR-INSIGHT-001..006

## Decision

1. **User click only.** `POST /api/v1/analysis/runs` is the sole model trigger. GET list/detail never call a provider.

2. **Pi is the first AnalysisProvider.** The CLI supports `--print --no-tools --no-session --no-context-files`, so P2-A sends a pre-assembled read-only context and does not enable bash/edit/write. Hermes stays a later memory/preference provider on the same interface.

3. **Context is assembled in-process.** Allowed files are a small root-doc allowlist plus a few `docs/*.md` files, size-capped, realpath-checked, secret-redacted. README instructions are data, not Hearth authority.

4. **Runs bind snapshotId, HEAD, streamEpoch, and context fingerprint.** A later snapshot/HEAD change marks the card `stale`.

5. **Mock is the default provider** (`HEARTH_ANALYSIS_PROVIDER=mock`) so tests and empty machines do not pretend to be live Pi. Live analysis requires an explicit `pi` setting.

## Consequences

- No tools means Pi cannot wander the filesystem during P2-A.
- UNKNOWN tests stay UNKNOWN in copy.
- Missing credentials are `UNAVAILABLE` / LIVE_BLOCKED, never a mocked live card.
