import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { withFixtureAccess } from '../fixture-chronicle.js';
import { checkStoredObservation } from '../storage.js';
import { buildModelContext, modelContextStamp, type ModelContext } from './context-builder.js';
import { saveModelOpinionDraft } from './opinion-draft.js';
import { checkModelOutput, type BoundEvidence, type CheckedOutput } from './output.js';
import { MockModelProvider, PiModelProvider } from './pi-provider.js';
import { MODEL_SYSTEM_PROMPT, ModelError, type ConfirmRequest, type ModelConfig, type ModelProvider, type ModelStatus, type PreviewRequest, type SaveOpinionRequest } from './types.js';

type Scope = { principalId: string; projectId: 'project-a' | 'project-b'; grantId: string; rootId: string };
interface Payload { providerId: string; modelId: string; projectId: string; question: string; system: string; user: string; }
const digestOf = (payload: Payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
/** The adapter id is `pi`. The StepFun channel is the frozen provider name, also stored as the model id prefix. */
function stepfunChannel(value: string | null): 'stepfun' | 'stepfun-plan' | null {
  if (value === 'stepfun' || value === 'stepfun-plan') return value;
  const head = value?.split('/')[0];
  return head === 'stepfun' || head === 'stepfun-plan' ? head : null;
}
function recipientFor(adapterId: string | null, channelSource: string | null): string {
  if (stepfunChannel(channelSource)) return 'StepFun（api.stepfun.com）';
  if (adapterId === 'mock' || channelSource === 'mock') return '本地 Mock，不访问网络';
  return '未配置';
}
const asRecord = (row: unknown): Record<string, unknown> => {
  if (!row || typeof row !== 'object') throw new ModelError('not_found', '记录不可用', 404);
  return row as Record<string, unknown>;
};
const textField = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) throw new ModelError('not_found', '记录不可用', 404);
  return value;
};

export class ModelService {
  private readonly inflight = new Map<string, AbortController>();
  constructor(private readonly db: DatabaseSync, private readonly config: ModelConfig, private readonly provider: ModelProvider | null, private readonly clock: () => Date) {
    this.db.prepare("UPDATE model_runs SET state='unknown', error_code='interrupted', finished_at=? WHERE state='running'").run(this.clock().toISOString());
  }

  status(): ModelStatus {
    const configured = this.provider?.configured === true;
    return {
      configured, mode: this.config.mode, providerId: configured ? this.provider!.providerId : null, modelId: configured ? this.provider!.modelId : null,
      reason: configured ? null : (this.provider?.unavailableReason ?? this.config.reason ?? '模型未配置'),
      recipient: configured ? recipientFor(this.provider!.providerId, this.config.mode === 'pi' ? this.config.provider : this.config.mode === 'mock' ? 'mock' : null) : '未配置',
      synthetic: true, timeoutMs: this.config.timeoutMs, maxOutputBytes: this.config.maxOutputBytes, maxCalls: this.config.maxCalls,
    };
  }

