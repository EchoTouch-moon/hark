import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverStore } from './state/store.js';
import { migrateObserver, openObserverDatabase } from './state/schema.js';
import { createGitRepo } from './testkit/git-fixture.js';


let dir: string;
let now = new Date('2026-10-28T08:00:00.000Z');

describe('H04 sqlite', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-h04-'));
    now = new Date('2026-10-28T08:00:00.000Z');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('DB-01 injected faults roll back pointer, snapshot and events', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'tx');
    const project = await observer.registerProject(root);
    const beforeEvents = observer.store.countEvents(project.id);
    const beforeSnap = observer.getLatestSnapshot(project.id)?.id;
    const beforeRev = observer.getObserverHealth(project.id).currentRevision;
    await writeFile(path.join(root, 'dirty.txt'), 'x\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    for (const fault of ['after-run', 'after-snapshot', 'after-events', 'after-pointer'] as const) {
      await expect(observer.scanProject(project.id, 'manual', fault)).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
      expect(observer.store.countEvents(project.id)).toBe(beforeEvents);
      expect(observer.getLatestSnapshot(project.id)?.id).toBe(beforeSnap);
      expect(observer.getObserverHealth(project.id).currentRevision).toBe(beforeRev);
    }
    await observer.scanProject(project.id, 'manual');
    expect(observer.store.countEvents(project.id)).toBeGreaterThan(beforeEvents);
    await observer.stop();
    observer.close();
  });

  it('DB-02 migrations are idempotent and do not half-apply', () => {
    const dbPath = path.join(dir, 'mig.sqlite');
    const first = openObserverDatabase(dbPath);
    const again = migrateObserver(first);
    expect(again.applied).toEqual([]);
    expect(again.currentVersion).toBe(3);
    first.close();
  });

  it('DB-04 integrity and foreign_key_check are clean after restart', async () => {
    const dbPath = path.join(dir, 'observer.sqlite');
    const observer = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    const root = await createGitRepo(dir, 'int');
    await observer.registerProject(root);
    const check = observer.store.integrity();
    expect(check.integrityCheck).toBe('ok');
    expect(check.foreignKeyViolations).toBe(0);
    await observer.stop();
    observer.close();
    const reopened = new ProjectObserver({ dbPath, watchEnabled: false });
    const again = reopened.store.integrity();
    expect(again.integrityCheck).toBe('ok');
    expect(again.foreignKeyViolations).toBe(0);
    await reopened.stop();
    reopened.close();
  });

  it('DB-05 online backup restores a consistent copy', async () => {
    const dbPath = path.join(dir, 'observer.sqlite');
    const observer = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    const root = await createGitRepo(dir, 'bak');
    const project = await observer.registerProject(root);
    const dest = path.join(dir, 'backup.sqlite');
    observer.store.backupTo(dest);
    await observer.stop();
    observer.close();
    const restored = new ObserverStore(dest);
    expect(restored.getProject(project.id)?.name).toBeDefined();
    expect(restored.integrity().integrityCheck).toBe('ok');
    restored.close();
  });

  it('DB-07 event pagination is stable and project-scoped', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const a = await observer.registerProject(await createGitRepo(dir, 'page-a'));
    const b = await observer.registerProject(await createGitRepo(dir, 'page-b'));
    for (let i = 0; i < 6; i += 1) {
      await writeFile(path.join(dir, 'page-a', `f${i}.txt`), 'x\n');
      now = new Date(Date.parse('2026-10-28T08:01:00.000Z') + i * 1000);
      await observer.scanProject(a.id, 'manual');
    }
    const page1 = observer.listEvents(a.id, { limit: 3 });
    const page2 = observer.listEvents(a.id, { limit: 3, cursor: page1.nextCursor ?? undefined });
    const ids = [...page1.events, ...page2.events].map((event) => event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(observer.listEvents(b.id, { limit: 50 }).events.every((event) => event.projectId === b.id)).toBe(true);
    await observer.stop();
    observer.close();
  });
});
