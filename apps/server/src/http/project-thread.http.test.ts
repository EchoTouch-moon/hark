import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { ProjectObserver } from '@hearth/project-observer';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { createGitRepo } from '../../../../packages/project-observer/src/testkit/git-fixture.js';

let dir: string;
let storage: Storage;
let observer: ProjectObserver;
let app: FastifyInstance;
let origin: string;
let headers: Record<string, string>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-project-thread-'));
  storage = new Storage(path.join(dir, 'core.sqlite'));
  observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
  const config = loadConfig({
    dbPath: path.join(dir, 'core.sqlite'), observerDbPath: path.join(dir, 'observer.sqlite'),
    artifactRoot: path.join(dir, 'artifacts'), staticDir: null, demoMode: false,
  });
  app = buildApp({
    config, storage, observer,
    services: {
      discovery: new DiscoveryService({ storage, clock: () => new Date().toISOString() }),
      orchestrator: new Orchestrator({ storage, artifactRoot: config.artifactRoot, clock: () => new Date().toISOString(), stepDelayMs: 0 }),
      chat: new MockAgentAdapter(), seedDemo: async () => ({ eventsIngested: 0 }),
    },
  });
  origin = await app.listen({ port: 0, host: '127.0.0.1' });
  config.allowedOrigins.push(origin);
  const session = await fetch(`${origin}/api/v1/auth/session`);
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = await session.json() as { csrfToken: string };
  headers = { cookie, origin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
});

afterEach(async () => {
  await app.close();
  await observer.stop();
  observer.close();
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

function request(method: string, route: string, payload?: unknown): ReturnType<typeof fetch> {
  return fetch(`${origin}${route}`, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}

async function register(name: string): Promise<string> {
  const localPath = await createGitRepo(dir, name);
  const response = await request('POST', '/api/v1/observer/projects', { localPath, name, confirm: true });
  expect(response.status).toBe(201);
  const data = await response.json() as { project: { id: string } };
  return data.project.id;
}

describe('Observer project-bound conversations over loopback HTTP', () => {
  it('persists an explicit binding to a registered project', async () => {
    const projectId = await register('synthetic-project');
    const created = await request('POST', '/api/v1/threads', { title: '项目讨论', projectId });
    expect(created.status).toBe(201);
    const { thread } = await created.json() as { thread: { id: string; projectId: string } };
    expect(thread.projectId).toBe(projectId);
    const disk = new Storage(path.join(dir, 'core.sqlite'));
    try {
      expect(disk.getThread(thread.id)?.projectId).toBe(projectId);
    } finally {
      disk.close();
    }
    const read = await request('GET', `/api/v1/threads/${thread.id}`);
    expect(await read.json()).toMatchObject({ thread: { id: thread.id, projectId } });
  });

  it('rejects unknown and legacy Demo identities before creating any thread', async () => {
    const before = storage.listThreads();
    for (const projectId of ['missing-observer-project', 'project-atlas']) {
      const response = await request('POST', '/api/v1/threads', { projectId });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
    }
    expect(storage.listThreads()).toEqual(before);
  });

  it('keeps project lists scoped and preserves unbound history without rebinding it', async () => {
    const projectA = await register('synthetic-a');
    const projectB = await register('synthetic-b');
    const createdA = await request('POST', '/api/v1/threads', { title: 'A only', projectId: projectA });
    const createdB = await request('POST', '/api/v1/threads', { title: 'B only', projectId: projectB });
    const legacy = await request('POST', '/api/v1/threads', { title: '未关联的历史', projectId: null });
    expect([createdA.status, createdB.status, legacy.status]).toEqual([201, 201, 201]);
    const scoped = await request('GET', `/api/v1/threads?projectId=${encodeURIComponent(projectA)}`);
    const data = await scoped.json() as { threads: Array<{ title: string; projectId: string | null }> };
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0]).toMatchObject({ title: 'A only', projectId: projectA });
    const all = await request('GET', '/api/v1/threads');
    const allData = await all.json() as { threads: Array<{ title: string; projectId: string | null }> };
    expect(allData.threads).toHaveLength(3);
    expect(allData.threads).toContainEqual(expect.objectContaining({ title: '未关联的历史', projectId: null }));
    expect((await request('GET', '/api/v1/threads?projectId=unknown')).status).toBe(404);
    expect((await request('GET', `/api/v1/threads?projectId=${projectA}&unexpected=true`)).status).toBe(400);
  });
});
