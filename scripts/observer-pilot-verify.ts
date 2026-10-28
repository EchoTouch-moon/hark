import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '../packages/project-observer/src/observer.ts';
import { repoReadOnlyFingerprint } from '../packages/project-observer/src/testkit/git-fixture.ts';

const pilots = [
  { name: 'pindou', env: 'HEARTH_PILOT_PINDOU' },
  { name: 'prototype-skill-lab', env: 'HEARTH_PILOT_SKILL_LAB' },
];

const dir = await mkdtemp(path.join(tmpdir(), 'obs-pilot-'));
const observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
const report: unknown[] = [];
try {
  for (const pilot of pilots) {
    const localPath = process.env[pilot.env];
    if (localPath === undefined || localPath.trim() === '') {
      report.push({ name: pilot.name, status: 'SKIPPED_UNSET_ENV', env: pilot.env });
      continue;
    }
    const before = await repoReadOnlyFingerprint(localPath);
    const project = await observer.registerProject(localPath, { name: pilot.name });
    const events1 = observer.store.countEvents(project.id);
    await observer.scanProject(project.id, 'manual');
    await observer.scanProject(project.id, 'manual');
    const after = await repoReadOnlyFingerprint(localPath);
    const snap = observer.getLatestSnapshot(project.id);
    const health = observer.getObserverHealth(project.id);
    report.push({
      name: pilot.name,
      id: project.id,
      branch: snap?.branch,
      shortSha: snap?.headSha?.slice(0, 12),
      worktreeClean: snap?.worktree.clean,
      test: snap?.test.result,
      testQuality: snap?.test.evidenceQuality,
      collection: health.collectionStatus,
      eventsAfterTwoRescans: observer.store.countEvents(project.id) - events1,
      repoUnchanged: before.head === after.head && before.status === after.status && before.indexSize === after.indexSize,
    });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await observer.stop();
  observer.close();
}
