import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '../packages/project-observer/src/observer.ts';
import { repoReadOnlyFingerprint } from '../packages/project-observer/src/testkit/git-fixture.ts';
import { InsightConsumer } from '../packages/project-insight/src/consume.ts';
import { processProjectRules } from '../packages/project-insight/src/insights/processor.ts';
import { InProcessObserverReadPort } from '../packages/project-insight/src/observer-read-port.ts';
import { InsightStore } from '../packages/project-insight/src/store/store.ts';

const PILOTS = [
  { name: 'pindou', env: 'HEARTH_PILOT_PINDOU' },
  { name: 'prototype-skill-lab', env: 'HEARTH_PILOT_SKILL_LAB' },
  { name: 'agent-internet-lab', env: 'HEARTH_PILOT_AGENT_INTERNET' },
];

const results: unknown[] = [];
for (const pilot of PILOTS) {
  const localPath = process.env[pilot.env];
  if (localPath === undefined || localPath.trim() === '') {
    results.push({ name: pilot.name, result: 'BLOCKED_PATH_UNAVAILABLE', reason: `unset ${pilot.env}` });
    continue;
  }
  if (!existsSync(localPath)) {
    results.push({ name: pilot.name, result: 'BLOCKED_PATH_UNAVAILABLE', reason: 'path not present' });
    continue;
  }
  const dir = await mkdtemp(path.join(tmpdir(), `insight-s2-pilot-${pilot.name}-`));
  const observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
  const store = new InsightStore(path.join(dir, 'insights.sqlite'), { skipWriterLock: true });
  try {
    const before = await repoReadOnlyFingerprint(localPath);
    const project = await observer.registerProject(localPath, { name: pilot.name });
    const consume = await new InsightConsumer(store).consumeProjectBatch(new InProcessObserverReadPort(observer), {
      projectId: project.id,
      limit: 200,
    });
    const rules = processProjectRules(store, {
      projectId: project.id,
      streamEpoch: consume.checkpoint.streamEpoch || 1,
      baseline: 'existing-inbox',
      limit: 200,
    });
    const after = await repoReadOnlyFingerprint(localPath);
    results.push({
      name: pilot.name,
      result: JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL',
      consume: consume.outcome,
      episodesOpened: rules.episodesOpened,
      historicalBaseline: true,
      repoUnchanged: JSON.stringify(before) === JSON.stringify(after),
    });
  } finally {
    await observer.stop();
    observer.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(results, null, 2));
