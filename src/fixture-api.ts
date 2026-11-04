import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { challengeSyntheticOpinion, ensureSyntheticOpinion, readSyntheticOpinion, readSyntheticQuestions, saveSyntheticQuestion } from './fixture-dialogue.js';
import { readSyntheticInventory } from './fixture-global-inventory.js';
import { readFixtureOpinion } from './fixture-opinion-store.js';
import { ingestSyntheticUnderstanding, readSyntheticUnderstanding } from './fixture-understanding.js';
import { listSyntheticCatalog } from './synthetic-catalog.js';
import { checkStoredObservation } from './storage.js';
import { ObservationExpiry } from './contracts.js';

const ProjectId = z.enum(['project-a', 'project-b']);
type ProjectId = z.infer<typeof ProjectId>;
const Empty = z.object({}).strict();
const Challenge = z.object({ requestId: z.string().trim().min(1).max(256), reason: z.string().trim().min(1).max(500),
  createdAt: z.string().datetime({ offset: true }), expectedVersion: z.number().int().positive().safe() }).strict();
const Question = z.object({ requestId: z.string().trim().min(1).max(256), question: z.string().trim().min(1).max(500), createdAt: z.string().datetime({ offset: true }) }).strict();
const Access = z.object({ action: z.enum(['pause', 'resume', 'revoke']) }).strict();
const marker = 'm1-synthetic-initialized';
const scopeFor = (id: ProjectId) => ({ principalId: 'demo', projectId: id, grantId: `grant-${id}`, rootId: 'synthetic-root' });
const scopes = [scopeFor('project-a'), scopeFor('project-b')];
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const assets: Record<string, { filename: string; contentType: string }> = {
  '/': { filename: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { filename: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/styles.css': { filename: 'styles.css', contentType: 'text/css; charset=utf-8' },
};
type AccessState = 'active' | 'paused' | 'revoked' | 'uninitialized' | 'unavailable';

function state(db: DatabaseSync, id: ProjectId): AccessState {
  if (!db.prepare('SELECT 1 AS ok FROM settings WHERE key=? AND value=?').get(marker, '1')) return 'uninitialized';
  const scope = scopeFor(id);
  const row = db.prepare('SELECT principal_id, project_id, root_id, enabled, paused, expires_at, revoked_at FROM observation_grants WHERE id=?').get(scope.grantId);
  if (!row || row.principal_id !== scope.principalId || row.project_id !== id || row.root_id !== scope.rootId) return 'unavailable';
  if (row.revoked_at !== null) return 'revoked';
  if (row.enabled !== 1 || typeof row.expires_at !== 'string' || !ObservationExpiry.safeParse(row.expires_at).success || (row.expires_at !== 'never' && Date.parse(row.expires_at) <= Date.now())) return 'unavailable';
  if (row.paused === 1) return 'paused';
  return checkStoredObservation(db, scope.grantId, { principalId: scope.principalId, projectId: scope.projectId, rootId: scope.rootId, operation: 'observe' }).allowed ? 'active' : 'unavailable';
}
function inventory(db: DatabaseSync) {
  const catalog = listSyntheticCatalog();
  return { ...readSyntheticInventory(db, scopes), access: catalog.projects.map(project => ({ id: project.id, title: project.title, state: state(db, project.id) })) };
}
function initialize(db: DatabaseSync): string[] {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT value FROM settings WHERE key=?').get(marker);
    if (!existing) {
      if (db.prepare('SELECT id FROM projects LIMIT 1').get() || db.prepare('SELECT id FROM observation_grants LIMIT 1').get()) throw new Error('Fixture unavailable');
      const catalog = listSyntheticCatalog();
      for (const project of catalog.projects) {
        const scope = scopeFor(project.id);
        db.prepare('INSERT INTO projects(id,name,description) VALUES (?,?,?)').run(project.id, project.title, 'synthetic');
        db.prepare('INSERT INTO observation_grants VALUES (?,?,?,?,1,0,?,NULL)').run(scope.grantId, scope.principalId, scope.projectId, scope.rootId, 'never');
        db.prepare('INSERT INTO fixture_project_profiles VALUES (?, ?, ?)').run(project.id, 'active', '2026-11-04T00:00:00.000Z');
      }
      db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker, '1');
    } else if (existing.value !== '1') throw new Error('Fixture unavailable');
    // Upgrade only the two previously issued demo defaults; never re-enable a paused or revoked grant.
    for (const scope of scopes) db.prepare("UPDATE observation_grants SET expires_at='never' WHERE id=? AND principal_id=? AND project_id=? AND root_id=? AND expires_at='2099-01-01T00:00:00.000Z'")
      .run(scope.grantId, scope.principalId, scope.projectId, scope.rootId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const errors: string[] = [];
  for (const scope of scopes) {
    if (state(db, ProjectId.parse(scope.projectId)) !== 'active') continue;
    try {
      ingestSyntheticUnderstanding(db, scope);
      if (!ensureSyntheticOpinion(db, scope)) errors.push(scope.projectId);
    } catch { errors.push(scope.projectId); }
  }
  return errors;
}
function changeAccess(db: DatabaseSync, id: ProjectId, action: z.infer<typeof Access>['action']): AccessState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = state(db, id), scope = scopeFor(id);
    if ((action === 'pause' && before !== 'active') || (action === 'resume' && before !== 'paused') || (action === 'revoke' && before !== 'active' && before !== 'paused')) throw new Error('Fixture unavailable');
    if (action === 'revoke') db.prepare('UPDATE observation_grants SET enabled=0, revoked_at=? WHERE id=? AND revoked_at IS NULL').run(new Date().toISOString(), scope.grantId);
    else db.prepare('UPDATE observation_grants SET paused=? WHERE id=? AND revoked_at IS NULL').run(action === 'pause' ? 1 : 0, scope.grantId);
    db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?,?)').run(randomUUID(), new Date().toISOString(), `synthetic_${action}`, 'demo', id, JSON.stringify({ synthetic: true }));
    const after = state(db, id); db.exec('COMMIT'); return after;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function equal(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length;
    if (size > 8192) throw new Error('Body too large');
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Caller owns db and server lifecycle. Only the caller may bind the returned server. */
export function createSyntheticServer(db: DatabaseSync) {
  const session = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const address = server.address();
    if (!address || typeof address === 'string') return reply(res, 503, { error: '服务不可用' });
    const host = `127.0.0.1:${address.port}`, origin = `http://${host}`;
    if (req.headers.host !== host) return reply(res, 403, { error: '请求来源不受支持' });
    const path = req.url?.split('?')[0] ?? '';
    if (req.method === 'GET' && Object.hasOwn(assets, path)) {
      const asset = assets[path]!;
      try { const data = await readFile(join(webRoot, asset.filename)); res.writeHead(200, { 'Content-Type': asset.contentType }); res.end(data); }
      catch { reply(res, 404, { error: '资源不可用' }); }
      return;
    }
    if (req.method === 'GET' && path === '/api/session') {
      res.setHeader('Set-Cookie', `hearth_synthetic=${session}; HttpOnly; SameSite=Strict; Path=/`);
      return reply(res, 200, { csrfToken: csrf });
    }
    const cookies = (req.headers.cookie ?? '').split(';').map(part => part.trim());
    const cookie = cookies.find(part => part.startsWith('hearth_synthetic='))?.slice('hearth_synthetic='.length);
    if (!equal(cookie, session)) return reply(res, 401, { error: '会话已失效' });
    if (req.method === 'POST' && (req.headers.origin !== origin || !equal(req.headers['x-hearth-csrf'] as string | undefined, csrf) || req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')) return reply(res, 403, { error: '请求校验失败' });
    try {
      if (path === '/api/inventory' && req.method === 'GET') return reply(res, 200, inventory(db));
      if (path === '/api/inventory' && req.method === 'POST') { Empty.parse(await body(req)); const initializationErrors = initialize(db); return reply(res, 200, { ...inventory(db), initializationErrors }); }
      const match = /^\/api\/projects\/(project-a|project-b)(?:\/(challenge|question|access))?$/.exec(path);
      if (!match) return reply(res, 404, { error: '没有此入口' });
      const id = ProjectId.parse(match[1]), action = match[2], scope = scopeFor(id);
      if (!action && req.method === 'GET') {
        const understanding = readSyntheticUnderstanding(db, scope);
        if (!understanding) return reply(res, 403, { error: '项目不可用' });
        const project = listSyntheticCatalog().projects.find(item => item.id === id)!;
        const current = readSyntheticOpinion(db, scope);
        const previous = current && current.revision.version > 1 ? readFixtureOpinion(db, scope, current.revision.opinionId, current.revision.version - 1) : null;
        const first = current && current.revision.version > 2 ? readFixtureOpinion(db, scope, current.revision.opinionId, 1) : null;
        const questions = readSyntheticQuestions(db, scope);
        if (!questions) return reply(res, 403, { error: '项目不可用' });
        return reply(res, 200, { project, understanding, current, previous, first, questions });
      }
      if (req.method !== 'POST' || !action) return reply(res, 404, { error: '没有此入口' });
      const raw = await body(req);
      if (action === 'access') return reply(res, 200, { state: changeAccess(db, id, Access.parse(raw).action) });
      if (state(db, id) !== 'active') return reply(res, 403, { error: '项目不可用' });
      if (action === 'question') {
        return reply(res, 200, saveSyntheticQuestion(db, scope, Question.parse(raw)));
      }
      return reply(res, 200, challengeSyntheticOpinion(db, scope, Challenge.parse(raw)));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return reply(res, 400, { error: '请求格式不正确' });
      if (error instanceof Error && /conflict/i.test(error.message)) return reply(res, 409, { error: '版本或重复请求冲突' });
      return reply(res, 409, { error: '数据不可用，请检查合成项目状态' });
    }
  });
  return server;
}
