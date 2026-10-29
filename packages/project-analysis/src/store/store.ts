import { DatabaseSync } from 'node:sqlite';
import type { AnalysisRunView, AnalysisStatus, AnalysisTrigger, AnalysisUsage, Recommendation } from '../contracts.js';
import { RecommendationSchema } from '../contracts.js';
import { openAnalysisDatabase } from './schema.js';

type Row = Record<string, unknown>;

export class AnalysisStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = openAnalysisDatabase(dbPath);
  }

  close(): void {
    this.db.close();
  }

  recoverInterrupted(now: string): number {
    return Number(this.db.prepare(`UPDATE analysis_runs SET status='failed', error_code='INTERRUPTED',
      error_message='服务已中断；未自动重新调用模型', finished_at=? WHERE status IN ('queued','running')`).run(now).changes);
  }

  requestDeletion(projectId: string, now: string): void {
    this.db.prepare('INSERT OR IGNORE INTO analysis_deletions VALUES (?,?)').run(projectId, now);
  }
  pendingDeletions(): string[] {
    return (this.db.prepare('SELECT project_id FROM analysis_deletions').all() as Array<{project_id: string}>).map(r => r.project_id);
  }
  finishDeletion(projectId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM analysis_feedback WHERE run_id IN (SELECT run_id FROM analysis_runs WHERE project_id=?)').run(projectId);
      this.db.prepare('DELETE FROM analysis_runs WHERE project_id=?').run(projectId);
      this.db.prepare('DELETE FROM analysis_deletions WHERE project_id=?').run(projectId);
      this.db.exec('COMMIT');
    } catch (cause) { this.db.exec('ROLLBACK'); throw cause; }
  }
  requestsSince(since: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM analysis_runs WHERE provider != 'mock' AND started_at >= ?").get(since) as {n: number}).n);
  }

  insertRunning(input: {
    id: string;
    projectId: string;
    insightId: string | null;
    trigger: AnalysisTrigger;
    provider: string;
    model: string | null;
    snapshotId: string | null;
    headSha: string | null;
    streamEpoch: number;
    contextFingerprint: string;
    startedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO analysis_runs (
          run_id, project_id, insight_id, trigger, provider, model, status,
          snapshot_id, head_sha, stream_epoch, context_fingerprint,
          recommendation_json, error_code, error_message, usage_json,
          started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.insightId,
        input.trigger,
        input.provider,
        input.model,
        input.snapshotId,
        input.headSha,
        input.streamEpoch,
        input.contextFingerprint,
        input.startedAt,
        input.startedAt,
      );
  }

  finish(
    id: string,
    patch: {
      status: AnalysisStatus;
      recommendation?: Recommendation | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      usage?: AnalysisUsage | null;
      finishedAt: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE analysis_runs SET status = ?, recommendation_json = ?, error_code = ?, error_message = ?, usage_json = ?, finished_at = ?
         WHERE run_id = ? AND status IN ('queued','running')`,
      )
      .run(
        patch.status,
        patch.recommendation ? JSON.stringify(patch.recommendation) : null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        patch.usage ? JSON.stringify(patch.usage) : null,
        patch.finishedAt,
        id,
      );
  }

  get(id: string): AnalysisRunView | null {
    const row = this.db.prepare('SELECT * FROM analysis_runs WHERE run_id = ?').get(id) as Row | undefined;
    return row ? this.toView(row, null) : null;
  }

  list(projectId: string, limit = 20): AnalysisRunView[] {
    const rows = this.db
      .prepare('SELECT * FROM analysis_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as Row[];
    return rows.map((row) => this.toView(row, null));
  }

  runningCount(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM analysis_runs WHERE project_id = ? AND status IN ('queued','running')`)
      .get(projectId) as { n: number };
    return Number(row.n);
  }

  upsertFeedback(runId: string, kind: 'useful' | 'not_useful', nowIso: string): void {
    this.db
      .prepare(
        `INSERT INTO analysis_feedback (run_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at`,
      )
      .run(runId, kind, nowIso, nowIso);
  }

  toView(row: Row, currentFingerprint: string | null): AnalysisRunView {
    const recommendationJson = row['recommendation_json'];
    const usageJson = row['usage_json'];
    const fingerprint = String(row['context_fingerprint']);
    return {
      id: String(row['run_id']),
      projectId: String(row['project_id']),
      insightId: row['insight_id'] == null ? null : String(row['insight_id']),
      trigger: String(row['trigger']) as AnalysisRunView['trigger'],
      provider: String(row['provider']),
      model: row['model'] == null ? null : String(row['model']),
      status: String(row['status']) as AnalysisRunView['status'],
      snapshotId: row['snapshot_id'] == null ? null : String(row['snapshot_id']),
      headSha: row['head_sha'] == null ? null : String(row['head_sha']),
      streamEpoch: Number(row['stream_epoch']),
      contextFingerprint: fingerprint,
      recommendation:
        typeof recommendationJson === 'string' ? RecommendationSchema.parse(JSON.parse(recommendationJson)) : null,
      errorCode: row['error_code'] == null ? null : String(row['error_code']),
      errorMessage: row['error_message'] == null ? null : String(row['error_message']),
      usage: typeof usageJson === 'string' ? (JSON.parse(usageJson) as AnalysisRunView['usage']) : null,
      stale: currentFingerprint !== null && currentFingerprint !== fingerprint,
      startedAt: String(row['started_at']),
      finishedAt: row['finished_at'] == null ? null : String(row['finished_at']),
      createdAt: String(row['created_at']),
    };
  }
}
