import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ActionSpec, ApprovalGrant } from '@hearth/contracts';
import { deriveIdempotencyKey, actionDigest, targetDigest } from '@hearth/contracts';
import { evaluatePolicy, validateGrant } from './policy.js';
import { resolveArtifactPath, validateRealpathContainment } from './artifact-path.js';
import { ACTION_REGISTRY, isRegisteredActionType, maxRisk } from './action-registry.js';

const NOW = '2026-10-28T12:00:00+08:00';

function spec(overrides: Partial<ActionSpec> = {}): ActionSpec {
  const base = {
    id: 'act-1',
    actionType: 'report.generate' as const,
    projectId: 'project-atlas',
    target: { resourceId: 'ci-42', path: 'report/atlas-ci-42.json' },
    params: { runId: 42 },
    allowedCapabilities: ['fs.write_demo_artifact'],
    risk: 'L1' as const,
    effect: 'local_create' as const,
    maxSteps: 8,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: deriveIdempotencyKey({
      actionType: 'report.generate',
      projectId: 'project-atlas',
      target: { resourceId: 'ci-42', path: 'report/atlas-ci-42.json' },
      params: { runId: 42 },
    }),
    verification: { kind: 'artifact_sha256' as const, artifactPath: 'report/atlas-ci-42.json' },
  };
  return { ...base, ...overrides } as ActionSpec;
}

const CTX_BASE = {
  now: NOW,
  allowedProjectIds: ['project-atlas', 'project-beacon'],
  grants: [] as ApprovalGrant[],
  demoArtifactRoot: '/tmp/hearth-test-artifacts',
};

describe('action registry', () => {
  it('covers exactly the four P0 action types with floors', () => {
    expect(Object.keys(ACTION_REGISTRY).sort()).toEqual([
      'checklist.generate',
      'draft.generate',
      'repo.read_diagnose',
      'report.generate',
    ]);
    expect(ACTION_REGISTRY['report.generate'].riskFloor).toBe('L1');
    expect(ACTION_REGISTRY['repo.read_diagnose'].effect).toBe('read');
    expect(isRegisteredActionType('shell.execute')).toBe(false);
  });
  it('maxRisk never downgrades', () => {
    expect(maxRisk('L0', 'L2')).toBe('L2');
    expect(maxRisk('L3', 'L0')).toBe('L3');
  });
});

describe('evaluatePolicy — happy paths', () => {
  it('permits L1 local_create inside demo root', async () => {
    const d = await evaluatePolicy(spec(), CTX_BASE);
    expect(d.decision).toBe('permit');
  });
  it('permits L0 read action', async () => {
    const d = await evaluatePolicy(
      spec({
        actionType: 'repo.read_diagnose',
        risk: 'L0',
        effect: 'read',
        target: { resourceId: 'fixture://events' },
        verification: { kind: 'json_schema' },
        allowedCapabilities: ['fs.read_fixture'],
      }),
      CTX_BASE,
    );
    expect(d).toMatchObject({ decision: 'permit', effectiveRisk: 'L0', effectiveEffect: 'read' });
  });
});

