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
  dir = '';
});

async function startIsolated(demoFlag: string, autoSeed = '1') {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-demo-start-'));
  vi.stubEnv('HEARTH_DEMO', demoFlag);
  vi.stubEnv('HEARTH_AUTOSEED', autoSeed);
  vi.stubEnv('HEARTH_INSIGHT_DB', path.join(dir, 'insight.sqlite'));
  vi.stubEnv('HEARTH_ANALYSIS_DB', path.join(dir, 'analysis.sqlite'));
  vi.stubEnv('HEARTH_OBSERVER_WATCH', '0');
  vi.stubEnv('HEARTH_ANALYSIS_PROVIDER', 'mock');
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('no local test port');
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  server = await startServer({ port: address.port, allowedOrigins: [origin], dbPath: path.join(dir, 'app.sqlite'), observerDbPath: path.join(dir, 'observer.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null });
  return { server, origin };
}

it('seeds first-start Demo fixtures without enabling legacy execution or approval', async () => {
  const { server: running, origin } = await startIsolated('1');
  expect(running.config.demoMode).toBe(true);
  expect(running.orchestrator.legacyExecutionEnabled).toBe(false);
  expect(running.storage.listProjects().length).toBeGreaterThan(0);
  expect(running.storage.listEvents().length).toBeGreaterThan(0);
  expect((await (await fetch(`${origin}/api/v1/health`)).json())).toMatchObject({ demoMode: true, legacyDemoAvailable: false });

  const session = await fetch(`${origin}/api/v1/auth/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  const { csrfToken } = await session.json() as { csrfToken: string };
  const headers = { cookie: cookie!, origin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
  for (const [url, payload] of [
    ['/api/v1/cards/forged/execute', {}],
    ['/api/v1/approvals/forged', { decision: 'approve' }],
  ] as const) {
    const response = await fetch(`${origin}${url}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'LEGACY_ACTIONS_DISABLED' } });
  }
  expect(running.storage.listRuns()).toEqual([]);
}, 15_000);

it.each(['false', 'true', 'yes', '0'])('does not seed when HEARTH_DEMO is %s', async flag => {
  const { server: running } = await startIsolated(flag);
  expect(running.config.demoMode).toBe(false);
  expect(running.storage.listProjects()).toEqual([]);
  expect(running.storage.listEvents()).toEqual([]);
}, 15_000);

it('respects an explicit request to disable Demo autoseeding', async () => {
  const { server: running } = await startIsolated('1', '0');
  expect(running.config.demoMode).toBe(true);
  expect(running.storage.listProjects()).toEqual([]);
  expect(running.storage.listEvents()).toEqual([]);
}, 15_000);
