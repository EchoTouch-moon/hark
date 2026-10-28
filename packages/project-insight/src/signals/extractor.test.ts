import { describe, expect, it } from 'vitest';
import type { ObserverEvent } from '@hearth/project-observer';
import { EXTRACTOR_VERSION, ExtractedSignalSchema } from '../contracts.js';
import { extractSignalsFromEvent, signalKeyFor } from './extractor.js';

const NOW = '2026-10-28T10:00:00.000Z';

function event(overrides: Partial<ObserverEvent> & Pick<ObserverEvent, 'type'>): ObserverEvent {
  return {
    eventId: 'evt_aaaaaaaaaaaaaaaa',
    projectId: 'prj_aaaaaaaaaaaaaaaa',
    observedAt: NOW,
    fromSnapshotId: 'snap_aaaaaaaaaaaaaaaa',
    toSnapshotId: 'snap_bbbbbbbbbbbbbbbb',
    payload: {},
    evidence: { source: 'git', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'OBSERVED' },
    appendSeq: 7,
    ...overrides,
  };
}

const ctx = {
  streamEpoch: 1,
  fromSnapshot: null,
  toSnapshot: null,
  legacyOrderReconstructed: false,
};

describe('signal extractor', () => {
  it('rebuilds the same identity for the same event', () => {
    const source = event({
      type: 'REPOSITORY_HEAD_CHANGED',
      payload: { previous: 'aaa', current: 'bbb', fastForward: true },
    });
    const a = extractSignalsFromEvent(source, ctx);
    const b = extractSignalsFromEvent(source, ctx);
    expect(a).toEqual(b);
    expect(a[0]?.signalKey).toBe(
      signalKeyFor({
        projectId: source.projectId,
        streamEpoch: 1,
        sourceEventId: source.eventId,
        kind: 'REPOSITORY_HEAD_CHANGED',
        subject: 'git:head',
      }),
    );
    expect(ExtractedSignalSchema.parse(a[0]!)).toMatchObject({ extractorVersion: EXTRACTOR_VERSION });
  });

  it('keeps headBinding UNDETERMINED even when headBound is false', () => {
    const source = event({
      type: 'TEST_REPORT_UPDATED',
      evidence: { source: 'junit', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'OBSERVED' },
      payload: {
        previous: {
          result: 'PASS',
          evidenceQuality: 'OBSERVED',
          headBound: false,
          stale: false,
          tests: 2,
          passed: 2,
          failed: 0,
          errors: 0,
          skipped: 0,
          reportFingerprint: 'a'.repeat(64),
          relativePath: 'reports/junit.xml',
        },
        current: {
          result: 'FAIL',
          evidenceQuality: 'OBSERVED',
          headBound: false,
          stale: false,
          tests: 2,
          passed: 1,
          failed: 1,
          errors: 0,
          skipped: 0,
          reportFingerprint: 'b'.repeat(64),
          relativePath: 'reports/junit.xml',
        },
      },
    });
    const signals = extractSignalsFromEvent(source, ctx);
    expect(signals.map((item) => item.kind).sort()).toEqual([
      'TEST_REPORT_FAILURE_OBSERVED',
      'TEST_REPORT_RESULT_CHANGED',
    ]);
    expect(signals.every((item) => item.headBinding === 'UNDETERMINED')).toBe(true);
    expect(signals.every((item) => item.subject === 'reportSource:reports/junit.xml')).toBe(true);
    expect(signals.some((item) => item.kind === 'TEST_EVIDENCE_NOT_CURRENT')).toBe(false);
  });

  it('does not mix two JUnit relative paths', () => {
    const a = extractSignalsFromEvent(
      event({
        type: 'TEST_REPORT_UPDATED',
        eventId: 'evt_aaaaaaaaaaaaaaaa',
        evidence: { source: 'junit', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'OBSERVED' },
        payload: {
          previous: {
            result: 'PASS',
            evidenceQuality: 'OBSERVED',
            headBound: false,
            stale: false,
            tests: 1,
            failed: 0,
            errors: 0,
            reportFingerprint: 'a'.repeat(64),
            relativePath: 'reports/a.xml',
          },
          current: {
            result: 'FAIL',
            evidenceQuality: 'OBSERVED',
            headBound: false,
            stale: false,
            tests: 1,
            failed: 1,
            errors: 0,
            reportFingerprint: 'b'.repeat(64),
            relativePath: 'reports/a.xml',
          },
        },
      }),
      ctx,
    );
    const b = extractSignalsFromEvent(
      event({
        type: 'TEST_REPORT_UPDATED',
        eventId: 'evt_bbbbbbbbbbbbbbbb',
        appendSeq: 8,
        evidence: { source: 'junit', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'OBSERVED' },
        payload: {
          previous: {
            result: 'PASS',
            evidenceQuality: 'OBSERVED',
            headBound: false,
            stale: false,
            tests: 1,
            failed: 0,
            errors: 0,
            reportFingerprint: 'c'.repeat(64),
            relativePath: 'reports/b.xml',
          },
          current: {
            result: 'FAIL',
            evidenceQuality: 'OBSERVED',
            headBound: false,
            stale: false,
            tests: 1,
            failed: 1,
            errors: 0,
            reportFingerprint: 'd'.repeat(64),
            relativePath: 'reports/b.xml',
          },
        },
      }),
      ctx,
    );
    expect(a[0]?.subject).toBe('reportSource:reports/a.xml');
    expect(b[0]?.subject).toBe('reportSource:reports/b.xml');
    expect(a[0]?.signalKey).not.toBe(b[0]?.signalKey);
  });

  it('skips PROJECT_REGISTERED and does not emit evidence-gap signals', () => {
    expect(extractSignalsFromEvent(event({ type: 'PROJECT_REGISTERED' }), ctx)).toEqual([]);
    const stalePass = event({
      type: 'TEST_REPORT_UPDATED',
      evidence: { source: 'junit', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'STALE' },
      payload: {
        previous: {
          result: 'PASS',
          evidenceQuality: 'STALE',
          headBound: false,
          stale: true,
          tests: 1,
          failed: 0,
          errors: 0,
          reportFingerprint: 'a'.repeat(64),
          relativePath: 'reports/junit.xml',
        },
        current: {
          result: 'PASS',
          evidenceQuality: 'STALE',
          headBound: false,
          stale: true,
          tests: 1,
          failed: 0,
          errors: 0,
          reportFingerprint: 'a'.repeat(64),
          relativePath: 'reports/junit.xml',
        },
      },
    });
    expect(extractSignalsFromEvent(stalePass, ctx).map((item) => item.kind)).not.toContain(
      'TEST_EVIDENCE_NOT_CURRENT',
    );
  });

  it('does not treat UNKNOWN test results as failures', () => {
    const signals = extractSignalsFromEvent(
      event({
        type: 'TEST_REPORT_UPDATED',
        evidence: { source: 'junit', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'UNKNOWN' },
        payload: {
          previous: {
            result: 'UNKNOWN',
            evidenceQuality: 'UNKNOWN',
            headBound: false,
            stale: false,
            sourceTimeKind: 'none',
          },
          current: {
            result: 'UNKNOWN',
            evidenceQuality: 'UNKNOWN',
            headBound: false,
            stale: false,
            sourceTimeKind: 'none',
            relativePath: 'reports/junit.xml',
          },
        },
      }),
      ctx,
    );
    expect(signals).toEqual([]);
  });

  it('marks reconstructed legacy order in facts without claiming insert time', () => {
    const signals = extractSignalsFromEvent(event({ type: 'OBSERVATION_GAP', payload: { gapMs: 10 } }), {
      ...ctx,
      legacyOrderReconstructed: true,
    });
    expect(signals[0]?.facts['orderUncertainty']).toBe('reconstructed_rowid');
    expect(signals[0]?.facts['legacyOrderReconstructed']).toBe(true);
  });
});