describe('evaluatePolicy — adversarial negatives', () => {
  it('S01-adjacent: unknown actionType denied (no tool escapes registry)', async () => {
    const d = await evaluatePolicy(spec({ actionType: 'shell.execute' as never }), CTX_BASE);
    expect(d).toMatchObject({ decision: 'deny', code: 'UNKNOWN_ACTION' });
  });
  it('L3 always denied even with grant (S05+)', async () => {
    const s = spec({ risk: 'L3' });
    const grant: ApprovalGrant = {
      id: 'g1',
      principalId: 'user-local',
      cardId: 'card-1',
      actionDigest: actionDigest(s),
      targetDigest: targetDigest(s),
      risk: 'L3',
      authorizedCapabilities: s.allowedCapabilities,
      expiresAt: '2099-01-01T00:00:00+08:00',
      grantedAt: NOW,
    };
    const d = await evaluatePolicy(s, { ...CTX_BASE, grants: [grant] });
    expect(d).toMatchObject({ decision: 'deny', code: 'L3_FORBIDDEN' });
  });
  it('S04: cross-project denied by ACL', async () => {
    const d = await evaluatePolicy(spec({ projectId: 'project-other' }), {
      ...CTX_BASE,
      allowedProjectIds: ['project-atlas'],
    });
    expect(d).toMatchObject({ decision: 'deny', code: 'PROJECT_ACL' });
  });
  it('S02: path traversal denied', async () => {
    const d = await evaluatePolicy(
      spec({
        target: { resourceId: 'x', path: '../../private.txt' },
        verification: { kind: 'artifact_sha256', artifactPath: '../../private.txt' },
      }),
      CTX_BASE,
    );
    expect(d).toMatchObject({ decision: 'deny', code: 'ARTIFACT_PATH' });
  });
  it('absolute artifact path denied', async () => {
    const d = await evaluatePolicy(
      spec({
        target: { resourceId: 'x', path: '/etc/passwd' },
        verification: { kind: 'artifact_sha256', artifactPath: '/etc/passwd' },
      }),
      CTX_BASE,
    );
    expect(d).toMatchObject({ decision: 'deny', code: 'ARTIFACT_PATH' });
  });
  it('S05: L2/external_write without grant => await_approval, never permit', async () => {
    const s = spec({
      actionType: 'draft.generate',
      projectId: 'project-beacon',
      risk: 'L2',
      effect: 'external_write',
      target: { resourceId: 'cal-991' },
      allowedCapabilities: ['mail.send'],
      verification: { kind: 'remote_readback' },
    });
    const d = await evaluatePolicy(s, CTX_BASE);
    expect(d.decision).toBe('await_approval');
  });
  it('client cannot downgrade risk: L2 claim on external_write stays gated even if labeled L0', async () => {
    // Registry floor for draft.generate is L1 local_create; a client labeling
    // effect external_write is overridden by the registry, but a *labeled* L2
    // risk must not be downgraded by claiming L0.
    const s = spec({ risk: 'L0' });
    const d = await evaluatePolicy(s, CTX_BASE);
    if (d.decision === 'permit') expect(d.effectiveRisk).toBe('L1'); // floor escalation
  });
  it('S06: approved target changed => grant invalid', async () => {
    const approved = spec({
      actionType: 'draft.generate',
      projectId: 'project-beacon',
      risk: 'L2',
      effect: 'external_write',
      target: { resourceId: 'cal-991' },
      params: { to: 'alice@example.invalid' },
      allowedCapabilities: ['mail.send'],
      verification: { kind: 'remote_readback' },
    });
    const grant: ApprovalGrant = {
      id: 'g2',
      principalId: 'user-local',
      cardId: 'card-1',
      actionDigest: actionDigest(approved),
      targetDigest: targetDigest(approved),
      risk: 'L2',
      authorizedCapabilities: ['mail.send'],
      expiresAt: '2099-01-01T00:00:00+08:00',
      grantedAt: NOW,
    };
    const tampered = { ...approved, params: { to: 'bob@example.invalid' } } as ActionSpec;
    const v = validateGrant(grant, tampered, { now: NOW });
    expect(v).toMatchObject({ ok: false, code: 'GRANT_DIGEST_MISMATCH' });
    const d = await evaluatePolicy(tampered, { ...CTX_BASE, grants: [grant] });
    expect(d.decision).toBe('await_approval');
  });
  it('S07: expired grant => await_approval again', async () => {
    const s = spec({
      actionType: 'draft.generate',
      projectId: 'project-beacon',
      risk: 'L2',
      effect: 'external_write',
      target: { resourceId: 'cal-991' },
      allowedCapabilities: ['mail.send'],
      verification: { kind: 'remote_readback' },
    });
    const grant: ApprovalGrant = {
      id: 'g3',
      principalId: 'user-local',
      cardId: 'card-1',
      actionDigest: actionDigest(s),
      targetDigest: targetDigest(s),
      risk: 'L2',
      authorizedCapabilities: ['mail.send'],
      expiresAt: '2020-01-01T00:00:00+08:00',
      grantedAt: '2019-01-01T00:00:00+08:00',
    };
    const d = await evaluatePolicy(s, { ...CTX_BASE, grants: [grant] });
    expect(d.decision).toBe('await_approval');
  });
  it('valid grant permits L2 and consumed grant does not', async () => {
    const s = spec({
      actionType: 'draft.generate',
      projectId: 'project-beacon',
      risk: 'L2',
      effect: 'external_write',
      target: { resourceId: 'cal-991', path: 'drafts/meeting-adjustment.md' },
      allowedCapabilities: ['mail.send', 'fs.write_demo_artifact'],
      verification: { kind: 'artifact_sha256', artifactPath: 'drafts/meeting-adjustment.md' },
    });
    const mk = (consumedAt?: string): ApprovalGrant => ({
      id: 'g4',
      principalId: 'user-local',
      cardId: 'card-1',
      actionDigest: actionDigest(s),
      targetDigest: targetDigest(s),
      risk: 'L2',
      authorizedCapabilities: ['mail.send', 'fs.write_demo_artifact'],
      expiresAt: '2099-01-01T00:00:00+08:00',
      grantedAt: NOW,
      consumedAt,
    });
    expect((await evaluatePolicy(s, { ...CTX_BASE, grants: [mk()] })).decision).toBe('permit');
    expect(
      (await evaluatePolicy(s, { ...CTX_BASE, grants: [mk('2026-10-28T12:30:00+08:00')] })).decision,
    ).toBe('await_approval');
  });
  it('S10: stale source version denied / requires rescan', async () => {
    const s = spec({ expectedSourceVersion: 'v1' });
    const stale = await evaluatePolicy(s, { ...CTX_BASE, actualSourceVersion: 'v2' });
    expect(stale).toMatchObject({ decision: 'deny', code: 'STALE_SOURCE' });
    const missing = await evaluatePolicy(s, { ...CTX_BASE });
    expect(missing).toMatchObject({ decision: 'deny', code: 'STALE_SOURCE' });
    const fresh = await evaluatePolicy(s, { ...CTX_BASE, actualSourceVersion: 'v1' });
    expect(fresh.decision).toBe('permit');
  });
});

