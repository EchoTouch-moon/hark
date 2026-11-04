import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { withFixtureAccess } from '../fixture-chronicle.js';
import { getSyntheticProject } from '../synthetic-catalog.js';
import { MODEL_SYSTEM_PROMPT, ModelError } from './types.js';

const Id = z.string().trim().min(1).max(256);
const ScopeSchema = z.object({ principalId: Id, projectId: z.enum(['project-a', 'project-b']), grantId: Id, rootId: Id }).strict();
type Scope = z.infer<typeof ScopeSchema>;
type Kind = 'fact' | 'inference' | 'unknown' | 'user_decision' | 'conversation' | 'feedback';
interface Item { kind: Kind; id: string; text: string; citeable: boolean; priority: number; sourceId?: string; epoch?: number; observedAt?: string; }
export interface ModelContext {
  projectId: string; projectTitle: string; question: string; system: string; user: string;
  stamp: string; truncated: boolean; omitted: string[];
  items: Array<{ kind: Kind; id: string; text: string; citeable: boolean; sourceId?: string; epoch?: number; observedAt?: string }>;
}

const slots = ['goal', 'result', 'todo'] as const;
const slotLabel = { goal: '目标', result: '成果', todo: '待办' } as const;

export function modelContextStamp(db: DatabaseSync, scope: Scope, conversationId: string | null): string {
  const one = (sql: string, ...args: Array<string | number>) => JSON.stringify(db.prepare(sql).get(...args) ?? null);
  const many = (sql: string, ...args: Array<string | number>) => JSON.stringify(db.prepare(sql).all(...args));
  const messages = conversationId
    ? many('SELECT id, role, body_json FROM model_messages WHERE project_id=? AND conversation_id=? ORDER BY rowid', scope.projectId, conversationId)
    : '[]';
  return createHash('sha256').update([
    one('SELECT name, description FROM projects WHERE id=?', scope.projectId),
    one('SELECT state, created_at FROM fixture_project_profiles WHERE project_id=?', scope.projectId),
    one('SELECT enabled, paused, expires_at, revoked_at FROM observation_grants WHERE id=?', scope.grantId),
    many('SELECT id, epoch, enabled FROM fixture_sources WHERE project_id=? AND root_id=? AND grant_id=? ORDER BY id', scope.projectId, scope.rootId, scope.grantId),
    many('SELECT id, source_id, epoch, data_json FROM fixture_facts WHERE project_id=? ORDER BY id', scope.projectId),
    many('SELECT id, revision, status, statement FROM fixture_decisions WHERE project_id=? AND root_id=? AND grant_id=? ORDER BY id, revision', scope.projectId, scope.rootId, scope.grantId),
    many('SELECT id, data_json FROM fixture_opinion_feedback WHERE project_id=? ORDER BY id', scope.projectId),
    messages,
  ].join('\n')).digest('hex');
}

function relevant(question: string, text: string): boolean {
  if (question.length < 4) return false;
  for (let index = 0; index + 4 <= question.length; index += 1) if (text.includes(question.slice(index, index + 4))) return true;
  return false;
}

function pack(project: { id: string; title: string }, question: string, items: Item[], maxChars: number): { user: string; items: Item[]; truncated: boolean; omitted: string[] } {
  let current = items.slice();
  const omitted: string[] = [];
  let truncated = false;
  const render = (list: Item[]) => JSON.stringify({
    dataOnly: true, project: { id: project.id, title: project.title, synthetic: true }, question,
    items: list.map(({ kind, id, text, citeable }) => ({ kind, id, text, citeable })), truncated, omitted,
  });
  while (render(current).length > maxChars) {
    const drop = current.reduce<Item | null>((lowest, item) => !lowest || item.priority < lowest.priority ? item : lowest, null);
    if (!drop || drop.priority >= 80) break;
    truncated = true; omitted.push(drop.id); current = current.filter(item => item !== drop);
  }
  if (render(current).length > maxChars) throw new ModelError('rejected', '上下文超过上限，未发出请求');
  return { user: render(current), items: current, truncated, omitted };
}

