import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ActionSpec, Event, Sensitivity } from '@hearth/contracts';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';

const NOW = '2026-10-28T12:00:00+08:00';
const ORIGIN = 'http://127.0.0.1:4317';
let dir: string;
let store: Storage;
let app: FastifyInstance;
let cookie: string;

function event(id: string, sensitivity: Sensitivity, projectId = 'project-a', payloadRef?: string): Event {
  return {
    id, type: 'repo.ci_failed', projectId,
    source: { sourceType: 'fixture', uri: `fixture://synthetic/${id}`, sourceId: id, observedAt: NOW },
    occurredAt: NOW, observedAt: NOW, summary: `synthetic event ${id}`,
    dedupeKey: `dedupe:${id}`, sensitivity, provenance: 'tool_observed', tags: ['ci'],
    ...(payloadRef === undefined ? {} : { payloadRef }),
  };
}

const events: Event[] = [
  event('restricted', 'restricted', 'project-a', 'fixture://synthetic/restricted-reference'),
  event('public', 'public', 'project-a', 'fixture://synthetic/public-reference'),
  event('personal', 'personal', 'project-a', 'fixture://synthetic/personal-reference'),
  event('no-ref', 'restricted'),
  event('other-project', 'restricted', 'project-b', 'fixture://synthetic/other-reference'),
];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-event-projection-'));
  store = new Storage(path.join(dir, 'test.sqlite'));
  store.seedProjects([
    { id: 'project-a', name: 'Project A', description: 'synthetic' },
    { id: 'project-b', name: 'Project B', description: 'synthetic' },
  ]);
  for (const item of events) store.ingestEvent(item);
  const action: ActionSpec = {
    id: 'action-a', actionType: 'report.generate', projectId: 'project-a',
    target: { resourceId: 'synthetic', path: 'report/synthetic.json' }, params: {},
    allowedCapabilities: ['fs.write_demo_artifact'], risk: 'L1', effect: 'local_create',
    maxSteps: 8, timeoutMs: 30_000, maxCostUsd: 0, idempotencyKey: 'a'.repeat(64),
    verification: { kind: 'artifact_sha256', artifactPath: 'report/synthetic.json' },
  };
  const evidence = [{ sourceType: 'fixture' as const, uri: 'fixture://synthetic/source', sourceId: 'source-a', observedAt: NOW }];
  store.upsertCandidate({
    id: 'candidate-a', projectId: 'project-a', eventIds: ['restricted', 'public', 'personal', 'no-ref', 'missing-event'],
    title: 'Synthetic card', whyNow: 'Synthetic fixture', evidence, suggestedAction: action,
    score: 0.9, confidence: 0.9, risk: 'L1', expiresAt: '2026-10-29T12:00:00+08:00',
    suppressionKey: 'synthetic-key', status: 'proposed',
  });
  store.insertCard({
    id: 'card-a', candidateId: 'candidate-a', projectId: 'project-a', title: 'Synthetic card',
    whyNow: 'Synthetic fixture', evidence, action, createdAt: NOW,
    expiresAt: '2026-10-29T12:00:00+08:00', status: 'proposed',
  });
  const config = loadConfig({ demoMode: false, dbPath: path.join(dir, 'test.sqlite'), artifactRoot: path.join(dir, 'artifacts'), staticDir: null });
  app = buildApp({ config, storage: store, services: {
    discovery: new DiscoveryService({ storage: store, clock: () => NOW }),
    orchestrator: new Orchestrator({ storage: store, artifactRoot: config.artifactRoot, clock: () => NOW }),
    chat: new MockAgentAdapter(), seedDemo: async () => ({ eventsIngested: 0 }),
  } });
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const header = session.headers['set-cookie'];
  cookie = (Array.isArray(header) ? header[0]! : String(header)).split(';')[0]!;
});

afterEach(async () => {
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('restricted payloadRef response projection', () => {
  it.each([
    '/api/v1/events?projectId=project-a',
    '/api/v1/projects/project-a',
    '/api/v1/cards/card-a',
  ])('redacts only restricted payloadRef through %s without changing storage', async url => {
    const result = await app.inject({ method: 'GET', url, headers: { cookie, origin: ORIGIN } });
    expect(result.statusCode).toBe(200);
    const body = result.json() as { events: Array<Record<string, unknown>> };
    expect(body.events).toHaveLength(4);
    expect(body.events.map(item => item.id).sort()).toEqual(['no-ref', 'personal', 'public', 'restricted']);
    for (const expected of events.filter(item => item.projectId === 'project-a')) {
      const actual = body.events.find(item => item.id === expected.id);
      expect(actual).toBeDefined();
      const { payloadRef, ...otherFields } = expected;
      expect(actual).toMatchObject(otherFields);
      if (expected.sensitivity === 'restricted' || payloadRef === undefined) {
        expect(actual).not.toHaveProperty('payloadRef');
      } else {
        expect(actual).toHaveProperty('payloadRef', payloadRef);
      }
      expect(store.getEvent(expected.id)).toEqual(expected);
    }
    expect(JSON.stringify(body)).not.toContain('fixture://synthetic/restricted-reference');
    expect(JSON.stringify(body)).not.toContain('fixture://synthetic/other-reference');
    expect(store.getEvent('other-project')).toEqual(events[4]);
  });
});
