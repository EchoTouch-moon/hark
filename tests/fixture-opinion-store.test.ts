import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/storage.js';
import { advanceFixtureEpoch, appendFixtureFact, registerFixtureSource } from '../src/fixture-chronicle.js';
import { appendFixtureFeedback, readFixtureOpinion, registerFixtureProject, saveFixtureOpinion } from '../src/fixture-opinion-store.js';
import { recordFixtureDecision, withdrawFixtureDecision } from '../src/fixture-decision.js';

// Entirely synthetic; no filesystem project or external source is inspected.
const time = '2026-11-03T12:00:00.000Z';
const scopeA = { principalId: 'user', projectId: 'A', grantId: 'gA', rootId: 'rootA' };
const scopeB = { principalId: 'user', projectId: 'B', grantId: 'gB', rootId: 'rootB' };
const projectA = { id: 'A', name: 'Synthetic A', description: '', state: 'active', createdAt: time };
const projectB = { id: 'B', name: 'Synthetic B', description: '', state: 'active', createdAt: time };
const factA = { id: 'fact-a', projectId: 'A', sourceId: 'source-a', epoch: 0, observedAt: time, summary: 'synthetic', sensitivity: 'personal', provenance: 'tool_observed', dedupeKey: 'f-a' };
const factB = { ...factA, id: 'fact-b', projectId: 'B', sourceId: 'source-b', dedupeKey: 'f-b' };

function bundleFor(project: typeof projectA, version: number) {
  const suffix = project.id.toLowerCase();
  const revId = `revision-${suffix}-${version}`;
  const planId = `plan-${suffix}-${version}`;
  return {
    contractVersion: '1', project,
    opinion: { id: `opinion-${suffix}`, projectId: project.id, topicKey: 'next', currentRevision: version, status: 'draft' },
    revision: {
      id: revId, opinionId: `opinion-${suffix}`, projectId: project.id, version,
      facts: [{ statement: 'synthetic', subject: 'project', source: { kind: 'observer', projectId: project.id, observerSourceId: `source-${suffix}`, epoch: 0, eventId: `fact-${suffix}`, observedAt: time, quality: 'observed' } }],
      inferences: [], counterEvidence: [], counterEvidenceLimitation: 'none found', uncertainties: ['unknown'],
      opinion: `review ${version}`, whyNow: 'fixture', alternatives: [], changeMyMindWhen: ['new evidence'], proposedPlanId: planId, createdAt: time,
    },
    plan: { id: planId, projectId: project.id, revisionId: revId, versionHash: 'a'.repeat(64), steps: ['review'], risks: [], validation: ['check'], executable: false },
    feedback: [],
  };
}
const feedback = { id: 'feedback-a-1', projectId: 'A', revisionId: 'revision-a-1', choice: 'challenge', reason: 'Synthetic objection', createdAt: time };

