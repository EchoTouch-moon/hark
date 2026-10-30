import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { startServer } from '../main.js';

let dir = '';
let server: Awaited<ReturnType<typeof startServer>> | undefined;

afterEach(async () => {
  if (server) {
    await server.app.close();
    server.storage.close();
    server = undefined;
  }
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('no local test port');
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

it('serves fail-closed G1-A behavior over real loopback HTTP with isolated synthetic data', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-g1a-http-'));
  vi.stubEnv('HEARTH_INSIGHT_DB', path.join(dir, 'insight.sqlite'));
  vi.stubEnv('HEARTH_ANALYSIS_DB', path.join(dir, 'analysis.sqlite'));
  vi.stubEnv('HEARTH_OBSERVER_WATCH', '0');
  vi.stubEnv('HEARTH_ANALYSIS_PROVIDER', 'mock');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = await startServer({ port, allowedOrigins: [origin], demoMode: false, dbPath: path.join(dir, 'app.sqlite'), observerDbPath: path.join(dir, 'observer.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null });

  const health = await fetch(`${origin}/api/v1/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ demoMode: false, legacyDemoAvailable: false });
  const session = await fetch(`${origin}/api/v1/auth/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  const { csrfToken } = await session.json() as { csrfToken: string };
  const headers = { cookie: cookie!, origin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
  const created = await fetch(`${origin}/api/v1/threads`, { method: 'POST', headers, body: JSON.stringify({ title: '合成线程', projectId: null }) });
  expect(created.status).toBe(201);
  const { thread } = await created.json() as { thread: { id: string } };
  const before = server.storage.getThread(thread.id);
  const proactive = await fetch(`${origin}/api/v1/threads/${thread.id}/proactive`, { headers });
  expect(await proactive.json()).toEqual({ suggestion: null });
  expect(server.storage.getThread(thread.id)).toEqual(before);
  const denied = await fetch(`${origin}/api/v1/threads/${thread.id}/actions/forged/execute`, {
    method: 'POST', headers, body: JSON.stringify({ action: { id: 'forged', label: '执行', needsConfirm: false, demo: false } }),
  });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: 'LEGACY_ACTIONS_DISABLED' } });
  expect(server.storage.listRuns()).toEqual([]);
  expect(server.storage.listChat(thread.id)).toEqual([]);
}, 15_000);
