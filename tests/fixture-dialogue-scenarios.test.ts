import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { advanceFixtureEpoch } from '../src/fixture-chronicle.js';
import { ensureSyntheticOpinion, challengeSyntheticOpinion, readSyntheticOpinion, answerSyntheticQuestion } from '../src/fixture-dialogue.js';
import { readFixtureOpinion } from '../src/fixture-opinion-store.js';
import { ingestSyntheticUnderstanding } from '../src/fixture-understanding.js';
import { openDatabase } from '../src/storage.js';

const scopeA = { principalId: 'demo', projectId: 'project-a', grantId: 'grant-a', rootId: 'synthetic-root' };
const scopeB = { principalId: 'demo', projectId: 'project-b', grantId: 'grant-b', rootId: 'synthetic-root' };
const challenge = { requestId: 'question-1', reason: '请更谨慎地表达这个建议', createdAt: '2026-11-04T02:00:00.000Z' };
const dirs: string[] = [];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-dialogue-scenario-')); dirs.push(dir);
  const path = join(dir, 'demo.sqlite'); const db = openDatabase(path);
  db.exec(`INSERT INTO projects VALUES ('project-a','星光书签','synthetic'), ('project-b','雨滴记录','synthetic');
    INSERT INTO observation_grants VALUES
      ('grant-a','demo','project-a','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL),
      ('grant-b','demo','project-b','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL);
    INSERT INTO fixture_project_profiles VALUES
      ('project-a','active','2026-11-04T00:00:00Z'), ('project-b','active','2026-11-04T00:00:00Z');`);
  return { db, path };
}

