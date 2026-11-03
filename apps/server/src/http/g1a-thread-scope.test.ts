import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';

const ORIGIN = 'http://127.0.0.1:4317';
const NOW = '2026-10-28T12:00:00.000Z';
let dir: string;
let store: Storage;
let app: FastifyInstance;
let headers: Record<string, string>;
let reply: MockInstance<MockAgentAdapter['reply']>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-thread-scope-'));
  store = new Storage(path.join(dir, 'synthetic.sqlite'));
  store.seedProjects([
    { id: 'project-atlas', name: 'Synthetic Atlas', description: '', visibility: 'demo' },
    { id: 'project-beacon', name: 'Synthetic Beacon', description: '', visibility: 'demo' },
  ]);
  for (const [id, projectId, marker] of [
    ['thread-a', 'project-atlas', 'SYNTHETIC_ATLAS_MARKER'],
    ['thread-b', 'project-beacon', 'SYNTHETIC_BEACON_MARKER'],
    ['thread-global', null, 'SYNTHETIC_GLOBAL_MARKER'],
  ] as const) {
    store.insertThread({ id, title: id, preview: marker, projectId, proactiveStatus: 'idle', proactiveMessageId: null, createdAt: NOW, updatedAt: NOW });
    store.appendChat({ id: `initial-${id}`, sessionId: id, role: 'user', content: marker, adapter: 'mock', createdAt: NOW });
  }
  // Legacy orphaned messages do not establish a trustworthy global thread.
  store.appendChat({ id: 'orphan-message', sessionId: 'thread-orphan', role: 'user', content: 'SYNTHETIC_ORPHAN_MARKER', adapter: 'mock', createdAt: NOW });
  const chat = new MockAgentAdapter();
  reply = vi.spyOn(chat, 'reply');
  const config = loadConfig({ dbPath: path.join(dir, 'synthetic.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null, demoMode: false });
  const orchestrator = new Orchestrator({ storage: store, artifactRoot: path.join(dir, 'artifacts'), clock: () => NOW });
  const discovery = new DiscoveryService({ storage: store, clock: () => NOW });
  app = buildApp({ config, storage: store, services: { chat, orchestrator, discovery, seedDemo: async () => ({ eventsIngested: 0 }) } });
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const raw = session.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0]! : String(raw)).split(';')[0]!;
  headers = { cookie, 'x-csrf-token': (session.json() as { csrfToken: string }).csrfToken, origin: ORIGIN };
});

