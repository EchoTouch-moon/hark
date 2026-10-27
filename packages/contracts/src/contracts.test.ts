import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ActionSpecSchema,
  EventSchema,
  PanelSpecSchema,
  ApprovalGrantSchema,
  TaskRunSchema,
  ActionCardSchema,
  CandidateSchema,
  canonicalize,
  deriveIdempotencyKey,
  sha256Hex,
  actionDigest,
  targetDigest,
} from './index.js';

const SRC = {
  sourceType: 'fixture',
  uri: 'fixture://github/project-atlas/runs/42',
  sourceId: 'ci-42',
  observedAt: '2026-10-28T10:00:00+08:00',
};

const EVENT = {
  id: 'ev-atlas-ci-001',
  type: 'repo.ci_failed',
  projectId: 'project-atlas',
  source: SRC,
  occurredAt: '2026-10-28T09:58:00+08:00',
  observedAt: '2026-10-28T10:00:00+08:00',
  summary: '合成 PR #12 的 build job 失败，需要诊断错误',
  dedupeKey: 'atlas:ci:42:failed',
  sensitivity: 'public',
  provenance: 'tool_observed',
  tags: ['ci', 'blocker'],
};

function validActionSpec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-atlas-ci-diagnose',
    actionType: 'report.generate',
    projectId: 'project-atlas',
    target: { resourceId: 'ci-42', path: 'report/atlas-ci-42.json' },
    params: { runId: 42 },
    allowedCapabilities: ['fs.write_demo_artifact'],
    risk: 'L1',
    effect: 'local_create',
    maxSteps: 8,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: deriveIdempotencyKey({
      actionType: 'report.generate',
      projectId: 'project-atlas',
      target: { resourceId: 'ci-42', path: 'report/atlas-ci-42.json' },
      params: { runId: 42 },
    }),
    verification: { kind: 'artifact_sha256', artifactPath: 'report/atlas-ci-42.json' },
    ...overrides,
  };
}

describe('Event schema', () => {
  it('accepts a valid event', () => {
    expect(EventSchema.parse(EVENT)).toBeTruthy();
  });
  it('rejects unknown fields', () => {
    expect(EventSchema.safeParse({ ...EVENT, extra: 1 }).success).toBe(false);
  });
  it('rejects missing required fields', () => {
    const { dedupeKey: _drop, ...missing } = EVENT;
    expect(EventSchema.safeParse(missing).success).toBe(false);
  });
  it('rejects bad sensitivity enum', () => {
    expect(EventSchema.safeParse({ ...EVENT, sensitivity: 'secret' }).success).toBe(false);
  });
  it('rejects naive datetime without timezone', () => {
    expect(
      EventSchema.safeParse({ ...EVENT, occurredAt: '2026-10-28T09:58:00' }).success,
    ).toBe(false);
  });
  it('rejects non-fixture source types not in enum', () => {
    expect(
      EventSchema.safeParse({
        ...EVENT,
        source: { ...SRC, sourceType: 'filesystem' },
      }).success,
    ).toBe(false);
  });
});

describe('ActionSpec schema', () => {
  it('accepts a valid spec', () => {
    expect(ActionSpecSchema.parse(validActionSpec())).toBeTruthy();
  });
  it('rejects unknown fields', () => {
    expect(ActionSpecSchema.safeParse({ ...validActionSpec(), sneaky: true }).success).toBe(false);
  });
  it('rejects unknown actionType', () => {
    expect(
      ActionSpecSchema.safeParse(validActionSpec({ actionType: 'shell.execute' })).success,
    ).toBe(false);
  });
  it('rejects nonzero maxCostUsd (no paid model calls in P0)', () => {
    expect(ActionSpecSchema.safeParse(validActionSpec({ maxCostUsd: 1 })).success).toBe(false);
  });
  it('rejects malformed idempotency key', () => {
    expect(
      ActionSpecSchema.safeParse(validActionSpec({ idempotencyKey: 'not-a-sha' })).success,
    ).toBe(false);
  });
  it('rejects external_write masquerading with L0 risk mismatch is schema-legal (policy layer decides)', () => {
    // Schema allows any (risk, effect) pair; the policy engine enforces floors.
    const parsed = ActionSpecSchema.safeParse(validActionSpec({ effect: 'read' }));
    expect(parsed.success).toBe(true);
  });
});

