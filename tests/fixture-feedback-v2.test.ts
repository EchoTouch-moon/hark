import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Feedback, FeedbackV2 } from '../src/domain-contracts.js';
import { openDatabase } from '../src/storage.js';
import { appendFixtureFact, registerFixtureSource } from '../src/fixture-chronicle.js';
import { appendFixtureFeedback, readFixtureOpinion, registerFixtureProject, saveFixtureOpinion } from '../src/fixture-opinion-store.js';

// Synthetic data only: no user project, real provider, or network access.
const time = '2026-11-03T12:00:00.000Z';
const scope = { principalId: 'user', projectId: 'A', grantId: 'gA', rootId: 'rootA' };
const project = { id: 'A', name: 'Synthetic A', description: '', state: 'active', createdAt: time };
const fact = { id: 'fact-a', projectId: 'A', sourceId: 'source-a', epoch: 0, observedAt: time, summary: 'synthetic', sensitivity: 'personal', provenance: 'tool_observed', dedupeKey: 'fact-key' };
const bundle = {
  contractVersion: '1', project,
  opinion: { id: 'opinion-a', projectId: 'A', topicKey: 'next', currentRevision: 1, status: 'draft' },
  revision: {
    id: 'revision-a-1', opinionId: 'opinion-a', projectId: 'A', version: 1,
    facts: [{ statement: 'synthetic', subject: 'project', source: { kind: 'observer', projectId: 'A', observerSourceId: 'source-a', epoch: 0, eventId: 'fact-a', observedAt: time, quality: 'observed' } }],
    inferences: [], counterEvidence: [], counterEvidenceLimitation: 'none found', uncertainties: ['unknown'],
    opinion: 'review', whyNow: 'fixture', alternatives: [], changeMyMindWhen: ['new evidence'], proposedPlanId: 'plan-a-1', createdAt: time,
  },
  plan: { id: 'plan-a-1', projectId: 'A', revisionId: 'revision-a-1', versionHash: 'a'.repeat(64), steps: ['review'], risks: [], validation: ['check'], executable: false },
  feedback: [],
};
const v1 = { id: 'feedback-v1', projectId: 'A', revisionId: 'revision-a-1', choice: 'accept', createdAt: time };
const v2 = { id: 'feedback-v2', projectId: 'A', revisionId: 'revision-a-1', contractVersion: '2', choice: 'reject', reason: 'The proposal is not aligned with my goal', createdAt: time };

