import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/storage.js';
import { createSyntheticServer } from '../src/fixture-api.js';
import { disabledModelConfig } from '../src/model/config.js';
import { MockModelProvider } from '../src/model/pi-provider.js';
import { createModelService } from '../src/model/service.js';
import { ModelError, type GenerateResult, type ModelConfig, type ModelProvider } from '../src/model/types.js';

const servers: Server[] = []; const dirs: string[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
class CountingProvider implements ModelProvider {
  calls = 0; readonly providerId; readonly modelId; readonly configured = true; readonly unavailableReason = null;
  constructor(private readonly inner: ModelProvider, providerId: 'mock' | 'pi' = 'mock', modelId = 'synthetic-mock') { this.providerId = providerId; this.modelId = modelId; }
  async generate(input: { system: string; user: string }, signal: AbortSignal): Promise<GenerateResult> { this.calls += 1; return this.inner.generate(input, signal); }
}
class ScriptedProvider implements ModelProvider {
  calls = 0; readonly providerId = 'pi' as const; readonly modelId = 'stepfun-plan/step-5-preview'; readonly configured = true; readonly unavailableReason = null;
  constructor(private readonly respond: (signal: AbortSignal) => Promise<string>) {}
  async generate(_input: { system: string; user: string }, signal: AbortSignal): Promise<GenerateResult> { this.calls += 1; return { text: await this.respond(signal), usage: null }; }
}
function config(patch: Partial<ModelConfig> = {}): ModelConfig {
  return { ...disabledModelConfig(null), mode: 'mock', provider: 'mock', model: 'synthetic-mock', reason: null, maxCalls: 4, maxContextChars: 8_000, previewTtlMs: 60_000, ...patch };
}
async function start(provider: ModelProvider, patch?: Partial<ModelConfig>, file?: string) {
  const db = openDatabase(file ?? ':memory:');
  const model = createModelService(db, config(patch), { provider });
  const server = createSyntheticServer(db, { model }); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const base = `http://127.0.0.1:${address.port}`;
  const session = await fetch(`${base}/api/session`); const cookie = session.headers.get('set-cookie')?.split(';')[0] ?? '';
  const token = (await session.json() as { csrfToken: string }).csrfToken;
  const headers = { cookie, origin: base, 'content-type': 'application/json', 'x-hearth-csrf': token };
  const post = (path: string, data: unknown, extra: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie } });
  expect((await post('/api/inventory', {})).status).toBe(200);
  return { db, post, get, base };
}
const previewBody = (question = '这个目标是什么？', requestId = crypto.randomUUID()) => ({ projectId: 'project-a', question, requestId });
async function settled(get: (path: string) => Promise<Response>, runId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const body = await (await get(`/api/model/runs/${runId}?projectId=project-a`)).json() as { state: string; answer: string | null; error: string | null; verified: boolean; unboundEvidenceRefs: string[]; evidence: Array<{ statement?: string }>; withheld: boolean };
    if (body.state !== 'running') return body;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('run did not settle');
}

