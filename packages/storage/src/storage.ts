import type {
  ActionCard,
  ActionSpec,
  ApprovalGrant,
  Candidate,
  Event,
  RunStep,
  SourceRef,
  TaskRun,
} from '@hearth/contracts';
import {
  ActionCardSchema,
  ActionSpecSchema,
  ApprovalGrantSchema,
  CandidateSchema,
  EventSchema,
  RunStepSchema,
  SourceRefSchema,
  TaskRunSchema,
  assertRunTransition,
} from '@hearth/contracts';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase } from './migrations.js';

type Row = Record<string, unknown>;

function j(v: unknown): string {
  return JSON.stringify(v ?? null);
}

function parse<T>(schema: { parse(x: unknown): T }, raw: unknown, ctx: string): T {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return schema.parse(value);
}

/** G1 thread row persisted in SQLite */
export interface ThreadRow {
  id: string;
  title: string;
  preview: string;
  projectId: string | null;
  /** idle | offered | consumed */
  proactiveStatus: string;
  proactiveMessageId: string | null;
  updatedAt: string;
  createdAt: string;
}

function mapThread(r: Row): ThreadRow {
  return {
    id: String(r['id']),
    title: String(r['title']),
    preview: String(r['preview'] ?? ''),
    projectId: r['project_id'] != null ? String(r['project_id']) : null,
    proactiveStatus: String(r['proactive_status'] ?? 'idle'),
    proactiveMessageId: r['proactive_message_id'] != null ? String(r['proactive_message_id']) : null,
    updatedAt: String(r['updated_at']),
    createdAt: String(r['created_at']),
  };
}


/**
 * @fileoverview 强类型 SQLite 持久化门面（Storage Layer）
 * 
 * 核心设计规范：
 * 1. 系统所有状态读写、迁移、审计均统一收口于此类
 * 2. 状态机流转强事务与原子审计：transitionRun 内部开启 BEGIN/COMMIT 事务，
 *    在更新状态的同时强制校验流转合法性（assertRunTransition）并同步写入 audit_log
 * 3. 幂等控制：
 *    - ingestEvent: 按 dedupe_key 去重
 *    - upsertCandidate: 按 suppression_key 去重
 *    - createRun: 按 idempotency_key 保证单一执行记录
 * 4. 纯追加审计日志（Append-only Audit Log）：只提供插入与查询，不暴露任何 UPDATE/DELETE 接口
 * 5. 安全护栏：resetDemoData 仅在全部项目均为 demo 属性时才允许执行
 */
export class Storage {
  readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    this.db = openDatabase(dbPath);
    migrate(this.db);
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  // ---------- projects ----------
  seedProjects(projects: Array<{ id: string; name: string; description: string; visibility?: string }>): void {
    const stmt = this.db.prepare(
      'INSERT INTO projects (id, name, description, visibility) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description',
    );
    for (const p of projects) stmt.run(p.id, p.name, p.description, p.visibility ?? 'demo');
  }

  listProjects(): Array<{ id: string; name: string; description: string; visibility: string }> {
    return this.db
      .prepare('SELECT id, name, description, visibility FROM projects ORDER BY id')
      .all() as unknown as Array<{ id: string; name: string; description: string; visibility: string }>;
  }

  projectExists(id: string): boolean {
    const r = this.db.prepare('SELECT 1 AS x FROM projects WHERE id = ?').get(id) as Row | undefined;
    return r !== undefined;
  }