describe('fixture opinion memory', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-opinion-test-'));
    dirs.push(dir);
    const path = join(dir, 'synthetic.sqlite');
    const db = openDatabase(path);
    db.exec(`INSERT INTO projects VALUES ('A','Synthetic A',''), ('B','Synthetic B','');
      INSERT INTO observation_grants VALUES
        ('gA','user','A','rootA',1,0,'2099-01-01T00:00:00Z',NULL),
        ('gB','user','B','rootB',1,0,'2099-01-01T00:00:00Z',NULL);`);
    registerFixtureProject(db, scopeA, projectA);
    registerFixtureProject(db, scopeB, projectB);
    registerFixtureSource(db, scopeA, 'source-a');
    registerFixtureSource(db, scopeB, 'source-b');
    appendFixtureFact(db, scopeA, factA);
    appendFixtureFact(db, scopeB, factB);
    return { db, path };
  }

  it('upgrades an existing v2 database without losing fixture sources and observations', () => {
    const setup = fixture();
    let db = setup.db;
    db.exec(`DROP TABLE fixture_decisions; DROP TABLE fixture_opinion_feedback; DROP TABLE fixture_opinion_plans;
      DROP TABLE fixture_opinion_revisions; DROP TABLE fixture_opinions; DROP TABLE fixture_project_profiles;
      DELETE FROM schema_migrations WHERE version>=3;`);
    db.close();
    db = openDatabase(setup.path);
    registerFixtureProject(db, scopeA, projectA);
    expect(saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0)).toBe(1);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)?.revision.facts[0]?.statement).toBe('synthetic');
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    db.close();
  });

  it('preserves v1, feedback and v2 across restart without changing history', () => {
    const setup = fixture();
    let db = setup.db;
    const first = bundleFor(projectA, 1), second = bundleFor(projectA, 2);
    expect(saveFixtureOpinion(db, scopeA, first, 0)).toBe(1);
    expect(appendFixtureFeedback(db, scopeA, feedback, 'feedback-key')).toEqual(feedback);
    expect(saveFixtureOpinion(db, scopeA, second, 1, 'User challenged the first version')).toBe(2);
    db.close();
    db = openDatabase(setup.path);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).toEqual({ revision: first.revision, plan: first.plan, feedback: [feedback], change: null });
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 2)).toEqual({ revision: second.revision, plan: second.plan, feedback: [], change: { previousRevisionId: first.revision.id, reason: 'User challenged the first version' } });
    expect(db.prepare("SELECT current_revision FROM fixture_opinions WHERE id='opinion-a'").get()?.current_revision).toBe(2);
    db.close();
  });

  it('withholds a user decision after it is superseded or withdrawn, without deleting opinion history', () => {
    const setup = fixture();
    let db = setup.db;
    const decision = { id: 'decision-a', projectId: 'A', revision: 1, statement: 'A synthetic choice', recordedAt: time };
    recordFixtureDecision(db, scopeA, decision);
    const decisionRef = { kind: 'decision', projectId: 'A', decisionId: decision.id, revision: 1, recordedAt: time, status: 'active' };
    const first = bundleFor(projectA, 1);
    const firstWithDecision = { ...first, revision: { ...first.revision, facts: [...first.revision.facts, { statement: decision.statement, subject: 'user_decision', source: decisionRef }] } };
    const fabricated = { ...firstWithDecision, revision: { ...firstWithDecision.revision, facts: [...first.revision.facts, { statement: 'Invented choice', subject: 'user_decision', source: decisionRef }] } };
    expect(() => saveFixtureOpinion(db, scopeA, fabricated, 0)).toThrow();
    expect(saveFixtureOpinion(db, scopeA, firstWithDecision, 0)).toBe(1);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).not.toBeNull();
    recordFixtureDecision(db, scopeA, { ...decision, revision: 2, statement: 'A revised choice' });
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).toBeNull();
    const second = bundleFor(projectA, 2);
    const secondWithDecision = { ...second, revision: { ...second.revision, facts: [...second.revision.facts, { statement: 'A revised choice', subject: 'user_decision', source: { ...decisionRef, revision: 2 } }] } };
    expect(saveFixtureOpinion(db, scopeA, secondWithDecision, 1, 'User revised the choice')).toBe(2);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 2)).not.toBeNull();
    withdrawFixtureDecision(db, scopeA, decision.id, 2);
    db.close();
    db = openDatabase(setup.path);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 2)).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(2);
    db.close();
  });

  it('requires a nonempty change reason only for a subsequent revision', () => {
    const { db } = fixture();
    const first = bundleFor(projectA, 1), second = bundleFor(projectA, 2);
    expect(() => saveFixtureOpinion(db, scopeA, first, 0, 'No previous version exists')).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_opinions').get()?.n).toBe(0);
    expect(saveFixtureOpinion(db, scopeA, first, 0)).toBe(1);
    expect(() => saveFixtureOpinion(db, scopeA, second, 1)).toThrow();
    expect(() => saveFixtureOpinion(db, scopeA, second, 1, '   ')).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_opinion_revisions').get()?.n).toBe(1);
    expect(saveFixtureOpinion(db, scopeA, second, 1, 'The user supplied context')).toBe(2);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 2)?.change).toEqual({ previousRevisionId: first.revision.id, reason: 'The user supplied context' });
    db.close();
  });

  it('allows only an exact feedback replay under one idempotency key', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    expect(appendFixtureFeedback(db, scopeA, feedback, 'feedback-key')).toEqual(feedback);
    expect(appendFixtureFeedback(db, scopeA, { ...feedback }, 'feedback-key')).toEqual(feedback);
    expect(() => appendFixtureFeedback(db, scopeA, { ...feedback, reason: 'A different objection' }, 'feedback-key')).toThrow();
    expect(() => appendFixtureFeedback(db, scopeA, { ...feedback, id: 'different-id' }, 'feedback-key')).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM fixture_opinion_feedback').get()?.count).toBe(1);
    db.close();
  });

  it('isolates projects for both stored references and requests', () => {
    const { db } = fixture();
    const a = bundleFor(projectA, 1), b = bundleFor(projectB, 1);
    saveFixtureOpinion(db, scopeA, a, 0);
    saveFixtureOpinion(db, scopeB, b, 0);
    expect(readFixtureOpinion(db, scopeA, 'opinion-b', 1)).toBeNull();
    expect(readFixtureOpinion(db, scopeB, 'opinion-a', 1)).toBeNull();
    expect(() => saveFixtureOpinion(db, scopeA, b, 0)).toThrow();
    expect(() => appendFixtureFeedback(db, scopeB, feedback, 'cross-key')).toThrow();
    expect(readFixtureOpinion(db, { ...scopeA, principalId: 'other' }, 'opinion-a', 1)).toBeNull();
    db.close();
  });

  it('rejects stale expected revision and rolls back conflicting writes', () => {
    const setup = fixture();
    const db = setup.db;
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    const other = openDatabase(setup.path);
    const next = bundleFor(projectA, 2);
    expect(saveFixtureOpinion(db, scopeA, next, 1, 'Reason for revision')).toBe(2);
    const stale = bundleFor(projectA, 2);
    stale.revision.id = 'stale-revision';
    stale.revision.proposedPlanId = 'stale-plan';
    stale.plan.id = 'stale-plan';
    stale.plan.revisionId = 'stale-revision';
    expect(() => saveFixtureOpinion(other, scopeA, stale, 1, 'Stale writer')).toThrow();
    expect(other.prepare("SELECT COUNT(*) AS count FROM fixture_opinion_revisions WHERE opinion_id='opinion-a'").get()?.count).toBe(2);
    expect(other.prepare("SELECT COUNT(*) AS count FROM fixture_opinion_plans WHERE id='stale-plan'").get()?.count).toBe(0);
    expect(other.prepare("SELECT current_revision FROM fixture_opinions WHERE id='opinion-a'").get()?.current_revision).toBe(2);
    other.close(); db.close();
  });

  it('keeps revisions, plans and feedback append-only including replace attempts', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    appendFixtureFeedback(db, scopeA, feedback, 'feedback-key');
    for (const table of ['fixture_opinion_revisions', 'fixture_opinion_plans', 'fixture_opinion_feedback']) {
      expect(() => db.exec(`UPDATE ${table} SET data_json='{}'`)).toThrow();
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow();
      expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow();
    }
    db.close();
  });

  it('enforces change reason and non-executable plan in SQLite even without the application schemas', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    const next = bundleFor(projectA, 2);
    const insertRevision = db.prepare('INSERT INTO fixture_opinion_revisions(id, project_id, opinion_id, version, data_json, previous_revision_id, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)');
    expect(() => insertRevision.run(next.revision.id, 'A', 'opinion-a', 2, JSON.stringify(next.revision), 'revision-a-1', null)).toThrow(/CHECK constraint/);
    expect(() => insertRevision.run(next.revision.id, 'A', 'opinion-a', 2, JSON.stringify(next.revision), 'revision-a-1', '   ')).toThrow(/CHECK constraint/);
    insertRevision.run(next.revision.id, 'A', 'opinion-a', 2, JSON.stringify(next.revision), 'revision-a-1', 'Synthetic reason');
    const insertPlan = db.prepare('INSERT INTO fixture_opinion_plans(id, project_id, revision_id, data_json) VALUES (?, ?, ?, ?)');
    for (const value of [{}, { executable: true }, { executable: 0 }, { executable: 'false' }]) {
      expect(() => insertPlan.run('invalid-plan', 'A', next.revision.id, JSON.stringify(value)), JSON.stringify(value)).toThrow(/CHECK constraint/);
    }
    insertPlan.run(next.plan.id, 'A', next.revision.id, JSON.stringify(next.plan));
    db.close();
  });

  it.each([
    ['revoked', "UPDATE observation_grants SET revoked_at='2026-11-03T00:00:00Z' WHERE id='gA'"],
    ['paused', "UPDATE observation_grants SET paused=1 WHERE id='gA'"],
    ['expired', "UPDATE observation_grants SET expires_at='2000-01-01T00:00:00Z' WHERE id='gA'"],
  ])('withholds data and rejects new writes after authorization is %s', (_label, statement) => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    db.exec(statement);
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scopeA, feedback, 'feedback-key')).toThrow();
    expect(() => saveFixtureOpinion(db, scopeA, bundleFor(projectA, 2), 1, 'New evidence')).toThrow();
    db.close();
  });

  it('withholds a revision and denies new writes after the evidence epoch changes', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    advanceFixtureEpoch(db, scopeA, 'source-a');
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scopeA, feedback, 'feedback-key')).toThrow();
    expect(() => saveFixtureOpinion(db, scopeA, bundleFor(projectA, 2), 1, 'New evidence')).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM fixture_opinion_revisions WHERE opinion_id='opinion-a'").get()?.count).toBe(1);
    db.close();
  });

  it('withholds a project being deleted and rejects new records', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    db.exec("UPDATE fixture_project_profiles SET state='deleting' WHERE project_id='A'");
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 1)).toBeNull();
    expect(() => appendFixtureFeedback(db, scopeA, feedback, 'feedback-key')).toThrow();
    expect(() => saveFixtureOpinion(db, scopeA, bundleFor(projectA, 2), 1, 'New evidence')).toThrow();
    db.close();
  });

  it('does not accept absent, stale or fabricated fixture evidence or executable plans', () => {
    const { db } = fixture();
    const baseline = bundleFor(projectA, 1);
    const evidence = baseline.revision.facts[0]!;
    for (const changed of [
      { ...evidence, statement: 'fabricated statement' },
      { ...evidence, source: { ...evidence.source, eventId: 'missing' } },
      { ...evidence, source: { ...evidence.source, epoch: 1 } },
      { ...evidence, source: { ...evidence.source, quality: 'stale' } },
      { ...evidence, source: { ...evidence.source, observedAt: '2026-11-04T12:00:00.000Z' } },
      { ...evidence, subject: 'external', source: { kind: 'research', projectId: 'A', researchSourceId: 'missing', accessedAt: time, contentHash: 'a'.repeat(64), availability: 'available' } },
    ]) {
      expect(() => saveFixtureOpinion(db, scopeA, { ...baseline, revision: { ...baseline.revision, facts: [changed] } }, 0)).toThrow();
    }
    expect(() => saveFixtureOpinion(db, scopeA, { ...baseline, plan: { ...baseline.plan, executable: true } }, 0)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM fixture_opinions').get()?.count).toBe(0);
    db.close();
  });

  it('withholds corrupted persisted revisions and plans instead of treating JSON as trusted', () => {
    const { db } = fixture();
    saveFixtureOpinion(db, scopeA, bundleFor(projectA, 1), 0);
    const next = bundleFor(projectA, 2);
    db.prepare('INSERT INTO fixture_opinion_revisions(id, project_id, opinion_id, version, data_json, previous_revision_id, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(next.revision.id, 'A', 'opinion-a', 2, JSON.stringify({ ...next.revision, version: 99 }), 'revision-a-1', 'Synthetic reason');
    db.prepare('INSERT INTO fixture_opinion_plans(id, project_id, revision_id, data_json) VALUES (?, ?, ?, ?)')
      .run(next.plan.id, 'A', next.revision.id, JSON.stringify(next.plan));
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 2)).toBeNull();

    const third = bundleFor(projectA, 3);
    db.prepare('INSERT INTO fixture_opinion_revisions(id, project_id, opinion_id, version, data_json, previous_revision_id, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(third.revision.id, 'A', 'opinion-a', 3, JSON.stringify(third.revision), 'revision-a-2', 'Synthetic reason');
    db.prepare('INSERT INTO fixture_opinion_plans(id, project_id, revision_id, data_json) VALUES (?, ?, ?, ?)')
      .run(third.plan.id, 'A', third.revision.id, JSON.stringify({ ...third.plan, projectId: 'B' }));
    expect(readFixtureOpinion(db, scopeA, 'opinion-a', 3)).toBeNull();
    db.close();
  });
});
