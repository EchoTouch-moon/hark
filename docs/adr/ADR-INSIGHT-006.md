# ADR-INSIGHT-006 · S3 Insight Feed query, feedback, and UI

- Status: Accepted for S3
- Date: 2026-10-29
- Depends on: ADR-INSIGHT-001..005

## Decision

1. **Read path is query-only.** `GET /api/v1/insights`, `/summary`, `/policy`, and `/:id` read `insights.sqlite`. They do not call `processProjectRules`, `observer.scan`, or insert rows.

2. **Default feed** is `OPEN` + `ACKNOWLEDGED`. `DISMISSED` / `RESOLVED` / `WITHDRAWN` stay in store and appear only when the client asks. Sort is status rank → severity → `last_material_observed_at DESC` → `insight_id DESC`. Cursor is `sr|vr|at|id`.

3. **Feedback is a separate v3 table** `insight_feedback(insight_id PK, kind CHECK useful|not_useful)`. Upsert is transactional and idempotent. It never changes episode status or rule results. `acknowledge` writes `ACKNOWLEDGED` only from `OPEN`. `dismiss` keeps evidence rows and keeps `active_episode_key` so the same episode cannot reopen.

4. **Evidence honesty.** Detail `observeHref` is `/observe/{projectId}`. Missing inbox rows are `MISSING`. Open `PROJECT_REMOVED` / `CURSOR_AHEAD_OF_STREAM` interruptions are `UNAVAILABLE`. Templates strip home-like paths. Absolute local paths are not returned.

5. **Hard delete.** `DELETE /api/v1/observer/projects/:id` still removes the observer project, then `InsightStore.purgeProject` if the insight store is configured.

6. **UI.** `/insights` and `/insights/:id` reuse the Hearth design system. `/projects` and `/observe/:id` show open-count summaries. Empty copy distinguishes `NOT_EVALUATED`, healthy empty, and `DEGRADED`.

## Consequences

- Page refresh after dismiss does not resurrect the card.
- A new episode after verified recovery starts `OPEN` and does not inherit old feedback.
- `HEAD` binding stays `UNDETERMINED`.
- `POST /api/v1/insights/reconcile` is deferred; S3 UI never re-evaluates on read.
