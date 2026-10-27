import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IndependentVerifier } from './verifier.js';
import type { ActionSpec } from '@hearth/contracts';

let root: string;
let verifier: IndependentVerifier;

function spec(overrides: Partial<ActionSpec> = {}): ActionSpec {
  return {
    id: 'act-1',
    actionType: 'report.generate',
    projectId: 'project-atlas',
    target: { resourceId: 'ci-42', path: 'report/ci-42.json' },
    params: {},
    allowedCapabilities: ['fs.write_demo_artifact'],
    risk: 'L1',
    effect: 'local_create',
    maxSteps: 4,
    timeoutMs: 5000,
    maxCostUsd: 0,
    idempotencyKey: 'a'.repeat(64),
    verification: { kind: 'json_schema', artifactPath: 'report/ci-42.json' },
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hearth-verify-'));
  verifier = new IndependentVerifier(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('IndependentVerifier (S11)', () => {
  it('passes a genuine artifact with matching hash and json schema', async () => {
    await mkdir(path.join(root, 'report'), { recursive: true });
    const content = JSON.stringify({
      generatedAt: '2026-10-28T12:00:00Z',
      projectId: 'project-atlas',
      actionType: 'report.generate',
      findings: [],
    });
    await writeFile(path.join(root, 'report/ci-42.json'), content);
    const { sha256Hex } = await import('@hearth/contracts');
    const result = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json', sha256: sha256Hex(content) });
    expect(result.verdict).toBe('pass');
    expect(result.kind).toBe('json_schema');
  });

  it('S11: executor claims completion but artifact missing => fail', async () => {
    const result = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json', sha256: 'b'.repeat(64) });
    expect(result.verdict).toBe('fail');
    expect(result.kind).toBe('artifact-missing');
  });

  it('hash mismatch between claim and recompute => fail', async () => {
    await mkdir(path.join(root, 'report'), { recursive: true });
    await writeFile(path.join(root, 'report/ci-42.json'), '{}');
    const result = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json', sha256: 'c'.repeat(64) });
    expect(result.verdict).toBe('fail');
    expect(result.kind).toBe('hash-mismatch');
  });

  it('empty artifact => fail', async () => {
    await mkdir(path.join(root, 'report'), { recursive: true });
    await writeFile(path.join(root, 'report/ci-42.json'), '   ');
    const result = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json' });
    expect(result.verdict).toBe('fail');
    expect(result.kind).toBe('artifact-empty');
  });

  it('json schema violations (missing field / wrong actionType) => fail', async () => {
    await mkdir(path.join(root, 'report'), { recursive: true });
    await writeFile(path.join(root, 'report/ci-42.json'), JSON.stringify({ generatedAt: 'x', projectId: 'p' }));
    const r1 = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json' });
    expect(r1).toMatchObject({ verdict: 'fail', kind: 'json-schema' });

    await writeFile(
      path.join(root, 'report/ci-42.json'),
      JSON.stringify({ generatedAt: 'x', projectId: 'p', actionType: 'draft.generate' }),
    );
    const r2 = await verifier.verify(spec(), { ok: true, artifactRelPath: 'report/ci-42.json' });
    expect(r2).toMatchObject({ verdict: 'fail' });
  });

  it('path escaping artifact root is rejected before any read', async () => {
    const result = await verifier.verify(spec({ verification: { kind: 'artifact_sha256', artifactPath: '../escape.txt' } }), {
      ok: true,
      artifactRelPath: '../escape.txt',
    });
    expect(result.verdict).toBe('fail');
    expect(result.kind).toBe('artifact-path');
  });
});
