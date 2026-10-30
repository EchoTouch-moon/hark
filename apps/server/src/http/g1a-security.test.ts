import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { FixtureConnector } from '@hearth/connectors';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';

const ORIGIN = 'http://127.0.0.1:4317';
let dir: string;
let store: Storage;
let apps: FastifyInstance[];
let orchestrator: Orchestrator;
let discovery: DiscoveryService;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-g1a-'));
  apps = [];
  store = new Storage(path.join(dir, 'synthetic.sqlite'));
  orchestrator = new Orchestrator({ storage: store, artifactRoot: path.join(dir, 'artifacts'), clock: () => '2026-10-28T12:00:00.000Z', stepDelayMs: 0 });
  discovery = new DiscoveryService({ storage: store, clock: () => '2026-10-28T12:00:00.000Z' });
  const connector = new FixtureConnector(loadConfig().repoRoot);
  store.seedProjects(connector.loadProjects());
  for (const { event, meta } of connector.loadEvents()) store.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful });
  await discovery.discover({ userInitiated: true });
  const now = '2026-10-28T12:00:00.000Z';
  for (const [id, projectId] of [['thread-a', 'project-atlas'], ['thread-b', 'project-beacon']] as const) {
    store.insertThread({ id, title: id, preview: '', projectId, proactiveStatus: 'idle', proactiveMessageId: null, updatedAt: now, createdAt: now });
    store.appendChat({ id: `message-${id}`, sessionId: id, role: 'user', content: '合成消息', adapter: 'mock', createdAt: now });
  }
});

afterEach(async () => {
  await Promise.all(apps.map(app => app.close()));
  store.close();
  await rm(dir, { recursive: true, force: true });
});