/** Build the smallest context that the server is still allowed to show. Project prose stays in the user data, never in the system prompt. */
export function buildModelContext(db: DatabaseSync, rawScope: unknown, question: string, conversationId: string | null, maxChars: number): ModelContext {
  const scope = ScopeSchema.parse(rawScope);
  const project = getSyntheticProject(scope.projectId);
  if (!project) throw new ModelError('rejected', '项目不可用', 403);
  return withFixtureAccess(db, scope, (_scope, findFact) => {
    const profile = db.prepare("SELECT p.name AS name, f.state AS state FROM projects p JOIN fixture_project_profiles f ON f.project_id=p.id WHERE p.id=?").get(scope.projectId);
    if (!profile || profile.state !== 'active' || profile.name !== project.title) throw new ModelError('rejected', '项目不可用', 403);
    const source = db.prepare('SELECT epoch, enabled FROM fixture_sources WHERE id=? AND project_id=? AND root_id=? AND grant_id=?').get(project.source.id, scope.projectId, scope.rootId, scope.grantId);
    const epoch = source?.enabled === 1 && Number.isSafeInteger(Number(source.epoch)) ? Number(source.epoch) : -1;
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const slot of slots) {
      const id = `${scope.projectId}-${slot}-${epoch}`;
      const fact = epoch < 0 ? null : findFact(project.source.id, id);
      if (!fact || fact.projectId !== scope.projectId) {
        items.push({ kind: 'unknown', id: `${scope.projectId}-${slot}-unknown`, text: `${slotLabel[slot]}未知或来源不可用`, citeable: false, priority: 80 });
      } else {
        seen.add(fact.id);
        items.push({ kind: 'fact', id: fact.id, text: fact.summary, citeable: true, priority: 60, sourceId: fact.sourceId, epoch: fact.epoch, observedAt: fact.observedAt });
      }
    }
    const extras = db.prepare('SELECT id, source_id FROM fixture_facts WHERE project_id=? ORDER BY id').all(scope.projectId);
    for (const row of extras) {
      if (typeof row.id !== 'string' || typeof row.source_id !== 'string' || seen.has(row.id)) continue;
      const fact = findFact(row.source_id, row.id);
      if (!fact || fact.projectId !== scope.projectId || !relevant(question, fact.summary)) continue;
      items.push({ kind: 'fact', id: fact.id, text: fact.summary, citeable: true, priority: 40, sourceId: fact.sourceId, epoch: fact.epoch, observedAt: fact.observedAt });
    }
    const decisions = db.prepare("SELECT id, revision, statement FROM fixture_decisions WHERE project_id=? AND root_id=? AND grant_id=? AND status='active' ORDER BY revision DESC LIMIT 3").all(scope.projectId, scope.rootId, scope.grantId);
    for (const row of decisions) {
      if (typeof row.id !== 'string' || typeof row.statement !== 'string' || typeof row.revision !== 'number') continue;
      items.push({ kind: 'user_decision', id: `${row.id}@${row.revision}`, text: row.statement, citeable: false, priority: 30 });
    }
    if (conversationId) {
      const messages = db.prepare('SELECT id, role, body_json FROM model_messages WHERE project_id=? AND conversation_id=? ORDER BY rowid DESC LIMIT 4').all(scope.projectId, conversationId);
      for (const row of messages.reverse()) {
        if (typeof row.id !== 'string' || typeof row.body_json !== 'string' || (row.role !== 'user' && row.role !== 'assistant')) continue;
        try {
          const body = JSON.parse(row.body_json) as { question?: string; answer?: string };
          const text = row.role === 'user' ? body.question : body.answer;
          if (typeof text === 'string' && text.trim()) items.push({ kind: 'conversation', id: row.id, text: text.slice(0, 300), citeable: false, priority: 20 });
        } catch { /* Skip a damaged history row rather than sending it. */ }
      }
    }
    const feedback = db.prepare('SELECT id, data_json FROM fixture_opinion_feedback WHERE project_id=? ORDER BY rowid DESC LIMIT 3').all(scope.projectId);
    for (const row of feedback.reverse()) {
      if (typeof row.id !== 'string' || typeof row.data_json !== 'string') continue;
      try {
        const body = JSON.parse(row.data_json) as { reason?: string };
        if (typeof body.reason === 'string' && body.reason.trim()) items.push({ kind: 'feedback', id: row.id, text: body.reason, citeable: false, priority: 10 });
      } catch { /* Feedback that cannot be parsed is not model context. */ }
    }
    const packed = pack({ id: project.id, title: project.title }, question, items, maxChars);
    return {
      projectId: project.id, projectTitle: project.title, question, system: MODEL_SYSTEM_PROMPT, user: packed.user,
      stamp: modelContextStamp(db, scope, conversationId), truncated: packed.truncated, omitted: packed.omitted,
      items: packed.items.map(item => ({
        kind: item.kind, id: item.id, text: item.text, citeable: item.citeable,
        ...(item.sourceId && item.epoch !== undefined && item.observedAt ? { sourceId: item.sourceId, epoch: item.epoch, observedAt: item.observedAt } : {}),
      })),
    };
  });
}