describe('Candidate / Card / Run / Approval schemas', () => {
  const SPEC = validActionSpec();
  const CANDIDATE = {
    id: 'cand-001',
    projectId: 'project-atlas',
    eventIds: ['ev-atlas-ci-001'],
    title: '项目构建未通过',
    whyNow: 'CI 失败状态会阻断下一步合入',
    evidence: [SRC],
    suggestedAction: SPEC,
    score: 0.9,
    confidence: 0.9,
    risk: 'L1',
    expiresAt: '2026-10-29T12:00:00+08:00',
    suppressionKey: 'atlas:ci:42:failed',
    status: 'candidate',
  };

  it('accepts valid candidate, rejects unknown field', () => {
    expect(CandidateSchema.parse(CANDIDATE)).toBeTruthy();
    expect(CandidateSchema.safeParse({ ...CANDIDATE, nope: 1 }).success).toBe(false);
  });

  it('rejects score out of range', () => {
    expect(CandidateSchema.safeParse({ ...CANDIDATE, score: 1.5 }).success).toBe(false);
  });

  const CARD = {
    id: 'card-001',
    candidateId: 'cand-001',
    projectId: 'project-atlas',
    title: '项目构建未通过',
    whyNow: 'CI 失败状态会阻断下一步合入',
    evidence: [SRC],
    action: SPEC,
    createdAt: '2026-10-28T12:00:00+08:00',
    expiresAt: '2026-10-29T12:00:00+08:00',
    status: 'proposed',
  };
  it('accepts valid card, rejects invalid status', () => {
    expect(ActionCardSchema.parse(CARD)).toBeTruthy();
    expect(ActionCardSchema.safeParse({ ...CARD, status: 'flying' }).success).toBe(false);
    expect(ActionCardSchema.safeParse({ ...CARD, status: 'completed', userFeedback: 'useful' }).success).toBe(true);
  });

  const RUN = {
    id: 'run-001',
    cardId: 'card-001',
    actionId: SPEC.id,
    idempotencyKey: SPEC.idempotencyKey,
    state: 'queued',
    createdAt: '2026-10-28T12:01:00+08:00',
    resultArtifactRefs: [],
  };
  it('accepts valid run, rejects unknown field and bad verdict', () => {
    expect(TaskRunSchema.parse(RUN)).toBeTruthy();
    expect(TaskRunSchema.safeParse({ ...RUN, state: 'done' }).success).toBe(false);
    expect(TaskRunSchema.safeParse({ ...RUN, verificationVerdict: 'ok' }).success).toBe(false);
  });

  it('approval grant digests must be sha256 hex', () => {
    const grant = {
      id: 'appr-001',
      principalId: 'user-local',
      cardId: 'card-001',
      actionDigest: 'z'.repeat(64),
      targetDigest: 'a'.repeat(64),
      risk: 'L2',
      authorizedCapabilities: ['mail.send'],
      expiresAt: '2026-10-28T13:00:00+08:00',
      grantedAt: '2026-10-28T12:00:00+08:00',
    };
    expect(ApprovalGrantSchema.safeParse(grant).success).toBe(false);
    expect(
      ApprovalGrantSchema.safeParse({ ...grant, actionDigest: 'a'.repeat(64) }).success,
    ).toBe(true);
  });
});

describe('PanelSpec schema (S12)', () => {
  it('rejects script component type', () => {
    const panel = {
      id: 'panel-1',
      kind: 'metric',
      dataQueryId: 'q1',
      refreshSeconds: 60,
      components: [{ type: 'script', field: 'x', src: 'file:///private' }],
    };
    expect(PanelSpecSchema.safeParse(panel).success).toBe(false);
  });
  it('rejects unknown top-level field', () => {
    const panel = {
      id: 'panel-1',
      kind: 'metric',
      dataQueryId: 'q1',
      refreshSeconds: 60,
      components: [{ type: 'text', field: 'x' }],
      onclick: 'alert(1)',
    };
    expect(PanelSpecSchema.safeParse(panel).success).toBe(false);
  });
});

describe('canonical encoding and digests', () => {
  it('sha256 matches node:crypto vectors', () => {
    for (const s of ['', 'abc', JSON.stringify(EVENT), '你好世界'.repeat(50)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  it('canonicalize is key-order independent', () => {
    const a = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } };
    const b = { a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
  it('idempotency key changes when params change (S06 base)', () => {
    const base = {
      actionType: 'draft.generate',
      projectId: 'project-beacon',
      target: { resourceId: 'cal-991' },
      params: { to: 'alice@example.invalid' },
    };
    const changed = { ...base, params: { to: 'bob@example.invalid' } };
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey(changed));
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
  });
  it('action/target digests stable and distinct', () => {
    const spec = validActionSpec() as import('./index.js').ActionSpec;
    expect(actionDigest(spec)).toBe(actionDigest(spec));
    expect(targetDigest(spec)).toMatch(/^[a-f0-9]{64}$/);
    const other = validActionSpec({ target: { resourceId: 'ci-43' } }) as import('./index.js').ActionSpec;
    expect(targetDigest(spec)).not.toBe(targetDigest(other));
    expect(actionDigest(spec)).not.toBe(actionDigest(other));
  });
});