async function createClient(mode: boolean, runner = orchestrator) {
  const config = { ...loadConfig({ dbPath: path.join(dir, 'synthetic.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null }), demoMode: mode };
  const app = buildApp({ config, storage: store, services: { discovery, orchestrator: runner, chat: new MockAgentAdapter(), seedDemo: async () => ({ eventsIngested: 0 }) } });
  apps.push(app);
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const raw = session.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0]! : String(raw)).split(';')[0]!;
  const csrf = (session.json() as { csrfToken: string }).csrfToken;
  return { app, headers: { cookie, 'x-csrf-token': csrf, origin: ORIGIN } };
}

function snapshot() {
  return Object.fromEntries(['threads', 'chat_messages', 'projects', 'events', 'settings', 'cards', 'runs', 'approvals', 'audit_log'].map(name => [name, store.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

describe('G1-A legacy endpoints fail closed', () => {
  it.each([false, true, 'unknown'] as const)('proactive GET is read-only and never crosses projects in mode %s', async mode => {
    const { app, headers } = await createClient(mode as boolean);
    const before = snapshot();
    for (const id of ['thread-a', 'thread-b']) {
      const result = await app.inject({ method: 'GET', url: `/api/v1/threads/${id}/proactive`, headers });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ suggestion: null });
    }
    const absent = await app.inject({ method: 'GET', url: '/api/v1/threads/not-created/proactive', headers });
    expect(absent.statusCode).toBe(404);
    expect(snapshot()).toEqual(before);
  });

  it('does not create default or arbitrary threads on read-only list and history requests', async () => {
    const { app, headers } = await createClient(false);
    store.db.exec('DELETE FROM chat_messages; DELETE FROM threads');
    const before = snapshot();
    const list = await app.inject({ method: 'GET', url: '/api/v1/threads', headers });
    const history = await app.inject({ method: 'GET', url: '/api/v1/chat/history?threadId=not-created', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().threads).toEqual([]);
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it.each([false, true, 'unknown'] as const)('does not expose or mutate legacy demo cards without isolated demo execution in mode %s', async mode => {
    const { app, headers } = await createClient(mode as boolean);
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.json().legacyDemoAvailable).toBe(false);
    const card = store.listCards({ limit: 1 })[0]!;
    const before = snapshot();
    const requests = [
      { method: 'GET' as const, url: '/api/v1/cards' },
      { method: 'GET' as const, url: `/api/v1/cards/${card.id}` },
      { method: 'GET' as const, url: '/api/v1/projects' },
      { method: 'GET' as const, url: '/api/v1/projects/project-atlas' },
      { method: 'GET' as const, url: '/api/v1/events?projectId=project-beacon' },
      { method: 'POST' as const, url: `/api/v1/cards/${card.id}/dismiss`, payload: {} },
      { method: 'POST' as const, url: '/api/v1/discover' },
      { method: 'POST' as const, url: '/api/v1/demo/seed' },
      { method: 'POST' as const, url: '/api/v1/demo/reset' },
    ];
    for (const request of requests) {
      const result = await app.inject({ ...request, headers });
      expect(result.statusCode).toBe(403);
    }
    expect(snapshot()).toEqual(before);
  });

  it.each([false, true, 'unknown'] as const)('rejects forged simulated actions and legacy execution in mode %s', async mode => {
    const { app, headers } = await createClient(mode as boolean);
    const execute = vi.spyOn(orchestrator, 'executeCard');
    const approve = vi.spyOn(orchestrator, 'decideApproval');
    const card = store.listCards({ limit: 1 })[0]!;
    expect(card).toBeDefined();
    const before = snapshot();
    for (const demo of [false, true]) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/threads/thread-a/actions/forged/execute', headers, payload: { action: { id: 'forged', label: '执行', needsConfirm: false, demo } } });
      expect(result.statusCode).toBe(403);
      expect(JSON.stringify(result.json())).not.toContain('已完成');
    }
    const [run, grant] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/cards/${card.id}/execute?sync=1`, headers }),
      app.inject({ method: 'POST', url: '/api/v1/approvals/forged-run', headers, payload: { decision: 'approve' } }),
    ]);
    expect(run.statusCode).toBe(403);
    expect(grant.statusCode).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it.each(['queued', 'awaiting_approval', 'executing'] as const)('keeps cancellation available for an existing %s run', async state => {
    const { app, headers } = await createClient(false);
    const card = store.listCards({ limit: 1 })[0]!;
    store.createRun({ id: 'run-cancel-existing', cardId: card.id, actionId: card.action.id, idempotencyKey: card.action.idempotencyKey, state: 'queued', createdAt: '2026-10-28T12:00:00.000Z', resultArtifactRefs: [] }, card.action);
    if (state !== 'queued') store.transitionRun('run-cancel-existing', state, {}, { actor: 'test' });
    const result = await app.inject({ method: 'POST', url: '/api/v1/runs/run-cancel-existing/cancel', headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().run.state).toBe('cancelled');
  });

  it('preserves uncertainty when an existing verifying run is stopped', async () => {
    const { app, headers } = await createClient(false);
    const card = store.listCards({ limit: 1 })[0]!;
    store.createRun({ id: 'run-verifying', cardId: card.id, actionId: card.action.id, idempotencyKey: card.action.idempotencyKey, state: 'queued', createdAt: '2026-10-28T12:00:00.000Z', resultArtifactRefs: [] }, card.action);
    store.transitionRun('run-verifying', 'executing', {}, { actor: 'test' });
    store.transitionRun('run-verifying', 'verifying', {}, { actor: 'test' });
    const result = await app.inject({ method: 'POST', url: '/api/v1/runs/run-verifying/cancel', headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().run.state).toBe('pending_verification');
    expect(store.getRun('run-verifying')?.verificationVerdict).toBeUndefined();
    const repeat = await app.inject({ method: 'POST', url: '/api/v1/runs/run-verifying/cancel', headers });
    expect(repeat.json().run.state).toBe('pending_verification');
  });

  it.each([false, 'unknown'] as const)('mode %s refuses legacy execution even if an isolated harness enables the executor', async mode => {
    const runner = new Orchestrator({ storage: store, artifactRoot: path.join(dir, 'artifacts'), clock: () => '2026-10-28T12:00:00.000Z', allowLegacyExecution: true });
    const { app, headers } = await createClient(mode as boolean, runner);
    const execute = vi.spyOn(runner, 'executeCard');
    const approve = vi.spyOn(runner, 'decideApproval');
    const card = store.listCards({ limit: 1 })[0]!;
    const before = snapshot();
    expect((await app.inject({ method: 'POST', url: `/api/v1/cards/${card.id}/execute`, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/approvals/fake-run', headers, payload: { decision: 'approve' } })).statusCode).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('blocks direct orchestration unless explicitly enabled by an isolated test harness', async () => {
    const card = store.listCards({ limit: 1 })[0]!;
    const before = snapshot();
    await expect(orchestrator.executeCard(card.id, 'user')).rejects.toMatchObject({ code: 'LEGACY_ACTIONS_DISABLED' });
    await expect(orchestrator.decideApproval('forged-run', 'approve', 'user')).rejects.toMatchObject({ code: 'LEGACY_ACTIONS_DISABLED' });
    expect(snapshot()).toEqual(before);
  });

  it('recovers legacy executing runs as pending verification without claiming completion', async () => {
    const card = store.listCards({ limit: 1 })[0]!;
    store.createRun({ id: 'run-recover-existing', cardId: card.id, actionId: card.action.id, idempotencyKey: card.action.idempotencyKey, state: 'queued', createdAt: '2026-10-28T12:00:00.000Z', resultArtifactRefs: [] }, card.action);
    store.transitionRun('run-recover-existing', 'executing', { startedAt: '2026-10-28T12:00:00.000Z' }, { actor: 'test' });
    const recovered = await orchestrator.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.state).toBe('pending_verification');
    expect(store.getRun('run-recover-existing')?.verificationVerdict).toBeUndefined();
  });

  it('withholds known unsafe legacy suggestions and simulated completion from history and previews without deleting them', async () => {
    const { app, headers } = await createClient(false);
    const now = '2026-10-28T12:00:00.000Z';
    store.appendChat({ id: 'proactive-cards-thread-a', sessionId: 'thread-a', role: 'assistant', content: 'PROJECT_B_SECRET_SYNTHETIC', adapter: 'mock', createdAt: now });
    store.appendChat({ id: 'progress-123', sessionId: 'thread-a', role: 'assistant', content: '伪造任务已完成', runId: 'demo-run-123', adapter: 'mock', createdAt: now });
    store.touchThread('thread-a', '伪造任务已完成');
    const before = snapshot();
    const [history, thread, list] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-a', headers }),
      app.inject({ method: 'GET', url: '/api/v1/threads/thread-a', headers }),
      app.inject({ method: 'GET', url: '/api/v1/threads', headers }),
    ]);
    for (const result of [history, thread, list]) {
      expect(result.statusCode).toBe(200);
      expect(result.body).not.toContain('PROJECT_B_SECRET_SYNTHETIC');
      expect(result.body).not.toContain('伪造任务已完成');
    }
    expect(history.json().messages.some((message: { id: string }) => message.id === 'message-thread-a')).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  it('treats an invalid demo environment value as disabled', () => {
    vi.stubEnv('HEARTH_DEMO', 'false');
    try { expect(loadConfig().demoMode).toBe(false); }
    finally { vi.unstubAllEnvs(); }
  });
});
