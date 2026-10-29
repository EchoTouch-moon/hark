import { InsightFeedbackKindSchema, type InsightFeedbackKind } from '../contracts.js';
import { InsightError } from '../errors.js';
import { acknowledgeEpisode, dismissEpisode } from './processor.js';
import type { InsightStore } from '../store/store.js';

export function applyAcknowledge(store: InsightStore, insightId: string): { status: string } {
  const row = store.db
    .prepare('SELECT episode_key AS episodeKey, status FROM insight_episodes WHERE insight_id = ?')
    .get(insightId) as { episodeKey: string; status: string } | undefined;
  if (row === undefined) throw new InsightError('NOT_FOUND', `insight ${insightId} not found`);
  if (row.status === 'OPEN') acknowledgeEpisode(store, row.episodeKey);
  const next = store.db.prepare('SELECT status FROM insight_episodes WHERE insight_id = ?').get(insightId) as {
    status: string;
  };
  return { status: next.status };
}

export function applyDismiss(store: InsightStore, insightId: string): { status: string } {
  const row = store.db
    .prepare('SELECT episode_key AS episodeKey, status FROM insight_episodes WHERE insight_id = ?')
    .get(insightId) as { episodeKey: string; status: string } | undefined;
  if (row === undefined) throw new InsightError('NOT_FOUND', `insight ${insightId} not found`);
  if (row.status === 'OPEN' || row.status === 'ACKNOWLEDGED') dismissEpisode(store, row.episodeKey);
  const next = store.db.prepare('SELECT status FROM insight_episodes WHERE insight_id = ?').get(insightId) as {
    status: string;
  };
  return { status: next.status };
}

export function applyFeedback(store: InsightStore, insightId: string, kind: InsightFeedbackKind): { kind: InsightFeedbackKind } {
  const parsed = InsightFeedbackKindSchema.safeParse(kind);
  if (!parsed.success) throw new InsightError('INVALID_FEEDBACK', 'feedback kind is not allowed');
  const exists = store.db.prepare('SELECT 1 AS ok FROM insight_episodes WHERE insight_id = ?').get(insightId) as
    | { ok: number }
    | undefined;
  if (exists === undefined) throw new InsightError('NOT_FOUND', `insight ${insightId} not found`);
  const now = store.nowIso();
  store.transaction(() => {
    store.db
      .prepare(
        `INSERT INTO insight_feedback (insight_id, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(insight_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at`,
      )
      .run(insightId, parsed.data, now, now);
  });
  const row = store.db.prepare('SELECT kind FROM insight_feedback WHERE insight_id = ?').get(insightId) as { kind: InsightFeedbackKind };
  return { kind: row.kind };
}