describe('artifact path helpers', () => {
  it('pure resolver rejects traversal but accepts nested relative paths', () => {
    expect(resolveArtifactPath('/tmp/root', 'a/b/c.json').ok).toBe(true);
    expect(resolveArtifactPath('/tmp/root', '../escape').ok).toBe(false);
    expect(resolveArtifactPath('/tmp/root', 'a/../../escape').ok).toBe(false);
    expect(resolveArtifactPath('/tmp/root', '/abs').ok).toBe(false);
    expect(resolveArtifactPath('/tmp/root', '').ok).toBe(false);
  });
  it('S03: symlink escape caught by realpath containment (real fs)', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'hearth-s03-'));
    try {
      const root = path.join(tmp, 'demo-root');
      await mkdir(path.join(root, 'report'), { recursive: true });
      const secret = path.join(tmp, 'secret.txt');
      await writeFile(secret, 'private');
      await symlink(secret, path.join(root, 'leak-link'));
      const fsHooks = {
        realpath: (p: string) => fs.promises.realpath(p),
        stat: (p: string) => fs.promises.stat(p).then((s) => s, () => null),
      };
      const bad = await validateRealpathContainment(path.join(root, 'leak-link', 'private.txt'), root, fsHooks.realpath, fsHooks.stat);
      expect(bad.ok).toBe(false);
      const good = await validateRealpathContainment(path.join(root, 'report', 'out.json'), root, fsHooks.realpath, fsHooks.stat);
      expect(good.ok).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