  // ---------- events ----------
  /**
   * 写入源事件（按 dedupe_key 实现幂等写入）
   * @param event 待入库的源事件
   * @param meta 针对黄金测试集的标注元数据（可选）
   * @returns inserted: 是否真正执行了数据库插入（若已存在相同 dedupe_key 则为 false）
   */
  ingestEvent(event: Event, meta?: { goldenAction?: string | null; goldenUseful?: boolean | null }): { inserted: boolean } {
    const existing = this.db.prepare('SELECT id FROM events WHERE dedupe_key = ?').get(event.dedupeKey) as Row | undefined;
    if (existing) return { inserted: false };
    this.db
      .prepare(
        `INSERT INTO events (id, type, project_id, source_json, occurred_at, observed_at, expires_at, summary,
         dedupe_key, sensitivity, provenance, payload_ref, tags_json, golden_action, golden_useful)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.type,
        event.projectId,
        j(event.source),
        event.occurredAt,
        event.observedAt,
        event.expiresAt ?? null,
        event.summary,
        event.dedupeKey,
        event.sensitivity,
        event.provenance,
        event.payloadRef ?? null,
        j(event.tags),
        meta?.goldenAction ?? null,
        meta?.goldenUseful === undefined || meta.goldenUseful === null ? null : meta.goldenUseful ? 1 : 0,
      );
    return { inserted: true };
  }

  getEvent(id: string): Event | null {
    const r = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
    return r ? this.rowToEvent(r) : null;
  }

  listEvents(opts: { projectId?: string; limit?: number } = {}): Event[] {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const rows = opts.projectId
      ? (this.db
          .prepare('SELECT * FROM events WHERE project_id = ? ORDER BY observed_at DESC LIMIT ?')
          .all(opts.projectId, limit) as Row[])
      : (this.db.prepare('SELECT * FROM events ORDER BY observed_at DESC LIMIT ?').all(limit) as Row[]);
    return rows.map((r) => this.rowToEvent(r));
  }

  /** Source version for freshness checks: contentHash if present else observedAt. */
  getSourceVersion(eventId: string): string | null {
    const r = this.db.prepare('SELECT source_json FROM events WHERE id = ?').get(eventId) as Row | undefined;
    if (!r) return null;
    const src = parse(SourceRefSchema, r['source_json'], 'source') as SourceRef;
    return src.contentHash ?? src.observedAt;
  }

  private rowToEvent(r: Row): Event {
    return parse(EventSchema, {
      id: r['id'],
      type: r['type'],
      projectId: r['project_id'],
      source: JSON.parse(String(r['source_json'])),
      occurredAt: r['occurred_at'],
      observedAt: r['observed_at'],
      expiresAt: r['expires_at'] ?? undefined,
      summary: r['summary'],
      dedupeKey: r['dedupe_key'],
      sensitivity: r['sensitivity'],
      provenance: r['provenance'],
      payloadRef: r['payload_ref'] ?? undefined,
      tags: JSON.parse(String(r['tags_json'] ?? '[]')),
    }, 'event');
  }

  // ---------- candidates ----------
  /**
   * 插入或复用候选建议（按唯一 suppression_key 去重）
   * @param c 候选建议实体
   * @returns id: 候选 ID；existing: 是否命中已存在记录
   */
  upsertCandidate(c: Candidate): { id: string; existing: boolean } {
    const dup = this.db.prepare('SELECT id FROM candidates WHERE suppression_key = ?').get(c.suppressionKey) as Row | undefined;
    if (dup) return { id: String(dup['id']), existing: true };
    this.db
      .prepare(
        `INSERT INTO candidates (id, project_id, event_ids_json, title, why_now, evidence_json, action_json,
         score, confidence, risk, expires_at, suppression_key, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id, c.projectId, j(c.eventIds), c.title, c.whyNow, j(c.evidence), j(c.suggestedAction),
        c.score, c.confidence, c.risk, c.expiresAt, c.suppressionKey, c.status,
      );
    return { id: c.id, existing: false };
  }

  getCandidate(id: string): Candidate | null {
    const r = this.db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return parse(CandidateSchema, {
      id: r['id'], projectId: r['project_id'], eventIds: JSON.parse(String(r['event_ids_json'])),
      title: r['title'], whyNow: r['why_now'], evidence: JSON.parse(String(r['evidence_json'])),
      suggestedAction: JSON.parse(String(r['action_json'])), score: r['score'], confidence: r['confidence'],
      risk: r['risk'], expiresAt: r['expires_at'], suppressionKey: r['suppression_key'], status: r['status'],
    }, 'candidate');
  }

  // ---------- cards ----------
  insertCard(card: ActionCard): void {
    this.db
      .prepare(
        `INSERT INTO cards (id, candidate_id, project_id, title, why_now, evidence_json, action_json,
         created_at, expires_at, status, snoozed_until, user_feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        card.id, card.candidateId, card.projectId, card.title, card.whyNow, j(card.evidence), j(card.action),
        card.createdAt, card.expiresAt, card.status, card.snoozedUntil ?? null, card.userFeedback ?? null,
      );
  }

  getCard(id: string): ActionCard | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return parse(ActionCardSchema, {
      id: r['id'], candidateId: r['candidate_id'], projectId: r['project_id'], title: r['title'],
      whyNow: r['why_now'], evidence: JSON.parse(String(r['evidence_json'])), action: JSON.parse(String(r['action_json'])),
      createdAt: r['created_at'], expiresAt: r['expires_at'], status: r['status'],
      snoozedUntil: r['snoozed_until'] ?? undefined, userFeedback: r['user_feedback'] ?? undefined,
    }, 'card');
  }

  listCards(opts: { status?: string; projectId?: string; limit?: number } = {}): ActionCard[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (opts.status) { conds.push('status = ?'); args.push(opts.status); }
    if (opts.projectId) { conds.push('project_id = ?'); args.push(opts.projectId); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, limit) as Row[];
    return rows.map((r) => this.getCard(String(r['id']))!);
  }

  /** Server-side status mutation (dismiss/snooze/execution progression). */
  updateCard(id: string, patch: { status?: string; snoozedUntil?: string | null; userFeedback?: string | null }): void {
    const cur = this.getCard(id);
    if (!cur) throw new Error(`card ${id} not found`);
    const status = patch.status ?? cur.status;
    const snoozedUntil = patch.snoozedUntil === undefined ? cur.snoozedUntil ?? null : patch.snoozedUntil;
    const userFeedback = patch.userFeedback === undefined ? cur.userFeedback ?? null : patch.userFeedback;
    this.db
      .prepare('UPDATE cards SET status = ?, snoozed_until = ?, user_feedback = ? WHERE id = ?')
      .run(status, snoozedUntil, userFeedback, id);
  }

  // ---------- runs ----------
  /**
   * 创建任务运行记录（强绑定唯一 idempotency_key，防重入）
   * @param run 运行初始状态实体
   * @param actionSnapshot 触发瞬间的动作规范静态快照（避免后续修改导致快照漂移）
   */
  createRun(run: TaskRun, actionSnapshot: ActionSpec): { run: TaskRun; existing: boolean } {
    const dup = this.db.prepare('SELECT id FROM runs WHERE idempotency_key = ?').get(run.idempotencyKey) as Row | undefined;
    if (dup) return { run: this.getRun(String(dup['id']))!, existing: true };
    this.db
      .prepare(
        `INSERT INTO runs (id, card_id, action_id, idempotency_key, state, created_at, started_at, ended_at,
         result_artifact_refs_json, verification_verdict, failure_class, action_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id, run.cardId, run.actionId, run.idempotencyKey, run.state, run.createdAt,
        run.startedAt ?? null, run.endedAt ?? null, j(run.resultArtifactRefs),
        run.verificationVerdict ?? null, run.failureClass ?? null, j(actionSnapshot),
      );
    return { run, existing: false };
  }

  getRun(id: string): TaskRun | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return parse(TaskRunSchema, {
      id: r['id'], cardId: r['card_id'], actionId: r['action_id'], idempotencyKey: r['idempotency_key'],
      state: r['state'], createdAt: r['created_at'], startedAt: r['started_at'] ?? undefined,
      endedAt: r['ended_at'] ?? undefined, resultArtifactRefs: JSON.parse(String(r['result_artifact_refs_json'] ?? '[]')),
      verificationVerdict: r['verification_verdict'] ?? undefined, failureClass: r['failure_class'] ?? undefined,
    }, 'run');
  }

  getRunByCard(cardId: string): TaskRun | null {
    const r = this.db.prepare('SELECT id FROM runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1').get(cardId) as Row | undefined;
    return r ? this.getRun(String(r['id'])) : null;
  }

  getRunActionSnapshot(id: string): ActionSpec | null {
    const r = this.db.prepare('SELECT action_snapshot_json FROM runs WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return parse(ActionSpecSchema, JSON.parse(String(r['action_snapshot_json'])), 'action_snapshot');
  }

  listRuns(opts: { projectId?: string; limit?: number } = {}): TaskRun[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = opts.projectId
      ? (this.db.prepare(
          `SELECT r.id FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.project_id = ? ORDER BY r.created_at DESC LIMIT ?`,
        ).all(opts.projectId, limit) as Row[])
      : (this.db.prepare('SELECT id FROM runs ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]);
    return rows.map((r) => this.getRun(String(r['id']))!);
  }

  listRunsInStates(states: string[]): TaskRun[] {
    const ph = states.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id FROM runs WHERE state IN (${ph})`).all(...states) as Row[];
    return rows.map((r) => this.getRun(String(r['id']))!);
  }

  /**
   * 运行状态原子流转（在单个 SQLite 事务中完成状态校验、字段更新与审计日志写入）
   * 严格调用 assertRunTransition 保证符合契约状态机，任何非法流转立即触发 ROLLBACK。
   * 
   * @param runId 运行 ID
   * @param to 目标状态
   * @param patch 更新字段补丁
   * @param audit 审计主体与元数据详情
   */
  transitionRun(
    runId: string,
    to: TaskRun['state'],
    patch: {
      startedAt?: string; endedAt?: string; resultArtifactRefs?: string[];
      verificationVerdict?: TaskRun['verificationVerdict']; failureClass?: TaskRun['failureClass'];
    } = {},
    audit?: { actor: string; details?: Record<string, unknown> },
  ): TaskRun {
    this.db.exec('BEGIN');
    try {
      const cur = this.getRun(runId);
      if (!cur) throw new Error(`run ${runId} not found`);
      assertRunTransition(cur.state, to);
      this.db
        .prepare(
          `UPDATE runs SET state = ?, started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at),
           result_artifact_refs_json = COALESCE(?, result_artifact_refs_json),
           verification_verdict = COALESCE(?, verification_verdict), failure_class = COALESCE(?, failure_class)
           WHERE id = ?`,
        )
        .run(
          to,
          patch.startedAt ?? null, patch.endedAt ?? null,
          patch.resultArtifactRefs ? j(patch.resultArtifactRefs) : null,
          patch.verificationVerdict ?? null, patch.failureClass ?? null,
          runId,
        );
      if (audit) {
        this.db
          .prepare('INSERT INTO audit_log (at, event_type, actor, object_id, sanitized_details_json) VALUES (?, ?, ?, ?, ?)')
          .run(new Date().toISOString(), `run.transition.${to}`, audit.actor, runId, j(audit.details ?? {}));
      }
      this.db.exec('COMMIT');
      return this.getRun(runId)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- run steps & evidence ----------
  addStep(step: RunStep): void {
    this.db
      .prepare(
        'INSERT INTO run_steps (id, run_id, sequence, name, status, started_at, ended_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(step.id, step.runId, step.sequence, step.name, step.status, step.startedAt ?? null, step.endedAt ?? null, step.detail ?? null);
  }

  updateStep(id: string, status: RunStep['status'], endedAt?: string, detail?: string): void {
    this.db
      .prepare('UPDATE run_steps SET status = ?, ended_at = COALESCE(?, ended_at), detail = COALESCE(?, detail) WHERE id = ?')
      .run(status, endedAt ?? null, detail ?? null, id);
  }

  listSteps(runId: string): RunStep[] {
    const rows = this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY sequence').all(runId) as Row[];
    return rows.map((r) =>
      parse(RunStepSchema, {
        id: r['id'], runId: r['run_id'], sequence: r['sequence'], name: r['name'], status: r['status'],
        startedAt: r['started_at'] ?? undefined, endedAt: r['ended_at'] ?? undefined, detail: r['detail'] ?? undefined,
      }, 'step'),
    );
  }

  addEvidence(e: { id: string; runId: string; sourceRef: SourceRef; sha256: string; kind: string; artifactPath?: string; createdAt: string }): void {
    this.db
      .prepare(
        'INSERT INTO evidence (id, run_id, source_ref_json, sha256, kind, artifact_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(e.id, e.runId, j(e.sourceRef), e.sha256, e.kind, e.artifactPath ?? null, e.createdAt);
  }

  listEvidence(runId: string): Array<{ id: string; runId: string; sourceRef: SourceRef; sha256: string; kind: string; artifactPath?: string; createdAt: string }> {
    const rows = this.db.prepare('SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at').all(runId) as Row[];
    return rows.map((r) => ({
      id: String(r['id']), runId: String(r['run_id']), sourceRef: parse(SourceRefSchema, JSON.parse(String(r['source_ref_json'])), 'src'),
      sha256: String(r['sha256']), kind: String(r['kind']), artifactPath: r['artifact_path'] ? String(r['artifact_path']) : undefined,
      createdAt: String(r['created_at']),
    }));
  }

  // ---------- approvals ----------
  insertGrant(grant: ApprovalGrant): void {
    this.db
      .prepare(
        `INSERT INTO approvals (id, principal_id, card_id, action_digest, target_digest, risk,
         authorized_capabilities_json, expires_at, granted_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        grant.id, grant.principalId, grant.cardId, grant.actionDigest, grant.targetDigest, grant.risk,
        j(grant.authorizedCapabilities), grant.expiresAt, grant.grantedAt, grant.consumedAt ?? null,
      );
  }

  listGrantsForCard(cardId: string): ApprovalGrant[] {
    const rows = this.db.prepare('SELECT * FROM approvals WHERE card_id = ? ORDER BY granted_at DESC').all(cardId) as Row[];
    return rows.map((r) =>
      parse(ApprovalGrantSchema, {
        id: r['id'], principalId: r['principal_id'], cardId: r['card_id'], actionDigest: r['action_digest'],
        targetDigest: r['target_digest'], risk: r['risk'],
        authorizedCapabilities: JSON.parse(String(r['authorized_capabilities_json'] ?? '[]')),
        expiresAt: r['expires_at'], grantedAt: r['granted_at'], consumedAt: r['consumed_at'] ?? undefined,
      }, 'grant'),
    );
  }

  consumeGrant(id: string, consumedAt: string): void {
    this.db.prepare('UPDATE approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(consumedAt, id);
  }

  // ---------- settings / feedback / chat / audit ----------
  getSetting<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? (JSON.parse(String(r['value_json'])) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(key, j(value));
  }

  insertFeedback(f: { id: string; cardId: string; kind: string; reason?: string; createdAt: string }): void {
    this.db
      .prepare('INSERT INTO feedback (id, card_id, kind, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(f.id, f.cardId, f.kind, f.reason ?? null, f.createdAt);
  }

  appendChat(m: {
    id: string;
    sessionId: string;
    role: string;
    content: string;
    runId?: string;
    adapter: string;
    createdAt: string;
    parts?: unknown;
  }): void {
    this.db
      .prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, run_id, adapter, created_at, parts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        m.id,
        m.sessionId,
        m.role,
        m.content,
        m.runId ?? null,
        m.adapter,
        m.createdAt,
        m.parts === undefined ? null : j(m.parts),
      );
  }

  updateChat(
    id: string,
    patch: { content?: string; parts?: unknown; runId?: string | null },
  ): void {
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`chat message ${id} not found`);
    const content = patch.content ?? String(row['content']);
    const parts_json =
      patch.parts === undefined
        ? (row['parts_json'] as string | null)
        : j(patch.parts);
    const run_id =
      patch.runId === undefined ? (row['run_id'] as string | null) : patch.runId;
    this.db
      .prepare('UPDATE chat_messages SET content = ?, parts_json = ?, run_id = ? WHERE id = ?')
      .run(content, parts_json, run_id, id);
  }

  listChat(
    sessionId: string,
    limit = 200,
  ): Array<{
    id: string;
    sessionId: string;
    role: string;
    content: string;
    runId?: string;
    adapter: string;
    createdAt: string;
    parts?: unknown;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at LIMIT ?')
      .all(sessionId, limit) as Row[];
    return rows.map((r) => {
      let parts: unknown | undefined;
      if (r['parts_json']) {
        try {
          parts = JSON.parse(String(r['parts_json']));
        } catch {
          parts = undefined;
        }
      }
      return {
        id: String(r['id']),
        sessionId: String(r['session_id']),
        role: String(r['role']),
        content: String(r['content']),
        runId: r['run_id'] ? String(r['run_id']) : undefined,
        adapter: String(r['adapter']),
        createdAt: String(r['created_at']),
        ...(parts !== undefined ? { parts } : {}),
      };
    });
  }

  // ---------- threads (G1) ----------

  ensureDefaultThread(): ThreadRow {
    const existing = this.listThreads(1);
    if (existing.length > 0) return existing[0]!;
    const now = new Date().toISOString();
    const thread: ThreadRow = {
      id: 'thread-default',
      title: '日常',
      preview: '有需要时我会出现',
      projectId: null,
      proactiveStatus: 'idle',
      proactiveMessageId: null,
      updatedAt: now,
      createdAt: now,
    };
    this.insertThread(thread);
    return thread;
  }

  insertThread(t: ThreadRow): void {
    this.db
      .prepare(
        `INSERT INTO threads (id, title, preview, project_id, proactive_status, proactive_message_id, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.title,
        t.preview,
        t.projectId,
        t.proactiveStatus,
        t.proactiveMessageId,
        t.updatedAt,
        t.createdAt,
      );
  }

  getThread(id: string): ThreadRow | null {
    const r = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return mapThread(r);
  }

  listThreads(limit = 100): ThreadRow[] {
    const rows = this.db
      .prepare('SELECT * FROM threads ORDER BY updated_at DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), 200)) as Row[];
    return rows.map(mapThread);
  }

  touchThread(id: string, preview?: string): void {
    const cur = this.getThread(id);
    if (!cur) return;
    const now = new Date().toISOString();
    const nextPreview =
      preview === undefined ? cur.preview : preview.slice(0, 80);
    this.db
      .prepare('UPDATE threads SET preview = ?, updated_at = ? WHERE id = ?')
      .run(nextPreview, now, id);
  }

  updateThreadProactive(
    id: string,
    patch: { proactiveStatus: string; proactiveMessageId?: string | null },
  ): void {
    const cur = this.getThread(id);
    if (!cur) throw new Error(`thread ${id} not found`);
    const msgId =
      patch.proactiveMessageId === undefined
        ? cur.proactiveMessageId
        : patch.proactiveMessageId;
    this.db
      .prepare(
        'UPDATE threads SET proactive_status = ?, proactive_message_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(patch.proactiveStatus, msgId, new Date().toISOString(), id);
  }

  /** Ensure a thread row exists for chat sessionId=threadId mapping. */
  ensureThread(id: string, title = '新线程'): ThreadRow {
    const cur = this.getThread(id);
    if (cur) return cur;
    const now = new Date().toISOString();
    const thread: ThreadRow = {
      id,
      title,
      preview: '',
      projectId: null,
      proactiveStatus: 'idle',
      proactiveMessageId: null,
      updatedAt: now,
      createdAt: now,
    };
    this.insertThread(thread);
    return thread;
  }

  /**
   * 追加不可篡改的审计日志（纯追加，不提供任何修改或删除接口）
   * @param eventType 审计事件类型标识
   * @param actor 触发主体（user / system / verifier / discovery 等）
   * @param objectId 关联的操作对象唯一 ID
   * @param details 经过脱敏的详情字典
   */
  audit(eventType: string, actor: string, objectId: string, details: Record<string, unknown> = {}): void {
    this.db
      .prepare('INSERT INTO audit_log (at, event_type, actor, object_id, sanitized_details_json) VALUES (?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), eventType, actor, objectId, j(details));
  }

  listAudit(objectId?: string, limit = 100): Array<{ id: number; at: string; eventType: string; actor: string; objectId: string; details: Record<string, unknown> }> {
    const rows = objectId
      ? (this.db.prepare('SELECT * FROM audit_log WHERE object_id = ? ORDER BY id DESC LIMIT ?').all(objectId, limit) as Row[])
      : (this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as Row[]);
    return rows.map((r) => ({
      id: Number(r['id']), at: String(r['at']), eventType: String(r['event_type']),
      actor: String(r['actor']), objectId: String(r['object_id']), details: JSON.parse(String(r['sanitized_details_json'] ?? '{}')),
    }));
  }

  /**
   * 重置演示环境数据（安全护栏：若检测到任何非 demo 属性的项目，坚决拒绝重置）
   */
  resetDemoData(): void {
    const nonDemo = this.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE visibility != 'demo'").get() as Row;
    if (Number(nonDemo['n']) > 0) throw new Error('refusing reset: non-demo projects present');
    this.db.exec('BEGIN');
    try {
      for (const t of ['audit_log', 'feedback', 'chat_messages', 'threads', 'evidence', 'run_steps', 'runs', 'approvals', 'cards', 'candidates', 'events', 'sources', 'settings']) {
        this.db.exec(`DELETE FROM ${t}`);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
