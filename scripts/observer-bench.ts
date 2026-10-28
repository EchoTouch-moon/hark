import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ProjectObserver } from '../packages/project-observer/src/observer.ts';
import { createGitRepo } from '../packages/project-observer/src/testkit/git-fixture.ts';

const execFileAsync = promisify(execFile);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
}

async function createSizedRepo(parent: string, name: string, files: number): Promise<string> {
  const root = await createGitRepo(parent, name, { files: { 'README.md': `# ${name}\n` } });
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { git } = await import('../packages/project-observer/src/testkit/git-fixture.ts');
  for (let i = 0; i < files; i += 1) {
    const rel = `src/b${Math.floor(i / 200)}/f${i}.txt`;
    await mkdir(path.join(root, path.dirname(rel)), { recursive: true });
    await writeFile(path.join(root, rel), `file ${i}\n`);
  }
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.email=observer@test.local', '-c', 'user.name=Observer Test', 'commit', '-m', `add ${files} files`]);
  return root;
}

function stats(samples: number[]): { n: number; p50: number; p95: number; max: number } {
  return {
    n: samples.length,
    p50: Math.round(percentile(samples, 50) * 100) / 100,
    p95: Math.round(percentile(samples, 95) * 100) / 100,
    max: Math.round(Math.max(...samples) * 100) / 100,
  };
}

async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function main(): Promise<void> {
  const idleMs = Number(process.env['OBSERVER_BENCH_IDLE_MS'] ?? 1_800_000);
  const iterations = Number(process.env['OBSERVER_BENCH_ITERS'] ?? 30);
  const outDir = process.env['OBSERVER_BENCH_OUT'] ?? path.join('docs', 'verification', 'data');
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(path.join(os.tmpdir(), 'obs-bench-'));

  const sqliteVersion = await (async () => {
    const observer = new ProjectObserver({ dbPath: path.join(work, 'probe.sqlite'), watchEnabled: false });
    const v = observer.store.sqliteVersion();
    const journal = observer.store.journalMode();
    observer.close();
    return { v, journal };
  })();

  const machine = {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    ramGb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    node: process.version,
    git: String((await execFileAsync('git', ['--version'])).stdout).trim(),
    sqlite: sqliteVersion.v,
    journalMode: sqliteVersion.journal,
    cwdRedacted: '<repo>/hark',
  };

  const sizes = [
    { name: 'small', files: 200 },
    { name: 'medium', files: 2000 },
    { name: 'large-synthetic', files: 8000 },
  ];

  const results: Record<string, unknown> = { machine, rssStartMb: rssMb(), suites: [] };
  const rssStart = rssMb();

  try {
    for (const size of sizes) {
      const root = await createSizedRepo(work, size.name, size.files);
      const dbPath = path.join(work, `${size.name}.sqlite`);
      const observer = new ProjectObserver({ dbPath, watchEnabled: false, debounceMs: 200 });
      const first: number[] = [];
      first.push(await timed(async () => {
        await observer.registerProject(root, { name: size.name });
      }));
      const id = observer.listProjects()[0]!.id;
      const unchanged: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        unchanged.push(await timed(async () => {
          await observer.scanProject(id, 'reconcile');
        }));
      }
      const changed: number[] = [];
      for (let i = 0; i < Math.min(10, iterations); i += 1) {
        await writeFile(path.join(root, `chg-${i}.txt`), `c${i}\n`);
        changed.push(await timed(async () => {
          await observer.scanProject(id, 'manual');
        }));
      }
      const burst: number[] = [];
      burst.push(await timed(async () => {
        for (let i = 0; i < 200; i += 1) observer.hintDirty(id, `chg-${i % 10}.txt`);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await observer.scanProject(id, 'watch');
      }));
      (results.suites as unknown[]).push({
        name: size.name,
        trackedFiles: size.files,
        firstScanMs: stats(first),
        unchangedMs: stats(unchanged),
        changedMs: stats(changed),
        burst200HintsMs: stats(burst),
        gitScans: observer.scanStats(),
      });
      await observer.stop();
      observer.close();
    }

    const idle: Array<{ t: number; rssMb: number }> = [];
    const idleObserver = new ProjectObserver({
      dbPath: path.join(work, 'idle.sqlite'),
      watchEnabled: true,
      reconcileIntervalMs: 60_000,
    });
    const idleRoot = await createSizedRepo(work, 'idle', 200);
    await idleObserver.registerProject(idleRoot, { name: 'idle' });
    await idleObserver.start();
    const idleStart = Date.now();
    idle.push({ t: 0, rssMb: rssMb() });
    while (Date.now() - idleStart < idleMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, idleMs)));
      idle.push({ t: Date.now() - idleStart, rssMb: rssMb() });
    }
    await idleObserver.stop();
    idleObserver.close();
    results.idle = {
      durationMs: idleMs,
      samples: idle,
      rssStartMb: rssStart,
      rssEndMb: rssMb(),
      rssPeakMb: Math.max(...idle.map((s) => s.rssMb), rssMb()),
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  const outFile = path.join(outDir, `observer-p05-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ outFile, rssEndMb: rssMb(), suites: results.suites }, null, 2));
}

await main();
