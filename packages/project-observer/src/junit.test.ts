import { describe, expect, it } from 'vitest';
import { parseJunitXml } from './reports/junit.js';
import { SAMPLE_JUNIT_FAIL, SAMPLE_JUNIT_PASS } from './testkit/git-fixture.js';
import { ObserverError } from './errors.js';

describe('JUnit parser', () => {
  it('reads pass counts without keeping stdout', () => {
    const parsed = parseJunitXml(SAMPLE_JUNIT_PASS);
    expect(parsed).toMatchObject({ tests: 2, passed: 2, failed: 0, skipped: 0, result: 'PASS' });
    expect(parsed.generatedAt).toBe('2026-10-28T08:00:00Z');
  });

  it('classifies mixed/fail and drops failure text', () => {
    const parsed = parseJunitXml(SAMPLE_JUNIT_FAIL);
    expect(parsed.result).toBe('MIXED');
    expect(JSON.stringify(parsed)).not.toContain('secret-should-not-be-stored');
  });

  it('rejects entity expansion vectors', () => {
    expect(() => parseJunitXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuites/>')).toThrow(
      ObserverError,
    );
  });
});