describe('manual model API', () => {
  it('makes no provider call for status, preview or cancellation, and rejects an unconfigured model', async () => {
    const provider = new CountingProvider(new MockModelProvider());
    const s = await start(provider);
    try {
      expect((await s.get('/api/model/status')).status).toBe(200);
      const preview = await s.post('/api/model/preview', previewBody());
      expect(preview.status).toBe(200); expect(provider.calls).toBe(0);
      const body = await preview.json() as { previewId: string; outbound: { system: string; user: string }; recipient: string };
      expect(body.outbound.user).toContain('书签清单'); expect(body.outbound.user).not.toContain('雨滴'); expect(body.recipient).toContain('Mock');
      expect((await s.post(`/api/model/previews/${body.previewId}/cancel`, { projectId: 'project-a' })).status).toBe(200);
      expect(provider.calls).toBe(0); expect(s.db.prepare('SELECT count(*) AS n FROM model_runs').get()?.n).toBe(0);
      const blocked = createSyntheticServer(s.db); servers.push(blocked); blocked.listen(0, '127.0.0.1'); await once(blocked, 'listening');
      const address = blocked.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
      const base = `http://127.0.0.1:${address.port}`; const session = await fetch(`${base}/api/session`);
      const cookie = session.headers.get('set-cookie')?.split(';')[0] ?? ''; const token = (await session.json() as { csrfToken: string }).csrfToken;
      const denied = await fetch(`${base}/api/model/preview`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', 'x-hearth-csrf': token }, body: JSON.stringify(previewBody()) });
      expect(denied.status).toBe(409); expect(provider.calls).toBe(0);
      expect((await s.post('/api/model/preview', previewBody(), { 'x-hearth-csrf': 'incorrect' })).status).toBe(403);
    } finally { s.db.close(); }
  });
  it('confirms one call, rejects repeats, edits, stale sources and invented evidence', async () => {
    const provider = new CountingProvider(new MockModelProvider());
    const s = await start(provider);
    try {
      const first = await (await s.post('/api/model/preview', previewBody('这个目标是什么？', '11111111-1111-4111-8111-111111111111'))).json() as { previewId: string; conversationId: string };
      const second = await (await s.post('/api/model/preview', { ...previewBody('换一个问题'), conversationId: first.conversationId })).json() as { previewId: string };
      expect((await s.post('/api/model/runs', { projectId: 'project-a', previewId: first.previewId, question: '这个目标是什么？' })).status).toBe(409);
      expect(provider.calls).toBe(0);
      const changed = await s.post('/api/model/runs', { projectId: 'project-a', previewId: second.previewId, question: '不是这个问题' });
      expect(changed.status).toBe(409); expect(provider.calls).toBe(0);
      const again = await (await s.post('/api/model/preview', { projectId: 'project-a', question: '这个目标是什么？', requestId: crypto.randomUUID(), conversationId: first.conversationId })).json() as { previewId: string };
      const [one, two] = await Promise.all([
        s.post('/api/model/runs', { projectId: 'project-a', previewId: again.previewId, question: '这个目标是什么？' }),
        s.post('/api/model/runs', { projectId: 'project-a', previewId: again.previewId, question: '这个目标是什么？' }),
      ]);
      const statuses = [one.status, two.status].sort(); expect(statuses).toEqual([202, 409]);
      const accepted = one.status === 202 ? one : two; const runId = (await accepted.json() as { runId: string }).runId;
      const done = await settled(s.get, runId);
      expect(done.state).toBe('succeeded'); expect(done.verified).toBe(false); expect(done.answer).toContain('合成 Mock 模型回复'); expect(provider.calls).toBe(1);
      expect(s.db.prepare('SELECT count(*) AS n FROM runs').get()?.n).toBe(0);
      expect(JSON.stringify(await (await s.get(`/api/model/projects/project-b/conversation`)).json())).not.toContain('这个目标是什么');
      const saved = await s.post('/api/model/opinions', { projectId: 'project-a', runId, save: true });
      expect(saved.status).toBe(200); expect((await saved.json() as { verified: boolean }).verified).toBe(false);
      expect((await s.post('/api/model/opinions', { projectId: 'project-a', runId, save: true })).status).toBe(200);
      expect(s.db.prepare("SELECT current_revision FROM fixture_opinions WHERE topic_key='synthetic-next-step' AND project_id='project-a'").get()?.current_revision).toBe(1);
      s.db.prepare("UPDATE fixture_sources SET enabled=0 WHERE project_id='project-a'").run();
      const hidden = await (await s.get(`/api/model/runs/${runId}?projectId=project-a`)).json() as { withheld: boolean; answer: string | null };
      expect(hidden.withheld).toBe(true); expect(hidden.answer).toBeNull();
      expect(JSON.stringify(hidden)).not.toContain('书签清单');
      const other = new ScriptedProvider(async () => JSON.stringify({ answer: '编造的回答', uncertainties: ['不确定'], evidenceRefs: [{ id: 'missing-evidence' }], suggestedOpinion: null }));
      const fresh = await start(other);
      const preview = await (await fresh.post('/api/model/preview', previewBody())).json() as { previewId: string };
      const invented = await settled(fresh.get, (await (await fresh.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).json() as { runId: string }).runId);
      expect(invented.unboundEvidenceRefs).toEqual(['missing-evidence']); expect(invented.verified).toBe(false); expect(other.calls).toBe(1);
      fresh.db.close();
    } finally { s.db.close(); }
  });
  it('cancels one running call and does not start another', async () => {
    const provider = new ScriptedProvider(signal => new Promise((_resolve, reject) => {
      if (signal.aborted) { reject(new ModelError('cancelled', '已取消')); return; }
      signal.addEventListener('abort', () => reject(new ModelError('cancelled', '已取消')));
    }));
    const s = await start(provider);
    try {
      const preview = await (await s.post('/api/model/preview', previewBody())).json() as { previewId: string };
      const runId = (await (await s.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).json() as { runId: string }).runId;
      expect((await s.post(`/api/model/runs/${runId}/cancel`, { projectId: 'project-a' })).status).toBe(200);
      expect((await settled(s.get, runId)).state).toBe('cancelled');
      expect((await s.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).status).toBe(409);
      expect(provider.calls).toBe(1); expect(s.db.prepare('SELECT count(*) AS n FROM model_runs').get()?.n).toBe(1);
    } finally { s.db.close(); }
  });
  it('does not fall back to Mock, retry an unknown result, or lose a finished conversation', async () => {
    const failing = new ScriptedProvider(async () => { throw new ModelError('provider_error', '模型 Provider 返回错误'); });
    const failed = await start(failing);
    try {
      const preview = await (await failed.post('/api/model/preview', previewBody())).json() as { previewId: string };
      const runId = (await (await failed.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).json() as { runId: string }).runId;
      const body = await settled(failed.get, runId);
      expect(body.state).toBe('failed'); expect(body.answer).toBeNull(); expect(JSON.stringify(body)).not.toContain('合成 Mock 模型回复'); expect(failing.calls).toBe(1);
    } finally { failed.db.close(); }
    const unknown = new ScriptedProvider(async () => { throw new ModelError('unknown_result', '网络结果未知'); });
    const lost = await start(unknown);
    try {
      const preview = await (await lost.post('/api/model/preview', previewBody())).json() as { previewId: string };
      const confirmed = await lost.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' });
      const runId = (await confirmed.json() as { runId: string }).runId;
      expect((await settled(lost.get, runId)).state).toBe('unknown');
      expect((await lost.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).status).toBe(409);
      expect(unknown.calls).toBe(1);
    } finally { lost.db.close(); }
    const dir = mkdtempSync(join(tmpdir(), 'hark-model-')); dirs.push(dir); const file = join(dir, 'demo.sqlite');
    const provider = new CountingProvider(new MockModelProvider());
    const first = await start(provider, {}, file);
    const preview = await (await first.post('/api/model/preview', previewBody())).json() as { previewId: string; conversationId: string };
    const runId = (await (await first.post('/api/model/runs', { projectId: 'project-a', previewId: preview.previewId, question: '这个目标是什么？' })).json() as { runId: string }).runId;
    expect((await settled(first.get, runId)).state).toBe('succeeded');
    first.db.close();
    const reopened = openDatabase(file); const restored = createModelService(reopened, config(), { provider: new CountingProvider(new MockModelProvider()) });
    const conversation = restored.latestConversation({ principalId: 'demo', projectId: 'project-a', grantId: 'grant-project-a', rootId: 'synthetic-root' });
    expect(JSON.stringify(conversation)).toContain('合成 Mock 模型回复'); expect(conversation.id).toBe(preview.conversationId);
    reopened.close();
  });
});
