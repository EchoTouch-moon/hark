import { EXTRACTOR_VERSION, type EvidenceRef, type Signal, type SignalKind } from '../contracts.js';

const NOW = '2026-10-28T10:00:00.000Z';

export function triggerRef(projectId: string, eventId: string, observedAt = NOW): EvidenceRef {
  return {
    kind: 'observer_event',
    projectId,
    id: eventId,
    observedAt,
    quality: 'OBSERVED',
    role: 'trigger',
  };
}

export function makeSignal(overrides: Partial<Signal> & Pick<Signal, 'kind' | 'signalKey'>): Signal {
  const projectId = overrides.projectId ?? 'prj_aaaaaaaaaaaaaaaa';
  const eventId = overrides.sourceEventIds?.[0] ?? 'evt_aaaaaaaaaaaaaaaa';
  return {
    projectId,
    observedAt: NOW,
    sourceEventIds: [eventId],
    evidenceQuality: 'OBSERVED',
    comparable: false,
    headBinding: 'UNDETERMINED',
    facts: {},
    streamEpoch: 1,
    appendSeq: 1,
    subject: 'git:head',
    extractorVersion: EXTRACTOR_VERSION,
    evidenceRefs: [triggerRef(projectId, eventId)],
    ...overrides,
  };
}

export function testFailSignal(relativePath = 'reports/junit.xml', failed = 2): Signal {
  return makeSignal({
    kind: 'TEST_REPORT_FAILURE_OBSERVED' satisfies SignalKind,
    signalKey: 'b'.repeat(64),
    subject: `reportSource:${relativePath}`,
    comparable: false,
    appendSeq: 2,
    facts: { relativePath, failed, errors: 0, headBound: false },
  });
}

export function testChangedSignal(input: {
  relativePath?: string;
  previousFailed: number;
  currentFailed: number;
  comparable?: boolean;
  signalKey?: string;
  appendSeq?: number;
}): Signal {
  const relativePath = input.relativePath ?? 'reports/junit.xml';
  return makeSignal({
    kind: 'TEST_REPORT_RESULT_CHANGED',
    signalKey: input.signalKey ?? 'c'.repeat(64),
    subject: `reportSource:${relativePath}`,
    comparable: input.comparable ?? true,
    appendSeq: input.appendSeq ?? 3,
    facts: {
      relativePath,
      previousFailed: input.previousFailed,
      currentFailed: input.currentFailed,
      headBound: false,
    },
  });
}
