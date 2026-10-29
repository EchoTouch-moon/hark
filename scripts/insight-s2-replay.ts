import { InsightStore } from '../packages/project-insight/src/store/store.ts';
import { processProjectRules } from '../packages/project-insight/src/insights/processor.ts';

const dbPath = process.argv[2];
const projectId = process.argv[3];
const streamEpoch = Number(process.argv[4] ?? '1');
if (dbPath === undefined || projectId === undefined) {
  console.error('usage: pnpm exec tsx scripts/insight-s2-replay.ts <insights.sqlite> <projectId> [epoch]');
  process.exit(1);
}
const store = new InsightStore(dbPath, { skipWriterLock: true });
try {
  const result = processProjectRules(store, {
    projectId,
    streamEpoch,
    baseline: 'none',
    limit: 200,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
}