describe('synthetic dialogue user scenarios', () => {
  it('preserves the source-backed first version and records feedback without turning it into a fact', () => {
    const { db } = setup();
    try {
      ingestSyntheticUnderstanding(db, scopeA);
      const before = db.prepare('SELECT count(*) AS n FROM fixture_opinions').get()?.n;
      expect(readSyntheticOpinion(db, scopeA)).toBeNull();
      expect(db.prepare('SELECT count(*) AS n FROM fixture_opinions').get()?.n).toBe(before);
      const initial = ensureSyntheticOpinion(db, scopeA);
      expect(initial).not.toBeNull();
      if (!initial) throw new Error('Expected a grounded first opinion');
      expect(initial.revision.version).toBe(1);
      expect(initial.revision.facts.length).toBeGreaterThan(0);
      expect(initial.revision.facts.every(item => item.source.projectId === 'project-a')).toBe(true);
      expect(answerSyntheticQuestion(db, scopeA, '依据是什么？')).toMatchObject({ synthetic: true, mode: 'mock', facts: initial.revision.facts });
      const pair = challengeSyntheticOpinion(db, scopeA, challenge);
      if (!pair.previous) throw new Error('Expected the previous opinion');
      expect(pair.previous.revision.id).toBe(initial.revision.id);
      expect(pair.current.revision.version).toBe(2);
      expect(pair.current.change?.previousRevisionId).toBe(initial.revision.id);
      expect(pair.current.change?.reason).toContain(challenge.reason);
      expect(pair.current.revision.facts).toEqual(initial.revision.facts);
      expect(pair.current.revision.facts.some(item => item.statement === challenge.reason)).toBe(false);
      const old = readFixtureOpinion(db, scopeA, initial.revision.opinionId, 1);
      expect(old?.revision).toEqual(initial.revision);
      expect(old?.feedback).toEqual(expect.arrayContaining([expect.objectContaining({ choice: 'challenge', reason: challenge.reason })]));
      expect(ensureSyntheticOpinion(db, scopeA)?.revision.id).toBe(pair.current.revision.id);
      expect(readSyntheticOpinion(db, scopeA)?.revision.id).toBe(pair.current.revision.id);
    } finally { db.close(); }
  });

  it('replays a request only once and restores both versions after restart', () => {
    const fixture = setup(); let db = fixture.db;
    try {
      ingestSyntheticUnderstanding(db, scopeA);
      const first = ensureSyntheticOpinion(db, scopeA);
      expect(first).not.toBeNull();
      const result = challengeSyntheticOpinion(db, scopeA, challenge);
      const repeated = challengeSyntheticOpinion(db, scopeA, challenge);
      if (!result.previous || !repeated.previous) throw new Error('Expected the previous opinion');
      expect(repeated.current.revision.id).toBe(result.current.revision.id);
      expect(repeated.previous.revision.id).toBe(result.previous.revision.id);
      expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(2);
      expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(1);
      expect(() => challengeSyntheticOpinion(db, scopeA, { ...challenge, reason: '不同的内容' })).toThrow();
      db.close(); db = openDatabase(fixture.path);
      expect(ensureSyntheticOpinion(db, scopeA)?.revision.id).toBe(result.current.revision.id);
      const old = readFixtureOpinion(db, scopeA, result.previous.revision.opinionId, 1);
      expect(old?.revision.id).toBe(result.previous.revision.id);
      expect(old?.feedback).toEqual(expect.arrayContaining([expect.objectContaining({ reason: challenge.reason })]));
      expect(challengeSyntheticOpinion(db, scopeA, challenge).current.revision.id).toBe(result.current.revision.id);
    } finally { db.close(); }
  });

  it('refuses stale or revoked sources without creating feedback or a revision', () => {
    const fixture = setup(); let db = fixture.db;
    try {
      ingestSyntheticUnderstanding(db, scopeA);
      expect(ensureSyntheticOpinion(db, scopeA)).not.toBeNull();
      advanceFixtureEpoch(db, scopeA, 'source-project-a-1');
      expect(ensureSyntheticOpinion(db, scopeA)).toBeNull();
      expect(() => challengeSyntheticOpinion(db, scopeA, challenge)).toThrow();
      expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(1);
      expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(0);
      db.exec("UPDATE observation_grants SET revoked_at='2026-11-04T00:00:00Z', enabled=0 WHERE id='grant-a'");
      db.close(); db = openDatabase(fixture.path);
      expect(ensureSyntheticOpinion(db, scopeA)).toBeNull();
      expect(() => challengeSyntheticOpinion(db, scopeA, challenge)).toThrow();
    } finally { db.close(); }
  });

  it('keeps two project opinions and feedback separate and rejects forged cross-project scope', () => {
    const { db } = setup();
    try {
      ingestSyntheticUnderstanding(db, scopeA); ingestSyntheticUnderstanding(db, scopeB);
      const a = ensureSyntheticOpinion(db, scopeA), b = ensureSyntheticOpinion(db, scopeB);
      expect(a?.revision.projectId).toBe('project-a'); expect(b?.revision.projectId).toBe('project-b');
      expect(a?.revision.id).not.toBe(b?.revision.id);
      challengeSyntheticOpinion(db, scopeA, challenge);
      expect(ensureSyntheticOpinion(db, scopeB)?.revision.version).toBe(1);
      expect(ensureSyntheticOpinion(db, { ...scopeA, projectId: 'project-b' })).toBeNull();
      expect(() => challengeSyntheticOpinion(db, { ...scopeA, projectId: 'project-b' }, challenge)).toThrow();
      expect(b && readFixtureOpinion(db, scopeA, b.revision.opinionId, 1)).toBeNull();
      expect(db.prepare("SELECT count(*) AS n FROM fixture_opinion_feedback WHERE project_id='project-b'").get()?.n).toBe(0);
    } finally { db.close(); }
  });
});

