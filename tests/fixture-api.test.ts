import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { request, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/storage.js';

// If the service imports either disabled adapter, this isolated suite fails.
vi.mock('../src/fixture-discovery.js', () => { throw new Error('Disabled directory adapter loaded'); });
vi.mock('../src/posix-dir-handle.js', () => { throw new Error('Disabled native adapter loaded'); });
import { createSyntheticServer } from '../src/fixture-api.js';

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())); });
async function start(db: ReturnType<typeof openDatabase>) {
  const server = createSyntheticServer(db); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const base = `http://127.0.0.1:${address.port}`;
  const session = await fetch(`${base}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  const token = (await session.json() as { csrfToken: string }).csrfToken;
  if (!cookie) throw new Error('Missing cookie');
  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie } });
  const post = (path: string, data: unknown, extra: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', 'x-hearth-csrf': token, ...extra }, body: JSON.stringify(data),
  });
  return { base, get, post, server };
}
type Inventory = { projects: Array<{ id: string; coverage: string }>; access: Array<{ id: string; state: string }> };
describe('local synthetic service', () => {
  it('requires a local session and validates origin, csrf, input and host', async () => {
    const db = openDatabase(':memory:');
    try {
      const { base, get, post } = await start(db);
      expect((await fetch(`${base}/api/inventory`)).status).toBe(401);
      expect((await post('/api/inventory', {}, { origin: 'https://example.invalid' })).status).toBe(403);
      expect((await post('/api/inventory', {}, { 'x-hearth-csrf': 'incorrect' })).status).toBe(403);
      expect((await post('/api/inventory', { path: '/tmp' })).status).toBe(400);
      expect((await post('/api/inventory', {}, { 'content-type': 'text/plain' })).status).toBe(403);
      expect((await post('/api/projects/project-a/execute', {})).status).toBe(404);
      expect((await post('/api/v1/cards/card/execute', {})).status).toBe(404);
      expect((await post('/api/v1/approvals/run', {})).status).toBe(404);
      const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${base}/api/session`, { headers: { host: 'example.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      expect(hostStatus).toBe(403);
      expect((await get('/api/projects/..%2Fprivate')).status).toBe(404);
      expect(db.prepare('SELECT count(*) AS n FROM projects').get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it('supports the synthetic journey and retains feedback after restart without exposing disabled sources', async () => {
    const db = openDatabase(':memory:');
    try {
      const s = await start(db);
      const blank = await (await s.get('/api/inventory')).json() as Inventory;
      expect(blank.projects).toEqual([]); expect(blank.access.every(x => x.state === 'uninitialized')).toBe(true);
      const seeded = await (await s.post('/api/inventory', {})).json() as Inventory;
      expect(seeded.projects.map(x => x.id)).toEqual(['project-a', 'project-b']);
      expect(seeded.projects.every(x => x.coverage === 'available')).toBe(true);
      const before = db.prepare('SELECT total_changes() AS n').get()?.n;
      const a = await (await s.get('/api/projects/project-a')).json() as { current: { revision: { version: number } }; understanding: { todo: { text: string } } };
      expect(a.current.revision.version).toBe(1); expect(a.understanding.todo.text).toContain('主题筛选');
      expect(db.prepare('SELECT total_changes() AS n').get()?.n).toBe(before);
      const challenge = { requestId: 'fixture-request', reason: '请更谨慎', createdAt: '2026-11-04T03:00:00.000Z', expectedVersion: 1 };
      const changed = await s.post('/api/projects/project-a/challenge', challenge); expect(changed.status).toBe(200);
      expect((await changed.json() as { current: { revision: { version: number } } }).current.revision.version).toBe(2);
      expect((await s.post('/api/projects/project-a/challenge', challenge)).status).toBe(200);
      expect((await s.post('/api/projects/project-a/challenge', { ...challenge, reason: '不同反馈' })).status).toBe(409);
      const question = { requestId: 'question-api', question: '依据是什么？', createdAt: '2026-11-04T03:00:00.000Z' };
      const answer = await s.post('/api/projects/project-a/question', question);
      expect(await answer.json()).toMatchObject({ synthetic: true, mode: 'mock' });
      expect((await s.post('/api/projects/project-a/question', question)).status).toBe(200);
      expect((await s.post('/api/projects/project-a/question', { ...question, question: '不同的问题' })).status).toBe(409);
      expect(JSON.stringify(await (await s.get('/api/projects/project-b')).json())).not.toContain(question.question);
      expect((await s.post('/api/projects/project-a/access', { action: 'pause' })).status).toBe(200);
      expect((await s.get('/api/projects/project-a')).status).toBe(403);
      const paused = await (await s.get('/api/inventory')).json() as Inventory;
      expect(paused.projects.map(x => x.id)).toEqual(['project-b']);
      expect(paused.access.find(x => x.id === 'project-a')?.state).toBe('paused');
      const restart = await start(db);
      expect((await (await restart.get('/api/inventory')).json() as Inventory).access.find(x => x.id === 'project-a')?.state).toBe('paused');
      expect((await restart.post('/api/projects/project-a/access', { action: 'resume' })).status).toBe(200);
      const resumed = await (await restart.get('/api/projects/project-a')).json() as { current: { revision: { version: number } }; previous: { feedback: unknown[] }; questions: unknown[] };
      expect(resumed.current.revision.version).toBe(2); expect(resumed.previous.feedback).toHaveLength(1);
      expect(resumed.questions).toHaveLength(1);
      expect((await restart.post('/api/projects/project-a/challenge', { requestId: 'another', reason: '继续核对', createdAt: '2026-11-04T04:00:00.000Z', expectedVersion: 2 })).status).toBe(200);
      const third = await (await restart.get('/api/projects/project-a')).json() as { current: { revision: { version: number } }; previous: { revision: { version: number } }; first: { revision: { version: number } } };
      expect([third.current.revision.version, third.previous.revision.version, third.first.revision.version]).toEqual([3, 2, 1]);
      db.exec("UPDATE fixture_sources SET enabled=0 WHERE id='source-project-a-1'");
      const unavailable = await (await restart.get('/api/projects/project-a')).json() as { current: unknown; understanding: { goal: unknown }; project: object; questions: unknown[] };
      expect(unavailable.current).toBeNull(); expect(unavailable.understanding.goal).toBeNull();
      expect(unavailable.questions).toEqual([]);
      expect(unavailable.project).not.toHaveProperty('source');
      expect((await restart.post('/api/projects/project-a/question', { ...question, requestId: 'after-source-disabled' })).status).toBe(409);
      const partial = await (await restart.post('/api/inventory', {})).json() as Inventory & { initializationErrors: string[] };
      expect(partial.initializationErrors).toEqual(['project-a']);
      expect(partial.projects.find(project => project.id === 'project-b')?.coverage).toBe('available');
      expect((await restart.post('/api/projects/project-a/access', { action: 'revoke' })).status).toBe(200);
      expect((await restart.post('/api/projects/project-a/access', { action: 'resume' })).status).toBe(409);
      expect((await restart.post('/api/inventory', {})).status).toBe(200);
      expect((await (await restart.get('/api/inventory')).json() as Inventory).access.find(x => x.id === 'project-a')?.state).toBe('revoked');
      expect(db.prepare('SELECT count(*) AS n FROM fixture_roots').get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it('restores persisted feedback with a fresh database connection and a fresh server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hark-api-restart-')); const path = join(dir, 'synthetic.sqlite');
    let db = openDatabase(path);
    try {
      const first = await start(db);
      expect((await first.post('/api/inventory', {})).status).toBe(200);
      expect((await first.post('/api/projects/project-a/question', { requestId: 'question-restart', question: '合成测试：什么依据？', createdAt: '2026-11-04T03:00:00.000Z' })).status).toBe(200);
      expect((await first.post('/api/projects/project-a/challenge', { requestId: 'restart', reason: '再核对', createdAt: '2026-11-04T03:00:00.000Z', expectedVersion: 1 })).status).toBe(200);
      await new Promise<void>(resolve => first.server.close(() => resolve()));
      servers.splice(servers.indexOf(first.server), 1);
      db.close(); db = openDatabase(path);
      const second = await start(db);
      const restored = await (await second.get('/api/projects/project-a')).json() as { current: { revision: { version: number } }; previous: { feedback: Array<{ reason: string }> }; questions: Array<{ question: string }> };
      expect(restored.current.revision.version).toBe(2);
      expect(restored.previous.feedback[0]?.reason).toBe('再核对');
      expect(restored.questions[0]?.question).toBe('合成测试：什么依据？');
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not disguise corrupt stored questions as a successful empty history', async () => {
    const db = openDatabase(':memory:');
    try {
      const s = await start(db); expect((await s.post('/api/inventory', {})).status).toBe(200);
      db.prepare('INSERT INTO feedback(id,project_id,data_json) VALUES (?,?,?)').run('m1-question-invalid', 'project-a', '{');
      expect((await s.get('/api/projects/project-a')).status).toBe(403);
      expect((await s.get('/api/projects/project-b')).status).toBe(200);
    } finally { db.close(); }
  });
});
