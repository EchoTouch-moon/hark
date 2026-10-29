/**
 * P0.5 performance harness (H05 / PF-01..05).
 *
 * Covers four measured scenarios, each >= 30 samples after warmup:
 *   1. first full scan (new DB + register)
 *   2. unchanged reconcile
 *   3. changed worktree scan
 *   4. burst of 300 watcher hints then one scan
 * Plus: 30 min idle RSS/CPU/WAL, 1000 unchanged + 100 changed DB growth,
 * and TIMEOUT / OUTPUT_LIMIT / REPORT_TOO_LARGE isolation.
 */
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ProjectObserver } from '../packages/project-observer/src/observer.ts';
import { createGitRunner } from '../packages/project-observer/src/git/run.ts';
import { ObserverError } from '../packages/project-observer/src/errors.ts';
import { createGitRepo, git } from '../packages/project-observer/src/testkit/git-fixture.ts';

const execFileAsync = promisify(execFile);
const WARMUP = 3;
const BURST_HINTS = 300;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
}

function stats(samples: number[]): { n: number; p50: number; p95: number; max: number } {
  return {
    n: samples.length,
    p50: Math.round(percentile(samples, 50) * 100) / 100,
    p95: Math.round(percentile(samples, 95) * 100) / 100,
    max: Math.round(Math.max(0, ...samples) * 100) / 100,
  };
}

async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

function dbFootprint(dbPath: string): { sqlite: number; wal: number; shm: number; total: number } {
  const sizeOf = (p: string): number => (existsSync(p) ? statSync(p).size : 0);
  const sqlite = sizeOf(dbPath);
  const wal = sizeOf(`${dbPath}-wal`);
  const shm = sizeOf(`${dbPath}-shm`);
  return { sqlite, wal, shm, total: sqlite + wal + shm };
}

async function createSizedRepo(parent: string, name: string, files: number): Promise<string> {
  const root = await createGitRepo(parent, name, { files: { 'README.md': `# ${name}\n` } });
  const buckets = new Set<string>();
  for (let i = 0; i < files; i += 1) {
    buckets.add(path.join(root, `src/b${Math.floor(i / 200)}`));
  }
  for (const bucket of buckets) mkdirSync(bucket, { recursive: true });
  for (let i = 0; i < files; i += 1) {
    writeFileSync(path.join(root, `src/b${Math.floor(i / 200)}/f${i}.txt`), `file ${i}\n`);
  }
  await git(root, ['add', '-A']);
  await git(root, [
    '-c',
    'user.email=observer@test.local',
    '-c',
    'user.name=Observer Test',
    'commit',
    '-m',
    `add ${files} files`,
  ]);
  const tracked = (await git(root, ['ls-files'])).trim().split('\n').filter(Boolean).length;
  if (tracked < files) {
    throw new Error(`expected >= ${files} tracked files, got ${tracked}`);
  }
  return root;
}

