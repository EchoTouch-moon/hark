import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTRACTOR_VERSION } from '../packages/project-insight/src/contracts.ts';
import { processProjectRules } from '../packages/project-insight/src/insights/processor.ts';
import { makeSignal, testFailSignal } from '../packages/project-insight/src/insights/fixtures.ts';
import { InsightStore } from '../packages/project-insight/src/store/store.ts';
import type { Signal } from '../packages/project-insight/src/contracts.ts';

const N = 30;
const SIGNALS = 200;
const projectId = 'prj_aaaaaaaaaaaaaaaa';

function batch(): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < SIGNALS; i += 1) {
    if (i % 20 === 0) {
      out.push({
        ...testFailSignal(),
        signalKey: `k${i.toString().padStart(62, '0')}`,
        appendSeq: i + 1,
        sourceEventIds: [`e${i.toString().padStart(15, '0')}`],
        evidenceRefs: [
          {
            kind: 'observer_event',
            projectId,
            id: `e${i.toString().padStart(15, '0')}`,
            observedAt: '2026-10-28T10:00:00.000Z',
            quality: 'OBSERVED',
            role: 'trigger',
          },
        ],
      });
    } else {
      out.push(
        makeSignal({
          kind: 'REPOSITORY_HEAD_CHANGED',
          signalKey: `k${i.toString().padStart(62, '0')}`,
          appendSeq: i + 1,
          sourceEventIds: [`e${i.toString().padStart(15, '0')}`],
        }),
      );
    }
  }
  return out;
}

function seed(store: InsightStore, signals: Signal[]): void {
  store.commitSignalBatch({
    projectId,
    streamEpoch: 1,
    expectedRevision: 0,
    batch: {
      signals,
      proposedCursor: { afterSeq: SIGNALS, streamEpoch: 1 },
      highWatermark: SIGNALS,
      outcome: 'OK',
      hasMore: false,
      legacyOrderReconstructed: false,
      extractorVersion: EXTRACTOR_VERSION,
      eventsRead: SIGNALS,
    },
  });
}

const samples: number[] = [];
let episodes = 0;
for (let i = 0; i < N; i += 1) {
  const dir = mkdtempSync(path.join(tmpdir(), 'insight-s2-bench-'));
  const store = new InsightStore(path.join(dir, 'insights.sqlite'), { skipWriterLock: true });
  seed(store, batch());
  const started = Date.now();
  const result = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none', limit: 200 });
  samples.push(Date.now() - started);
  episodes = result.episodesOpened;
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
const payload = {
  createdAt: new Date().toISOString(),
  n: N,
  signals: SIGNALS,
  p50Ms: p50,
  p95Ms: p95,
  minMs: samples[0],
  maxMs: samples[samples.length - 1],
  episodesOpened: episodes,
  rssMb: process.memoryUsage().rss / (1024 * 1024),
};
const outDir = path.resolve(import.meta.dirname, '..', 'docs', 'verification', 'data');
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `insight-s2-bench-${payload.createdAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ file, ...payload }, null, 2));
