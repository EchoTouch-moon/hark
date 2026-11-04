import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginSyntheticRoot, enumerateSyntheticRoot, pauseSyntheticRoot, posixDirAdapterAvailable, resumeSyntheticRoot, type DiscoveryCandidate, type DiscoveryResult } from '../src/fixture-discovery.js';
import { openDatabase } from '../src/storage.js';

const sampleRoot = fileURLToPath(new URL('./fixtures/rediscovery', import.meta.url));
const dirs: string[] = [];
const now = new Date('2026-11-04T12:00:00.000Z');
const expires = '2099-01-01T00:00:00.000Z';
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function inventory(result: DiscoveryResult): DiscoveryCandidate[] {
  if ('candidates' in result) return result.candidates;
  throw new Error(result.reason);
}

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-discovery-scenario-'));
  dirs.push(dir);
  return openDatabase(join(dir, 'synthetic.sqlite'));
}

function commitSample(extra?: (setupPath: string) => void) {
  const database = db();
  const session = beginSyntheticRoot();
  dirs.push(session.setupPath);
  extra?.(session.setupPath);
  const committed = session.commit(database, now, expires);
  return { database, session, committed };
}

const scenarios = [
  {
    name: 'empty registered root is an explicit empty inventory',
    setup: () => commitSample(),
    check(result: ReturnType<typeof enumerateSyntheticRoot>) {
      expect(result).toEqual({ status: 'available', candidates: [] });
    },
  },
  {
    name: 'unassigned and same-name nested paths stay unconfirmed',
    setup: () => commitSample(setupPath => {
      cpSync(sampleRoot, setupPath, { recursive: true });
      mkdirSync(join(setupPath, 'project-a', '.git'));
      mkdirSync(join(setupPath, 'nested', 'project-a'), { recursive: true });
      writeFileSync(join(setupPath, 'nested', 'project-a', 'PROJECT.md'), '# nested synthetic\n');
    }),
    check(result: DiscoveryResult) {
      const byPath = Object.fromEntries(inventory(result).map(item => [item.relativePath, item]));
      expect(result.status).toBe('needs_confirmation');
      expect(byPath.unassigned?.attribution).toBe('needs_confirmation');
      expect(byPath['project-a']?.attribution).toBe('needs_confirmation');
      expect(byPath['nested/project-a']?.attribution).toBe('needs_confirmation');
      expect(byPath['project-b']?.attribution).toBe('confirmed');
    },
  },
] as const;

describe('user-visible adapter absence', () => {
  it('does not invent a successful inventory when the directory adapter is unavailable', () => {
    if (posixDirAdapterAvailable()) return;
    const { database, committed } = commitSample();
    expect(committed).toEqual({ status: 'unavailable', reason: 'adapter_unavailable' });
    database.close();
  });
});

describe.skipIf(!posixDirAdapterAvailable())('user-visible synthetic discovery scenarios', () => {
  it.each(scenarios)('$name', ({ setup, check }) => {
    const { database, committed } = setup();
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    check(enumerateSyntheticRoot(database, committed.handle, now));
    committed.handle.release();
    database.close();
  });

  it('repeat scans keep the same candidate identities', () => {
    const { database, committed } = commitSample(setupPath => {
      cpSync(sampleRoot, setupPath, { recursive: true });
      mkdirSync(join(setupPath, 'project-a', '.git'));
    });
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const first = inventory(enumerateSyntheticRoot(database, committed.handle, now));
    const second = inventory(enumerateSyntheticRoot(database, committed.handle, now));
    expect(second.map(item => `${item.relativePath}:${item.candidateId}`).sort())
      .toEqual(first.map(item => `${item.relativePath}:${item.candidateId}`).sort());
    committed.handle.release();
    database.close();
  });

  it('pause hides inventory and resume restores the same candidates', () => {
    const { database, committed } = commitSample(setupPath => {
      cpSync(sampleRoot, setupPath, { recursive: true });
      mkdirSync(join(setupPath, 'project-a', '.git'));
    });
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const before = inventory(enumerateSyntheticRoot(database, committed.handle, now));
    expect(pauseSyntheticRoot(database, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    expect(enumerateSyntheticRoot(database, committed.handle, now)).toMatchObject({ status: 'unavailable' });
    expect(resumeSyntheticRoot(database, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    const after = inventory(enumerateSyntheticRoot(database, committed.handle, now));
    expect(after.map(item => item.candidateId).sort()).toEqual(before.map(item => item.candidateId).sort());
    committed.handle.release();
    database.close();
  });
});