async function firstScanMs(work: string, root: string, name: string): Promise<number> {
  const dbPath = path.join(work, `first-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const observer = new ProjectObserver({ dbPath, watchEnabled: false });
  try {
    return await timed(async () => {
      await observer.registerProject(root, { name });
    });
  } finally {
    await observer.stop();
    observer.close();
  }
}

async function main(): Promise<void> {
  const idleMs = Number(process.env['OBSERVER_BENCH_IDLE_MS'] ?? 1_800_000);
  const iterations = Number(process.env['OBSERVER_BENCH_ITERS'] ?? 30);
  if (iterations < 30) {
    console.error(`PF coverage requires >= 30 samples per scenario; got ITERS=${iterations}`);
  }
  const outDir = process.env['OBSERVER_BENCH_OUT'] ?? path.join('docs', 'verification', 'data');
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(path.join(os.tmpdir(), 'obs-bench-'));

  const probe = new ProjectObserver({ dbPath: path.join(work, 'probe.sqlite'), watchEnabled: false });
  const sqliteVersion = { v: probe.store.sqliteVersion(), journal: probe.store.journalMode() };
  probe.close();

  const machine = {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    git: String((await execFileAsync('git', ['--version'])).stdout).trim(),
    sqlite: sqliteVersion.v,
    journalMode: sqliteVersion.journal,
    cwdRedacted: '<repo>/hark',
    fs: 'apfs-or-local',
  };

  const sizes = [
    { name: 'small', files: 200 },
    { name: 'medium', files: 2000 },
    { name: 'large-synthetic', files: 10_000 },
  ];

  const coverage = {
    warmup: WARMUP,
    iterationsRequested: iterations,
    burstHintsPerTrial: BURST_HINTS,
    idleMsRequested: idleMs,
    dbGrowthUnchanged: 1000,
    dbGrowthChanged: 100,
    scenarios: ['first-full-scan', 'unchanged-reconcile', 'changed-scan', 'burst-hints'],
  };

  const results: Record<string, unknown> = {
    machine,
    coverage,
    rssStartMb: rssMb(),
    suites: [],
    priorBaseline: 'NO_PRIOR_BASELINE',
  };

  try {
    for (const size of sizes) {
      const root = await createSizedRepo(work, size.name, size.files);
      const tracked = (await git(root, ['ls-files'])).trim().split('\n').filter(Boolean).length;
      for (let w = 0; w < WARMUP; w += 1) await firstScanMs(work, root, `${size.name}-warmup`);
      const first: number[] = [];
      for (let i = 0; i < iterations; i += 1) first.push(await firstScanMs(work, root, size.name));

      const dbPath = path.join(work, `${size.name}.sqlite`);
      const observer = new ProjectObserver({ dbPath, watchEnabled: false, debounceMs: 200 });
      await observer.registerProject(root, { name: size.name });
      const id = observer.listProjects()[0]!.id;
      for (let w = 0; w < WARMUP; w += 1) await observer.scanProject(id, 'reconcile');
      const unchanged: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        unchanged.push(await timed(async () => {
          await observer.scanProject(id, 'reconcile');
        }));
      }
      const changed: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        await writeFile(path.join(root, `chg-${i}.txt`), `c${i}\n`);
        changed.push(await timed(async () => {
          await observer.scanProject(id, 'manual');
        }));
      }
      const burst: number[] = [];
      for (let trial = 0; trial < iterations; trial += 1) {
        burst.push(
          await timed(async () => {
            for (let i = 0; i < BURST_HINTS; i += 1) observer.hintDirty(id, `chg-${i % 10}.txt`);
            await observer.scanProject(id, 'watch');
          }),
        );
      }
      (results.suites as unknown[]).push({
        name: size.name,
        trackedFiles: tracked,
        requestedFiles: size.files,
        firstScanMs: stats(first),
        unchangedMs: stats(unchanged),
        changedMs: stats(changed),
        burstHintsMs: stats(burst),
        burstHintsPerTrial: BURST_HINTS,
        gitScans: observer.scanStats(),
      });
      await observer.stop();
      observer.close();
    }

    const growthRoot = await createSizedRepo(work, 'growth', 400);
    const growthDb = path.join(work, 'growth.sqlite');
    const growth = new ProjectObserver({ dbPath: growthDb, watchEnabled: false });
    await growth.registerProject(growthRoot, { name: 'growth' });
    const gid = growth.listProjects()[0]!.id;
    const eventsBeforeUnchanged = growth.store.countEvents(gid);
    const footprintBeforeUnchanged = dbFootprint(growthDb);
    for (let i = 0; i < 1000; i += 1) await growth.scanProject(gid, 'reconcile');
    const eventsAfterUnchanged = growth.store.countEvents(gid);
    const footprintAfterUnchanged = dbFootprint(growthDb);
    const footprintBeforeChanged = dbFootprint(growthDb);
    for (let i = 0; i < 100; i += 1) {
      await writeFile(path.join(growthRoot, `grow-${i}.txt`), `g${i}\n`);
      await growth.scanProject(gid, 'manual');
    }
    const eventsAfterChanged = growth.store.countEvents(gid);
    const footprintAfterChanged = dbFootprint(growthDb);
    results.dbGrowth = {
      unchanged1000: {
        eventDelta: eventsAfterUnchanged - eventsBeforeUnchanged,
        before: footprintBeforeUnchanged,
        after: footprintAfterUnchanged,
      },
      changed100: {
        eventDelta: eventsAfterChanged - eventsAfterUnchanged,
        before: footprintBeforeChanged,
        after: footprintAfterChanged,
      },
    };
    await growth.stop();
    growth.close();

    const limitRoot = await createGitRepo(work, 'limit-ok', { files: { 'README.md': '# ok\n' } });
    const limitPeer = await createGitRepo(work, 'limit-peer', { files: { 'README.md': '# peer\n' } });
    const timeoutObs = new ProjectObserver({
      dbPath: path.join(work, 'limit-timeout.sqlite'),
      watchEnabled: false,
      gitRunner: async () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new ObserverError('GIT_TIMEOUT', 'git timed out after 40ms')), 40);
        }),
    });
    let timeoutCode = 'NONE';
    try {
      await timeoutObs.registerProject(limitRoot);
    } catch (cause) {
      timeoutCode = cause instanceof ObserverError ? cause.code : 'UNKNOWN';
    }
    const timeoutPeer = new ProjectObserver({
      dbPath: path.join(work, 'limit-peer.sqlite'),
      watchEnabled: false,
    });
    const peer = await timeoutPeer.registerProject(limitPeer);
    const outputObs = new ProjectObserver({
      dbPath: path.join(work, 'limit-output.sqlite'),
      watchEnabled: false,
      gitRunner: async (args, options) => createGitRunner()(args, { ...options, maxOutputBytes: 32 }),
    });
    let outputCode = 'NONE';
    try {
      await outputObs.registerProject(limitRoot);
    } catch (cause) {
      outputCode = cause instanceof ObserverError ? cause.code : 'UNKNOWN';
    }
    await mkdir(path.join(limitPeer, 'reports'), { recursive: true });
    await writeFile(path.join(limitPeer, 'reports/junit.xml'), 'x'.repeat(64 * 1024));
    const reportObs = new ProjectObserver({
      dbPath: path.join(work, 'limit-report.sqlite'),
      watchEnabled: false,
      maxReportBytes: 1024,
    });
    const reportProject = await reportObs.registerProject(limitPeer, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const reportRun = await reportObs.scanProject(reportProject.id, 'manual');
    results.resourceLimits = {
      gitTimeout: { code: timeoutCode, siblingCollection: timeoutPeer.getObserverHealth(peer.id).collectionStatus },
      outputLimit: { code: outputCode },
      reportTooLarge: { runErrorCode: reportRun.errorCode, testResult: reportObs.getLatestSnapshot(reportProject.id)?.test.result },
    };
    await timeoutObs.stop();
    timeoutObs.close();
    await timeoutPeer.stop();
    timeoutPeer.close();
    await outputObs.stop();
    outputObs.close();
    await reportObs.stop();
    reportObs.close();

    const idle: Array<{ t: number; rssMb: number; heapMb: number; cpuUserMs: number; cpuSystemMs: number; db: ReturnType<typeof dbFootprint> }> = [];
    const idleDb = path.join(work, 'idle.sqlite');
    const idleObserver = new ProjectObserver({
      dbPath: idleDb,
      watchEnabled: true,
      reconcileIntervalMs: 60_000,
    });
    const idleRoot = await createSizedRepo(work, 'idle', 200);
    await idleObserver.registerProject(idleRoot, { name: 'idle' });
    await idleObserver.start();
    const idleCpu0 = process.cpuUsage();
    const idleStart = Date.now();
    const sampleIdle = (): void => {
      const cpu = process.cpuUsage(idleCpu0);
      idle.push({
        t: Date.now() - idleStart,
        rssMb: rssMb(),
        heapMb: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100,
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        db: dbFootprint(idleDb),
      });
    };
    sampleIdle();
    while (Date.now() - idleStart < idleMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, idleMs)));
      sampleIdle();
    }
    const idleCpu = process.cpuUsage(idleCpu0);
    const idleWallMs = Date.now() - idleStart;
    await idleObserver.stop();
    idleObserver.close();
    results.idle = {
      durationMs: idleWallMs,
      requestedMs: idleMs,
      samples: idle,
      rssPeakMb: Math.max(...idle.map((s) => s.rssMb)),
      cpuUserMs: Math.round(idleCpu.user / 1000),
      cpuSystemMs: Math.round(idleCpu.system / 1000),
      cpuMeanPctThisProcess: Math.round(((idleCpu.user + idleCpu.system) / 1000 / idleWallMs) * 10000) / 100,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `observer-p05-bench-${stamp}.json`);
  await writeFile(outFile, JSON.stringify(results, null, 2));
  const csvLines = ['suite,scenario,n,p50_ms,p95_ms,max_ms'];
  for (const suite of results.suites as Array<Record<string, { n: number; p50: number; p95: number; max: number } | unknown>>) {
    for (const scenario of ['firstScanMs', 'unchangedMs', 'changedMs', 'burstHintsMs'] as const) {
      const s = suite[scenario] as { n: number; p50: number; p95: number; max: number };
      csvLines.push(`${suite['name']},${scenario},${s.n},${s.p50},${s.p95},${s.max}`);
    }
  }
  const csvFile = path.join(outDir, `observer-p05-bench-${stamp}.csv`);
  await writeFile(csvFile, `${csvLines.join('\n')}\n`);
  console.log(JSON.stringify({ outFile, csvFile, rssEndMb: rssMb(), coverage, idle: results.idle, dbGrowth: results.dbGrowth, resourceLimits: results.resourceLimits, suites: results.suites }, null, 2));
}

await main();