describe('versioned fixture feedback', () => {
  const dirs: string[] = [];
  const handles = new Set<DatabaseSync>();
  afterEach(() => {
    for (const db of handles) db.close();
    handles.clear();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function open(path: string) { const db = openDatabase(path); handles.add(db); return db; }
  function close(db: DatabaseSync) { db.close(); handles.delete(db); }
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-feedback-v2-'));
    dirs.push(dir);
    const path = join(dir, 'synthetic.sqlite');
    const db = open(path);
    db.exec(`INSERT INTO projects VALUES ('A','Synthetic A','');
      INSERT INTO observation_grants VALUES ('gA','user','A','rootA',1,0,'2099-01-01T00:00:00Z',NULL);`);
    registerFixtureProject(db, scope, project);
    registerFixtureSource(db, scope, 'source-a');
    appendFixtureFact(db, scope, fact);
    saveFixtureOpinion(db, scope, bundle, 0);
    return { db, path };
  }

  it('retains strict v1 behavior and explicitly versions the new reject choice', () => {
    expect(Feedback.safeParse(v1).success).toBe(true);
    expect(Feedback.safeParse({ ...v1, choice: 'reject' }).success).toBe(false);
    expect(Feedback.safeParse({ ...v1, contractVersion: '2' }).success).toBe(false);
    expect(FeedbackV2.safeParse(v2).success).toBe(true);
    expect(FeedbackV2.safeParse({ ...v2, contractVersion: '1' }).success).toBe(false);
    expect(FeedbackV2.safeParse({ ...v2, extra: true }).success).toBe(false);
    const { contractVersion: _missing, ...unversioned } = v2;
    expect(FeedbackV2.safeParse(unversioned).success).toBe(false);
  });

  it('preserves old feedback and a v2 rejection after restart without altering the opinion', () => {
    const setup = fixture();
    let db = setup.db;
    appendFixtureFeedback(db, scope, v1, 'key-v1');
    appendFixtureFeedback(db, scope, v2, 'key-v2');
    expect(db.prepare("SELECT current_revision FROM fixture_opinions WHERE id='opinion-a'").get()?.current_revision).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(1);
    close(db);
    db = open(setup.path);
    const result = readFixtureOpinion(db, scope, 'opinion-a', 1);
    expect(result?.revision).toEqual(bundle.revision);
    expect(result?.plan).toEqual(bundle.plan);
    expect(result?.feedback).toEqual([v1, v2]);
    expect(result?.change).toBeNull();
    expect(db.prepare('SELECT feedback_id, version FROM fixture_feedback_versions').all()).toEqual([{ feedback_id: v2.id, version: '2' }]);
  });

  it('makes the entire versioned payload part of the idempotency decision', () => {
    const { db } = fixture();
    expect(appendFixtureFeedback(db, scope, v2, 'same-key')).toEqual(v2);
    expect(appendFixtureFeedback(db, scope, { ...v2 }, 'same-key')).toEqual(v2);
    expect(() => appendFixtureFeedback(db, scope, { ...v2, reason: 'A different reason' }, 'same-key')).toThrow();
    expect(() => appendFixtureFeedback(db, scope, { ...v2, id: 'different-id' }, 'same-key')).toThrow();
    expect(() => appendFixtureFeedback(db, scope, { ...v1, id: v2.id, choice: 'accept' }, 'same-key')).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_feedback_versions').get()?.n).toBe(1);
  });

  it('rolls back feedback if its v2 marker cannot be persisted', () => {
    const { db } = fixture();
    appendFixtureFeedback(db, scope, v1, 'key-v1');
    db.exec("CREATE TRIGGER synthetic_marker_failure BEFORE INSERT ON fixture_feedback_versions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => appendFixtureFeedback(db, scope, v2, 'key-v2')).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_feedback_versions').get()?.n).toBe(0);
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)?.feedback).toEqual([v1]);
  });

  it('withholds versioned feedback when the persisted grant has been revoked', () => {
    const setup = fixture();
    let db = setup.db;
    appendFixtureFeedback(db, scope, v2, 'key-v2');
    db.exec("UPDATE observation_grants SET revoked_at='2026-11-03T13:00:00.000Z' WHERE id='gA'");
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scope, { ...v2, id: 'other' }, 'other-key')).toThrow();
    close(db);
    db = open(setup.path);
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_feedback').get()?.n).toBe(1);
  });

  it('migrates an existing v4 database without changing its v1 feedback', () => {
    const setup = fixture();
    let db = setup.db;
    appendFixtureFeedback(db, scope, v1, 'key-v1');
    db.exec('DROP TABLE fixture_feedback_versions; DROP TABLE fixture_candidate_grants; DROP TABLE fixture_discovery_candidates; DROP TABLE fixture_roots; DELETE FROM schema_migrations WHERE version>=5;');
    close(db);
    db = open(setup.path);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }]);
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)?.feedback).toEqual([v1]);
    expect(db.prepare('SELECT count(*) AS n FROM fixture_feedback_versions').get()?.n).toBe(0);
    appendFixtureFeedback(db, scope, v2, 'key-v2');
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)?.feedback).toEqual([v1, v2]);
  });

  it('does not reinterpret a v2 payload without its marker as legacy feedback', () => {
    const { db } = fixture();
    db.prepare('INSERT INTO fixture_opinion_feedback(id,project_id,revision_id,dedupe_key,data_json) VALUES (?, ?, ?, ?, ?)')
      .run(v2.id, 'A', 'revision-a-1', 'missing-marker', JSON.stringify(v2));
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scope, v2, 'missing-marker')).toThrow();
  });

  it('withholds feedback when its stored marker is corrupt rather than treating it as v1', () => {
    const { db } = fixture();
    db.prepare('INSERT INTO fixture_opinion_feedback(id,project_id,revision_id,dedupe_key,data_json) VALUES (?, ?, ?, ?, ?)')
      .run(v2.id, 'A', 'revision-a-1', 'corrupt-marker', JSON.stringify(v2));
    // Simulate an already-corrupt database; the bypass is confined to this temp DB.
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.prepare('INSERT INTO fixture_feedback_versions(feedback_id,version) VALUES (?, ?)').run(v2.id, '999');
    db.exec('PRAGMA ignore_check_constraints=OFF');
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scope, v2, 'corrupt-marker')).toThrow();
  });

  it('does not allow version markers to be updated, deleted or replaced', () => {
    const { db } = fixture();
    appendFixtureFeedback(db, scope, v2, 'key-v2');
    expect(() => db.exec("UPDATE fixture_feedback_versions SET version='2'")).toThrow();
    expect(() => db.exec('DELETE FROM fixture_feedback_versions')).toThrow();
    expect(() => db.exec('INSERT OR REPLACE INTO fixture_feedback_versions SELECT * FROM fixture_feedback_versions')).toThrow();
    expect(readFixtureOpinion(db, scope, 'opinion-a', 1)?.feedback).toEqual([v2]);
  });
});
