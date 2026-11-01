#!/usr/bin/env node
/**
 * The `ci-gate` decision: turn a set of upstream job results into one verdict.
 *
 * Why this is a script and not inline bash
 * ----------------------------------------
 * This is the single most security relevant line of the pipeline. If it is wrong,
 * a broken branch reports green. Keeping it here lets the exact rule set be unit
 * tested and reviewed; the workflow only wires up inputs.
 *
 * The rule set
 * ------------
 *  1. Change detection must have succeeded. If it did not, we know nothing about
 *     what should have run, so nothing downstream can justify green.
 *  2. Every verification job must have succeeded.
 *  3. `skipped` is allowed ONLY when detection proved the diff is documentation.
 *     A skipped heavy job on a real code change means the matrix was misconfigured
 *     and must fail rather than quietly pass.
 *  4. `cancelled` is failure. A cancelled job proved nothing; treating it as benign
 *     is how a red pull request disappears from the checks list instead of being
 *     fixed.
 *  5. Anything unrecognised is failure. The safe direction is always red.
 */

import { pathToFileURL } from 'node:url';

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped';

export interface UpstreamJob {
  name: string;
  result: string;
}

export interface GateInput {
  /** Result of the change-detection job. */
  detect: string;
  /** The verification jobs that were supposed to run. */
  jobs: UpstreamJob[];
  /** True only when change detection classified the diff as documentation-only. */
  skipHeavy: boolean;
}

export interface GateVerdict {
  ok: boolean;
  errors: string[];
}

const KNOWN: readonly JobResult[] = ['success', 'failure', 'cancelled', 'skipped'];

export function decideGate(input: GateInput): GateVerdict {
  const errors: string[] = [];

  const detect = String(input.detect ?? '');
  if (detect !== 'success') {
    errors.push(`change detection did not succeed (${describe(detect)}); refusing to report green`);
  }

  for (const job of input.jobs) {
    const result = String(job.result ?? '');
    if (!KNOWN.includes(result as JobResult)) {
      errors.push(`${job.name}: unrecognised result "${describe(result)}"; treated as failure`);
      continue;
    }
    switch (result as JobResult) {
      case 'success':
        break;
      case 'skipped':
        if (!input.skipHeavy) {
          errors.push(
            `${job.name}: verification was skipped although the change required it; ` +
              `the job matrix is misconfigured`,
          );
        }
        break;
      case 'failure':
        errors.push(`${job.name}: verification failed`);
        break;
      case 'cancelled':
        errors.push(`${job.name}: verification was cancelled; treated as failure`);
        break;
    }
  }

  return { ok: errors.length === 0, errors };
}

const describe = (value: string): string => (value.length === 0 ? 'missing' : value);

/** Annotations for the job log. `::error::` makes them surface in the UI too. */
export function renderVerdict(verdict: GateVerdict): string {
  if (verdict.ok) return 'ci-gate: passed\n';
  return `${verdict.errors.map((e) => `::error::${e}`).join('\n')}\nci-gate: failed\n`;
}

/* ------------------------------- CLI entry ------------------------------- */

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
};

if (isDirectRun()) {
  const verdict = decideGate({
    detect: process.env.DETECT ?? '',
    skipHeavy: process.env.SKIP_HEAVY === 'true',
    jobs: [
      { name: 'verify-linux', result: process.env.LINUX ?? '' },
      { name: 'verify-windows', result: process.env.WINDOWS ?? '' },
    ],
  });

  const summary = [
    `detect-changes=${process.env.DETECT ?? ''}`,
    `verify-linux=${process.env.LINUX ?? ''}`,
    `verify-windows=${process.env.WINDOWS ?? ''}`,
    `skip-heavy=${process.env.SKIP_HEAVY ?? ''}`,
  ].join(' ');
  process.stdout.write(`${summary}\n`);
  process.stdout.write(renderVerdict(verdict));
  process.exitCode = verdict.ok ? 0 : 1;
}
