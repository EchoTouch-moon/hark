import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/storage.js';
import { appendFixtureFact, registerFixtureSource } from '../src/fixture-chronicle.js';
import { readFixtureOpinion, registerFixtureProject, saveFixtureOpinion } from '../src/fixture-opinion-store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const time = '2026-11-03T12:00:00.000Z';
const scope = { principalId: 'user', projectId: 'A', grantId: 'gA', rootId: 'rootA' };
const project = { id: 'A', name: 'Synthetic A', description: '', state: 'active', createdAt: time };
const fact = { id: 'fact-a', projectId: 'A', sourceId: 'source-a', epoch: 0, observedAt: time, summary: 'synthetic', sensitivity: 'personal', provenance: 'tool_observed', dedupeKey: 'f-a' };

function bundle(version: number, variant: string) {
  const revisionId = `revision-a-${version}-${variant}`;
  const planId = `plan-a-${version}-${variant}`;
  return {
    contractVersion: '1', project,
    opinion: { id: 'opinion-a', projectId: 'A', topicKey: 'next', currentRevision: version, status: 'draft' },
    revision: {
      id: revisionId, opinionId: 'opinion-a', projectId: 'A', version,
      facts: [{ statement: 'synthetic', subject: 'project', source: { kind: 'observer', projectId: 'A', observerSourceId: 'source-a', epoch: 0, eventId: 'fact-a', observedAt: time, quality: 'observed' } }],
      inferences: [], counterEvidence: [], counterEvidenceLimitation: 'none found', uncertainties: ['unknown'],
      opinion: `candidate ${variant}`, whyNow: 'fixture', alternatives: [], changeMyMindWhen: ['new evidence'], proposedPlanId: planId, createdAt: time,
    },
    plan: { id: planId, projectId: 'A', revisionId, versionHash: 'a'.repeat(64), steps: ['review'], risks: [], validation: ['check'], executable: false },
    feedback: [],
  };
}

// The workers load freshly compiled production modules, not a copy of the CAS logic.
const workerScript = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
(async () => {
  let db;
  try {
    const storage = await import(pathToFileURL(workerData.storagePath).href);
    const opinions = await import(pathToFileURL(workerData.opinionPath).href);
    db = storage.openDatabase(workerData.databasePath);
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: 'ready' });
    Atomics.wait(gate, 0, 0, 20000);
    if (Atomics.load(gate, 0) !== 1) throw new Error('Start barrier timed out');
    try {
      const version = opinions.saveFixtureOpinion(db, workerData.scope, workerData.bundle, 1, workerData.reason);
      parentPort.postMessage({ type: 'result', kind: 'success', version, actor: workerData.actor });
    } catch (error) {
      parentPort.postMessage({ type: 'result', kind: 'failure', message: error instanceof Error ? error.message : String(error), actor: workerData.actor });
    }
  } catch (error) {
    parentPort.postMessage({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (db) db.close();
  }
})();`;

type WorkerMessage = { type: 'ready' } | { type: 'fatal'; message: string } |
  { type: 'result'; kind: 'success'; version: number; actor: string } |
  { type: 'result'; kind: 'failure'; message: string; actor: string };
type Result = Extract<WorkerMessage, { type: 'result' }>;

function startWorker(databasePath: string, gate: SharedArrayBuffer, actor: string) {
  const worker = new Worker(workerScript, {
    eval: true,
    execArgv: [],
    workerData: {
      storagePath: join(root, 'dist', 'storage.js'), opinionPath: join(root, 'dist', 'fixture-opinion-store.js'),
      databasePath, gate, actor, scope, bundle: bundle(2, actor), reason: `Synthetic change ${actor}`,
    },
  });
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let resultResolve!: (result: Result) => void, resultReject!: (error: Error) => void;
  let exitResolve!: (code: number) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<Result>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const exited = new Promise<number>(resolve => { exitResolve = resolve; });
  // Attach handlers immediately even if a worker fails before both are ready.
  void ready.catch(() => {});
  void result.catch(() => {});
  let hasResult = false;
  worker.on('message', (message: WorkerMessage) => {
    if (message.type === 'ready') readyResolve();
    else if (message.type === 'result') { hasResult = true; resultResolve(message); }
    else { const error = new Error(message.message); readyReject(error); resultReject(error); }
  });
  worker.on('error', error => { readyReject(error); resultReject(error); });
  worker.on('exit', code => {
    exitResolve(code);
    if (!hasResult) {
      const error = new Error(`Worker exited before result: ${code}`);
      readyReject(error); resultReject(error);
    }
  });
  return { worker, ready, result, exited };
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker test timed out')), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

it('allows exactly one concurrent fixture revision for the same expected version', async () => {
  // Always build from the working source for the workers; no previous dist is trusted.
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], { cwd: root, timeout: 20000, stdio: 'pipe' });
  const dir = mkdtempSync(join(tmpdir(), 'hearth-concurrent-'));
  const databasePath = join(dir, 'synthetic.sqlite');
  const workers: Worker[] = [];
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase(databasePath);
    db.exec(`INSERT INTO projects VALUES ('A','Synthetic A','');
      INSERT INTO observation_grants VALUES ('gA','user','A','rootA',1,0,'2099-01-01T00:00:00Z',NULL);`);
    registerFixtureProject(db, scope, project);
    registerFixtureSource(db, scope, 'source-a');
    appendFixtureFact(db, scope, fact);
    expect(saveFixtureOpinion(db, scope, bundle(1, 'initial'), 0)).toBe(1);
    db.close(); db = undefined;

    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = startWorker(databasePath, gate, 'first');
    const second = startWorker(databasePath, gate, 'second');
    workers.push(first.worker, second.worker);
    await bounded(Promise.all([first.ready, second.ready]), 15000);
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0, 2);
    const results = await bounded(Promise.all([first.result, second.result]), 15000);
    const successes = results.filter((result): result is Extract<Result, { kind: 'success' }> => result.kind === 'success');
    const failures = results.filter((result): result is Extract<Result, { kind: 'failure' }> => result.kind === 'failure');
    expect(successes).toHaveLength(1);
    expect(successes[0]?.version).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/Revision conflict/);

    // Wait for each worker's finally block to close its DB before reopening.
    expect(await bounded(Promise.all([first.exited, second.exited]), 15000)).toEqual([0, 0]);
    workers.length = 0;
    db = openDatabase(databasePath);
    expect(db.prepare("SELECT current_revision FROM fixture_opinions WHERE id='opinion-a'").get()?.current_revision).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_opinion_plans').get()?.n).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM fixture_opinion_revisions r
      LEFT JOIN fixture_opinion_plans p ON p.revision_id=r.id AND p.project_id=r.project_id WHERE p.id IS NULL`).get()?.n).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM fixture_opinion_plans p
      LEFT JOIN fixture_opinion_revisions r ON p.revision_id=r.id AND p.project_id=r.project_id WHERE r.id IS NULL`).get()?.n).toBe(0);
    const result = readFixtureOpinion(db, scope, 'opinion-a', 2);
    expect(result?.revision.id).toBe(`revision-a-2-${successes[0]?.actor}`);
    expect(result?.plan.id).toBe(`plan-a-2-${successes[0]?.actor}`);
    expect(result?.change).toEqual({ previousRevisionId: 'revision-a-1-initial', reason: `Synthetic change ${successes[0]?.actor}` });
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)?.revision.id).toBe('revision-a-1-initial');
  } finally {
    await Promise.allSettled(workers.map(worker => worker.terminate()));
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 45000);