afterEach(async () => {
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Snapshot all application tables as a digest so no session material appears in assertion output. */
function databaseDigest(): string {
  const rows = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  const state = rows.map(({ name }) => [name, store.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]);
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

async function expectDeniedWithoutEffects(
  request: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; payload?: Record<string, unknown> },
  expected: { status?: number; code?: string; forbidden?: string } = {},
) {
  const before = databaseDigest();
  const res = await app.inject(request);
  const after = databaseDigest();
  expect(res.statusCode).toBe(expected.status ?? 403);
  expect(res.json().error.code).toBe(expected.code ?? 'PROJECT_CHAT_UNAVAILABLE');
  expect(res.body).not.toContain(expected.forbidden ?? 'SYNTHETIC_ATLAS_MARKER');
  expect(after).toBe(before);
  expect(reply).not.toHaveBeenCalled();
}

describe('G1-A project-scoped threads and chat fail closed until trusted bindings', () => {
  it('refuses an explicit mismatched project on chat write without touching either thread', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-a', projectId: 'project-beacon', message: 'SYNTHETIC_WRITE' } });
  });

  it('refuses an explicit mismatched project on chat history without returning data', async () => {
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-a&projectId=project-beacon', headers });
  });

  it('does not treat a legacy project id as a trusted binding for chat writes', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-a', projectId: 'project-atlas', message: 'SYNTHETIC_WRITE' } });
  });

  it('does not treat a legacy project id as a trusted binding for chat history', async () => {
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-a&projectId=project-atlas', headers });
  });

  it('does not create a thread or call the adapter for an unknown project-scoped thread', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-unknown', projectId: 'project-atlas', message: 'SYNTHETIC_WRITE' } });
  });

  it.each(['project-atlas', 'project-missing'])('refuses creating project-bound threads for %s', async projectId => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/threads', headers, payload: { projectId, title: 'Synthetic' } });
  });

  it.each([
    '/api/v1/threads?projectId=project-atlas',
    '/api/v1/threads/thread-global?projectId=project-atlas',
    '/api/v1/threads/thread-global/proactive?projectId=project-atlas',
  ])('does not turn a project-scoped thread request into a global read through %s', async url => {
    await expectDeniedWithoutEffects({ method: 'GET', url, headers }, { forbidden: 'SYNTHETIC_GLOBAL_MARKER' });
  });

  it('applies the global filter before pagination', async () => {
    for (let i = 0; i < 105; i++) {
      store.insertThread({ id: `bound-${i}`, title: 'bound', preview: '', projectId: 'project-atlas', proactiveStatus: 'idle', proactiveMessageId: null, createdAt: NOW, updatedAt: '2027-01-01T00:00:00.000Z' });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/threads', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'thread-global' })]));
  });

  it('rejects conflicting thread and session aliases in a chat write', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-global', sessionId: 'thread-a', message: 'SYNTHETIC_WRITE' } }, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('rejects conflicting thread and session aliases in chat history', async () => {
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-global&sessionId=thread-a', headers }, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('rejects unknown chat body fields before any side effects', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-global', message: 'SYNTHETIC_WRITE', extra: true } }, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('withholds legacy project-bound threads from the global thread list', async () => {
    const before = databaseDigest();
    const res = await app.inject({ method: 'GET', url: '/api/v1/threads', headers });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('thread-a');
    expect(res.body).not.toContain('thread-b');
    expect(res.body).not.toContain('SYNTHETIC_ATLAS_MARKER');
    expect(res.body).not.toContain('SYNTHETIC_BEACON_MARKER');
    expect(res.json().threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'thread-global' })]));
    expect(databaseDigest()).toBe(before);
    expect(reply).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/threads/thread-a',
    '/api/v1/threads/thread-a/proactive',
    '/api/v1/chat/history?threadId=thread-a',
  ])('refuses global access to untrusted legacy-bound thread through %s', async url => {
    await expectDeniedWithoutEffects({ method: 'GET', url, headers });
  });

  it('refuses global chat write to an untrusted legacy-bound thread', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-a', message: 'SYNTHETIC_WRITE' } });
  });

  it('does not promote an orphaned chat history into a global thread by writing', async () => {
    await expectDeniedWithoutEffects({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-orphan', message: 'SYNTHETIC_WRITE' } }, { status: 409, code: 'UNBOUND_THREAD_HISTORY', forbidden: 'SYNTHETIC_ORPHAN_MARKER' });
  });

  it('does not return orphaned messages as global history', async () => {
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-orphan', headers }, { status: 409, code: 'UNBOUND_THREAD_HISTORY', forbidden: 'SYNTHETIC_ORPHAN_MARKER' });
  });

  it('retains implicit creation for a fresh global thread with no prior messages', async () => {
    const write = await app.inject({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-fresh', message: 'SYNTHETIC_FRESH' } });
    expect(write.statusCode).toBe(200);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(store.getThread('thread-fresh')?.projectId).toBeNull();
    const history = await app.inject({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-fresh', headers });
    expect(history.statusCode).toBe(200);
    expect(history.body).toContain('SYNTHETIC_FRESH');
    expect(history.body).not.toContain('SYNTHETIC_ORPHAN_MARKER');
  });

  it('retains global chat and history on an unbound thread', async () => {
    const write = await app.inject({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-global', sessionId: 'thread-global', message: 'SYNTHETIC_GLOBAL_NEW' } });
    expect(write.statusCode).toBe(200);
    expect(reply).toHaveBeenCalledTimes(1);
    const history = await app.inject({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-global&sessionId=thread-global', headers });
    expect(history.statusCode).toBe(200);
    expect(history.body).toContain('SYNTHETIC_GLOBAL_NEW');
    expect(history.body).not.toContain('SYNTHETIC_ATLAS_MARKER');
    expect(history.body).not.toContain('SYNTHETIC_BEACON_MARKER');
  });

  it('keeps project requests denied when a global chat is sent concurrently', async () => {
    const beforeA = store.listChat('thread-a');
    const beforeB = store.listChat('thread-b');
    const [denied, global] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-a', projectId: 'project-beacon', message: 'SYNTHETIC_FORGED' } }),
      app.inject({ method: 'POST', url: '/api/v1/chat', headers, payload: { threadId: 'thread-global', message: 'SYNTHETIC_CONCURRENT' } }),
    ]);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PROJECT_CHAT_UNAVAILABLE');
    expect(global.statusCode).toBe(200);
    expect(store.listChat('thread-a')).toEqual(beforeA);
    expect(store.listChat('thread-b')).toEqual(beforeB);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(store.listChat('thread-global').some(message => message.content === 'SYNTHETIC_CONCURRENT')).toBe(true);
  });

  it('continues to withhold legacy project and orphan data after storage restart', async () => {
    const beforeA = store.listChat('thread-a');
    const beforeOrphan = store.listChat('thread-orphan');
    await app.close();
    store.close();
    store = new Storage(path.join(dir, 'synthetic.sqlite'));
    const chat = new MockAgentAdapter();
    reply = vi.spyOn(chat, 'reply');
    const config = loadConfig({ dbPath: path.join(dir, 'synthetic.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null, demoMode: false });
    const orchestrator = new Orchestrator({ storage: store, artifactRoot: path.join(dir, 'artifacts'), clock: () => NOW });
    const discovery = new DiscoveryService({ storage: store, clock: () => NOW });
    app = buildApp({ config, storage: store, services: { chat, orchestrator, discovery, seedDemo: async () => ({ eventsIngested: 0 }) } });
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-a', headers });
    await expectDeniedWithoutEffects({ method: 'GET', url: '/api/v1/chat/history?threadId=thread-orphan', headers }, { status: 409, code: 'UNBOUND_THREAD_HISTORY', forbidden: 'SYNTHETIC_ORPHAN_MARKER' });
    expect(store.listChat('thread-a')).toEqual(beforeA);
    expect(store.listChat('thread-orphan')).toEqual(beforeOrphan);
  });
});
