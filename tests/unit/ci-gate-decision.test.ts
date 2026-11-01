import { describe, expect, it } from 'vitest';
import { decideGate, renderVerdict, type GateInput } from '../../scripts/ci-gate-decision';

const gate = (over: Partial<GateInput> = {}): GateInput => ({
  detect: 'success',
  jobs: [
    { name: 'verify-linux', result: 'success' },
    { name: 'verify-windows', result: 'success' },
  ],
  skipHeavy: false,
  ...over,
});

describe('decideGate', () => {
  it('passes when detection and every verification job succeeded', () => {
    expect(decideGate(gate())).toEqual({ ok: true, errors: [] });
  });

  it('turns a failed verification into a red gate', () => {
    const verdict = decideGate(gate({ jobs: [{ name: 'verify-linux', result: 'failure' }] }));

    expect(verdict.ok).toBe(false);
    expect(verdict.errors[0]).toContain('verify-linux: verification failed');
  });

  it('treats a cancelled verification as failure, never as success', () => {
    // Regression guard for defect D5: `cancel-in-progress` produces real
    // cancelled runs. Those used to leave no verdict at all.
    const verdict = decideGate(gate({ jobs: [{ name: 'verify-windows', result: 'cancelled' }] }));

    expect(verdict.ok).toBe(false);
    expect(verdict.errors[0]).toContain('cancelled');
  });

  it('accepts skipped verification only for a documentation-only change', () => {
    const skipped = [
      { name: 'verify-linux', result: 'skipped' },
      { name: 'verify-windows', result: 'skipped' },
    ];

    expect(decideGate(gate({ jobs: skipped, skipHeavy: true })).ok).toBe(true);

    const wrong = decideGate(gate({ jobs: skipped, skipHeavy: false }));
    expect(wrong.ok).toBe(false);
    expect(wrong.errors[0]).toContain('skipped although the change required it');
  });

  it('refuses green when change detection itself did not succeed', () => {
    for (const detect of ['failure', 'cancelled', 'skipped', '']) {
      const verdict = decideGate(gate({ detect, jobs: [], skipHeavy: true }));
      expect(verdict.ok, `detect=${detect}`).toBe(false);
      expect(verdict.errors[0]).toContain('change detection did not succeed');
    }
  });

  it('fails on any unrecognised job result', () => {
    for (const result of ['', 'unknown', 'SUCCESS']) {
      const verdict = decideGate(gate({ jobs: [{ name: 'verify-linux', result }] }));
      expect(verdict.ok, `result=${result}`).toBe(false);
      expect(verdict.errors[0]).toContain('unrecognised result');
    }
  });

  it('reports every problem rather than stopping at the first', () => {
    const verdict = decideGate(
      gate({ jobs: [{ name: 'verify-linux', result: 'failure' }, { name: 'verify-windows', result: 'cancelled' }] }),
    );

    expect(verdict.errors).toHaveLength(2);
  });
});

describe('renderVerdict', () => {
  it('annotates failures so they surface in the Actions UI', () => {
    const out = renderVerdict(decideGate(gate({ jobs: [{ name: 'verify-linux', result: 'failure' }] })));

    expect(out).toContain('::error::');
    expect(out).toContain('ci-gate: failed');
  });

  it('reports a clean pass without any error annotation', () => {
    const out = renderVerdict(decideGate(gate()));

    expect(out).not.toContain('::error::');
    expect(out).toContain('ci-gate: passed');
  });
});
