import { ObserverError } from '../errors.js';
import { isIsoDateTime } from '../time.js';
import type { TestResult } from '../contracts.js';

export interface JunitCounts {
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  generatedAt?: string;
  result: TestResult;
}

function countTag(xml: string, tag: string): number {
  const matches = xml.match(new RegExp(`<${tag}\\b`, 'gi'));
  return matches?.length ?? 0;
}

function firstAttr(xml: string, attr: string): string | undefined {
  const match = xml.match(new RegExp(`\\b${attr}="([^"]*)"`, 'i'));
  return match?.[1];
}

/**
 * Constrained JUnit XML reader. Rejects DOCTYPE/ENTITY, never keeps failure text.
 */
export function parseJunitXml(xml: string): JunitCounts {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new ObserverError('REPORT_PARSE_ERROR', 'DOCTYPE/ENTITY is not allowed in test reports');
  }
  if (!/<testsuites\b|<testsuite\b|<testcase\b/i.test(xml)) {
    throw new ObserverError('REPORT_PARSE_ERROR', 'document is not a JUnit report');
  }

  const tests = countTag(xml, 'testcase');
  const skipped = countTag(xml, 'skipped');
  const failures = countTag(xml, 'failure');
  const errors = countTag(xml, 'error');
  const failedCases = Math.min(tests, failures + errors);
  const passed = Math.max(0, tests - failedCases - skipped);

  const result: TestResult =
    tests === 0 ? 'UNKNOWN' : failedCases === 0 ? 'PASS' : passed === 0 ? 'FAIL' : 'MIXED';

  const timestamp = firstAttr(xml, 'timestamp');
  let generatedAt: string | undefined;
  if (timestamp !== undefined) {
    const isoCandidate = timestamp.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`;
    if (isIsoDateTime(isoCandidate) && !Number.isNaN(Date.parse(isoCandidate))) {
      generatedAt = isoCandidate;
    }
  }

  return {
    tests,
    passed,
    failed: Math.min(tests, failures),
    skipped,
    errors,
    generatedAt,
    result,
  };
}