  preview(scope: Scope, input: PreviewRequest) {
    this.requireProvider();
    const conversationId = input.conversationId ?? null;
    const built = this.readContext(scope, input.question, conversationId);
    const payload = this.payload(scope.projectId, input.question, built);
    const digest = digestOf(payload);
    const now = this.clock(); const expires = new Date(now.getTime() + this.config.previewTtlMs).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.requireReadable(scope);
      if (modelContextStamp(this.db, scope, conversationId) !== built.stamp) throw new ModelError('conflict', '上下文已变化，请重新预览');
      const existing = this.db.prepare('SELECT * FROM model_previews WHERE project_id=? AND request_key=?').get(scope.projectId, input.requestId);
      if (existing) {
        if (existing.payload_digest !== digest || existing.question !== input.question || existing.status !== 'open') throw new ModelError('conflict', '重复请求与已冻结的预览不一致');
        this.db.exec('COMMIT'); return this.previewView(existing);
      }
      const id = randomUUID();
      const ownedConversation = conversationId ?? randomUUID();
      if (conversationId) {
        const conversation = this.db.prepare('SELECT project_id FROM model_conversations WHERE id=?').get(conversationId);
        if (!conversation || conversation.project_id !== scope.projectId) throw new ModelError('rejected', '对话不可用', 403);
      } else this.db.prepare('INSERT INTO model_conversations(id, project_id, created_at) VALUES (?,?,?)').run(ownedConversation, scope.projectId, now.toISOString());
      this.db.prepare("UPDATE model_previews SET status='superseded' WHERE project_id=? AND status='open'").run(scope.projectId);
      this.db.prepare(`INSERT INTO model_previews(id, project_id, conversation_id, request_key, question, payload_json, payload_digest, provider_id, model_id, limits_json, sources_json, context_stamp, created_at, expires_at, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open')`).run(id, scope.projectId, ownedConversation, input.requestId, input.question, JSON.stringify(payload), digest, payload.providerId, payload.modelId,
        JSON.stringify({ timeoutMs: this.config.timeoutMs, maxOutputBytes: this.config.maxOutputBytes, maxCalls: this.config.maxCalls }), JSON.stringify(built.items), built.stamp, now.toISOString(), expires);
      this.audit('model_preview', id, { providerId: payload.providerId, modelId: payload.modelId, digest });
      const row = this.db.prepare('SELECT * FROM model_previews WHERE id=?').get(id);
      this.db.exec('COMMIT'); return this.previewView(row);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  cancelPreview(scope: Scope, previewId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.ownedPreview(scope, previewId);
      if (row.status !== 'open') throw new ModelError('conflict', '预览不能取消');
      this.db.prepare("UPDATE model_previews SET status='cancelled' WHERE id=? AND status='open'").run(previewId);
      this.audit('model_preview_cancel', previewId, { digest: row.payload_digest });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { cancelled: true, previewId, synthetic: true as const };
  }

  confirm(scope: Scope, input: ConfirmRequest) {
    const provider = this.requireProvider();
    const now = this.clock().toISOString();
    let reserved: { runId: string; payload: Payload; allowed: Map<string, BoundEvidence>; contextFacts: BoundEvidence[] } | null = null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.requireReadable(scope);
      const row = asRecord(this.ownedPreview(scope, input.previewId));
      const previewId = textField(row, 'id');
      if (textField(row, 'status') !== 'open') throw new ModelError('conflict', '确认已失效');
      if (textField(row, 'question') !== input.question) {
        this.db.prepare("UPDATE model_previews SET status='superseded' WHERE id=? AND status='open'").run(previewId);
        throw new ModelError('conflict', '问题已变化，旧预览已失效');
      }
      if (Date.parse(textField(row, 'expires_at')) <= this.clock().getTime()) {
        this.db.prepare("UPDATE model_previews SET status='expired' WHERE id=? AND status='open'").run(previewId);
        throw new ModelError('conflict', '预览已过期');
      }
      const payload = JSON.parse(textField(row, 'payload_json')) as Payload;
      const payloadDigest = textField(row, 'payload_digest');
      if (payload.providerId !== provider.providerId || payload.modelId !== provider.modelId || digestOf(payload) !== payloadDigest) throw new ModelError('conflict', '外发内容与确认不一致');
      const conversationId = textField(row, 'conversation_id');
      if (modelContextStamp(this.db, scope, conversationId) !== textField(row, 'context_stamp')) {
        this.db.prepare("UPDATE model_previews SET status='superseded' WHERE id=? AND status='open'").run(previewId);
        throw new ModelError('conflict', '上下文已变化，旧预览已失效');
      }
      const calls = Number(this.db.prepare('SELECT count(*) AS n FROM model_runs').get()?.n ?? 0);
      if (calls >= this.config.maxCalls) throw new ModelError('rejected', '已达到本次调用次数上限', 409);
      const runId = randomUUID();
      const consumed = this.db.prepare("UPDATE model_previews SET status='consumed' WHERE id=? AND status='open'").run(previewId);
      if (Number(consumed.changes) !== 1) throw new ModelError('conflict', '确认已失效');
      this.db.prepare('INSERT INTO model_outbound_approvals(id, preview_id, project_id, principal_id, payload_digest, provider_id, model_id, granted_at, consumed_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), previewId, scope.projectId, scope.principalId, payloadDigest, payload.providerId, payload.modelId, now, now);
      this.db.prepare('INSERT INTO model_runs(id, preview_id, project_id, conversation_id, provider_id, model_id, state, started_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(runId, previewId, scope.projectId, conversationId, payload.providerId, payload.modelId, 'running', now);
      this.audit('model_confirm', runId, { providerId: payload.providerId, modelId: payload.modelId, digest: payloadDigest });
      const items = JSON.parse(textField(row, 'sources_json')) as ModelContext['items'];
      const allowed = new Map<string, BoundEvidence>(); const contextFacts: BoundEvidence[] = [];
      for (const item of items) {
        if (!item.citeable || !item.sourceId || item.epoch === undefined || !item.observedAt) continue;
        const fact = { id: item.id, statement: item.text, sourceId: item.sourceId, epoch: item.epoch, observedAt: item.observedAt };
        allowed.set(item.id, fact); contextFacts.push(fact);
      }
      reserved = { runId, payload, allowed, contextFacts };
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const controller = new AbortController();
    this.inflight.set(reserved.runId, controller);
    void this.execute(reserved.runId, reserved.payload, reserved.allowed, reserved.contextFacts, provider, controller.signal);
    return { runId: reserved.runId, state: 'running' as const, synthetic: true as const };
  }

  cancelRun(scope: Scope, runId: string) {
    const row = this.db.prepare('SELECT project_id, state FROM model_runs WHERE id=?').get(runId);
    if (!row || row.project_id !== scope.projectId) throw new ModelError('not_found', '没有这次模型请求', 404);
    this.inflight.get(runId)?.abort();
    this.settle(runId, 'cancelled', 'cancelled', null, null);
    return this.getRun(scope, runId);
  }

  getRun(scope: Scope, runId: string) {
    const row = this.db.prepare(`SELECT r.*, p.question, p.payload_digest FROM model_runs r JOIN model_previews p ON p.id=r.preview_id WHERE r.id=?`).get(runId);
    if (!row || row.project_id !== scope.projectId) throw new ModelError('not_found', '没有这次模型请求', 404);
    return this.runView(scope, row);
  }

  getConversation(scope: Scope, conversationId: string) {
    this.requireReadable(scope);
    const conversation = this.db.prepare('SELECT id, project_id FROM model_conversations WHERE id=?').get(conversationId);
    if (!conversation || conversation.project_id !== scope.projectId) throw new ModelError('not_found', '没有这次对话', 404);
    const messages = this.db.prepare('SELECT id, role, body_json, created_at, run_id FROM model_messages WHERE conversation_id=? AND project_id=? ORDER BY rowid').all(conversationId, scope.projectId);
    const runs = this.db.prepare('SELECT id FROM model_runs WHERE conversation_id=? AND project_id=? ORDER BY rowid').all(conversationId, scope.projectId);
    return {
      id: conversationId, projectId: scope.projectId, synthetic: true as const,
      messages: messages.map(message => this.messageView(scope, message)),
      runs: runs.map(item => this.getRun(scope, String(item.id))),
    };
  }

  latestConversation(scope: Scope) {
    this.requireReadable(scope);
    const row = this.db.prepare('SELECT id FROM model_conversations WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(scope.projectId);
    return row ? this.getConversation(scope, String(row.id)) : { id: null, projectId: scope.projectId, synthetic: true as const, messages: [], runs: [] };
  }

  saveOpinion(scope: Scope, input: SaveOpinionRequest) {
    this.requireReadable(scope);
    const row = this.db.prepare('SELECT project_id, state, result_json FROM model_runs WHERE id=?').get(input.runId);
    if (!row || row.project_id !== scope.projectId) throw new ModelError('not_found', '没有这次模型请求', 404);
    if (row.state !== 'succeeded' || typeof row.result_json !== 'string') throw new ModelError('rejected', '只有成功的模型回答才能保存草案', 409);
    const result = JSON.parse(row.result_json) as CheckedOutput;
    const visible = this.visibleFacts(scope, result);
    if (visible.withheld) throw new ModelError('rejected', '来源已失效，不能保存草案', 409);
    return saveModelOpinionDraft(this.db, scope, input.runId, { suggestedOpinion: result.suggestedOpinion, evidence: visible.evidence }, this.clock().toISOString());
  }

  private requireProvider(): ModelProvider {
    if (!this.provider?.configured) throw new ModelError(this.config.reason === '缺少凭证，未发出请求' ? 'missing_credential' : 'unconfigured', this.provider?.unavailableReason ?? this.config.reason ?? '模型未配置');
    return this.provider;
  }
  private requireReadable(scope: Scope) {
    const decision = checkStoredObservation(this.db, scope.grantId, { principalId: scope.principalId, projectId: scope.projectId, rootId: scope.rootId, operation: 'observe' });
    const profile = this.db.prepare("SELECT state FROM fixture_project_profiles WHERE project_id=?").get(scope.projectId);
    if (!decision.allowed || !profile || profile.state !== 'active') throw new ModelError('rejected', '项目不可用', 403);
  }
  private readContext(scope: Scope, question: string, conversationId: string | null): ModelContext {
    this.requireReadable(scope);
    try { return buildModelContext(this.db, scope, question, conversationId, this.config.maxContextChars); }
    catch (error) { if (error instanceof ModelError) throw error; throw new ModelError('rejected', '项目不可用', 403); }
  }
  private payload(projectId: string, question: string, built: ModelContext): Payload {
    if (built.system !== MODEL_SYSTEM_PROMPT) throw new ModelError('rejected', '系统指令被改写', 409);
    return { providerId: this.provider!.providerId, modelId: this.provider!.modelId, projectId, question, system: built.system, user: built.user };
  }
  private ownedPreview(scope: Scope, previewId: string) {
    const row = this.db.prepare('SELECT * FROM model_previews WHERE id=?').get(previewId);
    if (!row || row.project_id !== scope.projectId) throw new ModelError('not_found', '没有这次预览', 404);
    return row;
  }
  private previewView(row: Record<string, unknown> | undefined) {
    if (!row) throw new ModelError('not_found', '没有这次预览', 404);
    const payload = JSON.parse(String(row.payload_json)) as Payload;
    const outbound = JSON.parse(payload.user) as { truncated?: boolean; omitted?: string[]; items?: unknown[] };
    return {
      previewId: row.id, conversationId: row.conversation_id, requestId: row.request_key, projectId: row.project_id,
      providerId: row.provider_id, modelId: row.model_id,
      recipient: recipientFor(typeof row.provider_id === 'string' ? row.provider_id : null, typeof row.model_id === 'string' ? row.model_id : null),
      digest: row.payload_digest, expiresAt: row.expires_at, synthetic: true as const, truncated: outbound.truncated === true, omitted: outbound.omitted ?? [],
      limits: { ...JSON.parse(String(row.limits_json)), callsUsed: Number(this.db.prepare('SELECT count(*) AS n FROM model_runs').get()?.n ?? 0) },
      sources: outbound.items ?? [], outbound: { system: payload.system, user: payload.user },
    };
  }
  private async execute(runId: string, payload: Payload, allowed: Map<string, BoundEvidence>, contextFacts: BoundEvidence[], provider: ModelProvider, signal: AbortSignal) {
    try {
      const generated = await provider.generate({ system: payload.system, user: payload.user }, signal);
      const checked = checkModelOutput(generated.text, allowed, contextFacts);
      this.settle(runId, 'succeeded', null, checked, generated.usage);
    } catch (error) {
      const code = error instanceof ModelError ? error.code : 'provider_error';
      const state = code === 'cancelled' ? 'cancelled' : code === 'unknown_result' ? 'unknown' : 'failed';
      try { this.settle(runId, state, code, null, null); } catch { /* The run row remains running until the next process recovers it as unknown. */ }
    } finally { this.inflight.delete(runId); }
  }
  private settle(runId: string, state: 'succeeded' | 'failed' | 'cancelled' | 'unknown', errorCode: string | null, result: CheckedOutput | null, usage: { inputTokens: number; outputTokens: number } | null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.clock().toISOString();
      const updated = this.db.prepare("UPDATE model_runs SET state=?, error_code=?, result_json=?, usage_json=?, finished_at=? WHERE id=? AND state='running'")
        .run(state, errorCode, result ? JSON.stringify(result) : null, usage ? JSON.stringify(usage) : null, now, runId);
      if (Number(updated.changes) === 1 && state === 'succeeded' && result) {
        const run = asRecord(this.db.prepare('SELECT project_id, conversation_id, preview_id FROM model_runs WHERE id=?').get(runId));
        const preview = asRecord(this.db.prepare('SELECT question FROM model_previews WHERE id=?').get(textField(run, 'preview_id')));
        const conversationId = textField(run, 'conversation_id'); const projectId = textField(run, 'project_id');
        this.db.prepare('INSERT INTO model_messages(id, conversation_id, project_id, role, body_json, created_at, run_id) VALUES (?,?,?,?,?,?,?)')
          .run(`${runId}:user`, conversationId, projectId, 'user', JSON.stringify({ question: textField(preview, 'question'), synthetic: true }), now, runId);
        this.db.prepare('INSERT INTO model_messages(id, conversation_id, project_id, role, body_json, created_at, run_id) VALUES (?,?,?,?,?,?,?)')
          .run(`${runId}:assistant`, conversationId, projectId, 'assistant', JSON.stringify(result), now, runId);
      }
      if (Number(updated.changes) === 1) this.audit('model_finish', runId, { state, errorCode });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private visibleFacts(scope: Scope, result: CheckedOutput) {
    try {
      return buildVisibility(this.db, scope, result);
    } catch (error) { if (error instanceof ModelError) throw error; throw new ModelError('rejected', '项目不可用', 403); }
  }
  private runView(scope: Scope, row: Record<string, unknown>) {
    const base = { id: row.id, projectId: row.project_id, conversationId: row.conversation_id, providerId: row.provider_id, modelId: row.model_id, state: row.state, question: row.question, verified: false as const, synthetic: true as const, usage: row.usage_json ? JSON.parse(String(row.usage_json)) : null };
    if (row.state !== 'succeeded' || typeof row.result_json !== 'string') return { ...base, error: publicError(typeof row.error_code === 'string' ? row.error_code : null), answer: null, uncertainties: [], evidence: [], unboundEvidenceRefs: [], suggestedOpinion: null, withheld: false };
    const result = JSON.parse(row.result_json) as CheckedOutput;
    const visible = this.visibleFacts(scope, result);
    const evidence = visible.withheld ? visible.facts.map(item => ({ id: item.id, available: false as const })) : visible.evidence.map(item => ({ ...item, available: true as const }));
    return { ...base, error: null, answer: visible.withheld ? null : result.answer, uncertainties: visible.withheld ? ['来源已失效'] : result.uncertainties, evidence, unboundEvidenceRefs: result.unboundEvidenceRefs, suggestedOpinion: visible.withheld ? null : result.suggestedOpinion, withheld: visible.withheld };
  }
  private messageView(scope: Scope, message: Record<string, unknown>) {
    const body = JSON.parse(String(message.body_json)) as CheckedOutput & { question?: string };
    if (message.role === 'assistant') {
      const visible = this.visibleFacts(scope, body);
      const evidence = visible.withheld ? visible.facts.map(item => ({ id: item.id, available: false as const })) : visible.evidence.map(item => ({ ...item, available: true as const }));
      return { id: message.id, role: 'assistant', runId: message.run_id, createdAt: message.created_at, withheld: visible.withheld, answer: visible.withheld ? null : body.answer, uncertainties: visible.withheld ? ['来源已失效'] : body.uncertainties, evidence, unboundEvidenceRefs: body.unboundEvidenceRefs ?? [], suggestedOpinion: visible.withheld ? null : body.suggestedOpinion, verified: false as const };
    }
    return { id: message.id, role: 'user', runId: message.run_id, createdAt: message.created_at, question: body.question ?? '', verified: false as const };
  }
  private audit(event: string, objectId: string, details: Record<string, unknown>) {
    this.db.prepare('INSERT INTO audit_log(id, at, event_type, actor, object_id, sanitized_details_json) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), this.clock().toISOString(), event, 'demo', objectId, JSON.stringify({ synthetic: true, ...details }));
  }
}

function publicError(code: string | null): string | null {
  if (!code) return null;
  const text: Record<string, string> = { timeout: '调用超时', cancelled: '已取消', output_invalid: '模型输出无法通过结构校验', output_limit: '输出超过长度限制', unavailable: '模型进程不可用', provider_error: '模型 Provider 返回错误', auth_rejected: '凭证被拒绝', unknown_result: '网络结果未知', interrupted: '进程中断，结果未知', missing_credential: '缺少凭证，未发出请求' };
  return text[code] ?? '模型请求失败';
}

function buildVisibility(db: DatabaseSync, scope: Scope, result: CheckedOutput) {
  return withFixtureAccess(db, scope, (_scope, findFact) => {
    const facts = result.contextFacts.map(item => {
      const live = findFact(item.sourceId, item.id);
      if (!live || live.projectId !== scope.projectId || live.summary !== item.statement || live.epoch !== item.epoch || live.observedAt !== item.observedAt) return { id: item.id, available: false as const };
      return { id: item.id, available: true as const, statement: live.summary, sourceId: item.sourceId, epoch: item.epoch, observedAt: item.observedAt };
    });
    const evidence = result.evidence.filter(item => facts.some(fact => fact.id === item.id && fact.available));
    return { withheld: facts.some(fact => !fact.available), facts, evidence };
  });
}

export function createModelService(db: DatabaseSync, config: ModelConfig, options?: { provider?: ModelProvider; now?: () => Date; env?: NodeJS.ProcessEnv }): ModelService {
  const provider = options && 'provider' in options ? options.provider ?? null
    : config.mode === 'mock' && config.reason === null ? new MockModelProvider(config.model ?? 'synthetic-mock')
    : config.mode === 'pi' ? new PiModelProvider(config, options?.env ?? process.env) : null;
  return new ModelService(db, config, provider, options?.now ?? (() => new Date()));
}