// Both workers load compiled production code and share only this disposable DB.
const workerScript = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
(async () => {
  let db;
  try {
    const storage = await import(pathToFileURL(workerData.storagePath).href);
    const dialogue = await import(pathToFileURL(workerData.dialoguePath).href);
    db = storage.openDatabase(workerData.path);
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: 'ready' });
    Atomics.wait(gate, 0, 0, 20000);
    if (Atomics.load(gate, 0) !== 1) throw new Error('Start barrier timed out');
    try {
      const value = dialogue.challengeSyntheticOpinion(db, workerData.scope, workerData.challenge);
      parentPort.postMessage({ type: 'result', kind: 'success', actor: workerData.actor, version: value.current.revision.version });
    } catch (error) {
      parentPort.postMessage({ type: 'result', kind: 'failure', actor: workerData.actor, message: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    parentPort.postMessage({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
  } finally { if (db) db.close(); }
})();`;

type WorkerMessage = { type: 'ready' } | { type: 'fatal'; message: string } |
  { type: 'result'; kind: 'success'; actor: string; version: number } |
  { type: 'result'; kind: 'failure'; actor: string; message: string };
type WorkerResult = Extract<WorkerMessage, { type: 'result' }>;
function startDialogueWorker(path: string, gate: SharedArrayBuffer, actor: string) {
  const worker = new Worker(workerScript, { eval: true, execArgv: [], workerData: {
    storagePath: join(root, 'dist', 'storage.js'), dialoguePath: join(root, 'dist', 'fixture-dialogue.js'),
    path, gate, actor, scope: scopeA,
    challenge: { requestId: `request-${actor}`, reason: `合成反馈 ${actor}`, createdAt: challenge.createdAt, expectedVersion: 1 },
  } });
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let resultResolve!: (result: WorkerResult) => void, resultReject!: (error: Error) => void;
  let exitResolve!: (code: number) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<WorkerResult>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const exited = new Promise<number>(resolve => { exitResolve = resolve; });
  void ready.catch(() => {}); void result.catch(() => {});
  let hasResult = false;
  worker.on('message', (message: WorkerMessage) => {
    if (message.type === 'ready') readyResolve();
    else if (message.type === 'result') { hasResult = true; resultResolve(message); }
    else { const error = new Error(message.message); readyReject(error); resultReject(error); }
  });
  worker.on('error', error => { readyReject(error); resultReject(error); });
  worker.on('exit', code => { exitResolve(code); if (!hasResult) { const error = new Error(`Worker exited before result: ${code}`); readyReject(error); resultReject(error); } });
  return { worker, ready, result, exited };
}
async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker test timed out')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

it('keeps one v2 and records both feedback items when two workers challenge the same v1', async () => {
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], { cwd: root, timeout: 20000, stdio: 'pipe' });
  const fixture = setup(); let db = fixture.db;
  const workers: Worker[] = [];
  try {
    ingestSyntheticUnderstanding(db, scopeA);
    expect(ensureSyntheticOpinion(db, scopeA)?.revision.version).toBe(1);
    db.close();
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = startDialogueWorker(fixture.path, gate, 'first'), second = startDialogueWorker(fixture.path, gate, 'second');
    workers.push(first.worker, second.worker);
    await bounded(Promise.all([first.ready, second.ready]), 15000);
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, 2);
    const results = await bounded(Promise.all([first.result, second.result]), 15000);
    const successes = results.filter((value): value is Extract<WorkerResult, { kind: 'success' }> => value.kind === 'success');
    const failures = results.filter((value): value is Extract<WorkerResult, { kind: 'failure' }> => value.kind === 'failure');
    expect(successes).toHaveLength(1); expect(successes[0]?.version).toBe(2);
    expect(failures).toHaveLength(1); expect(failures[0]?.message).toMatch(/Revision conflict/);
    console.log('Synthetic worker results:', JSON.stringify(results));
    expect(await bounded(Promise.all([first.exited, second.exited]), 15000)).toEqual([0, 0]);
    workers.length = 0; db = openDatabase(fixture.path);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_revisions WHERE version=2').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(2);
    const previous = readFixtureOpinion(db, scopeA, 'opinion-project-a', 1);
    expect(previous?.feedback.map(item => item.reason).sort()).toEqual(['合成反馈 first', '合成反馈 second']);
    const current = readFixtureOpinion(db, scopeA, 'opinion-project-a', 2);
    expect(current?.change?.reason).toContain(`合成反馈 ${successes[0]?.actor}`);
    expect(current?.revision.facts).toEqual(previous?.revision.facts);
  } finally {
    await Promise.allSettled(workers.map(worker => worker.terminate()));
    if (db.isOpen) db.close();
  }
}, 45000);
