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

describe('R0 strict JUnit validation', () => {
  it.each([
    '<testsuite><testcase name="a"/>',
    '<testsuite><testcase></testsuite>',
    '<testsuite><testcase name="a"/></testsuite><testsuite/>',
    '<testsuite tests="3"><testcase/></testsuite>',
    '<testsuite failures="0"><testcase><failure/></testcase></testsuite>',
    '<testsuite><testcase><failure/><error/></testcase></testsuite>',
    '<testsuite><testcase><failure/><failure/></testcase></testsuite>',
    '<testsuite><testcase><skipped/><failure/></testcase></testsuite>',
    '<testsuite><system-out><testcase/></system-out></testsuite>',
    '<testsuite><testcase name="&notdefined;"/></testsuite>',
  ])('rejects malformed or contradictory report %s', (xml) => {
    expect(() => parseJunitXml(xml)).toThrow(ObserverError);
  });

  it('does not count tags in comments or CDATA as testcase outcomes', () => {
    const result = parseJunitXml('<testsuite tests="1"><!-- <testcase><failure/></testcase> --><testcase name="ok"/><system-out><![CDATA[<failure/>]]></system-out></testsuite>');
    expect(result).toMatchObject({ tests: 1, passed: 1, failed: 0, result: 'PASS' });
  });

  it('validates nested suite counts without double-counting', () => {
    const result = parseJunitXml('<testsuites tests="3" failures="1" errors="1" skipped="1"><testsuite tests="2" failures="1" errors="1"><testcase><failure/></testcase><testcase><error/></testcase></testsuite><testsuite tests="1" skipped="1"><testcase><skipped/></testcase></testsuite></testsuites>');
    expect(result).toMatchObject({ tests: 3, passed: 0, failed: 1, errors: 1, skipped: 1, result: 'FAIL' });
  });

  it('does not call skipped-only or empty suites PASS', () => {
    expect(parseJunitXml('<testsuite><testcase><skipped/></testcase></testsuite>').result).toBe('UNKNOWN');
    expect(parseJunitXml('<testsuites/>').result).toBe('UNKNOWN');
  });

  it('rejects excessive nesting and bytes', () => {
    const nested = '<testsuite>'.repeat(65) + '</testsuite>'.repeat(65);
    expect(() => parseJunitXml(nested)).toThrow(ObserverError);
    expect(() => parseJunitXml('<testsuite>' + ' '.repeat(16 * 1024 * 1024) + '</testsuite>')).toThrow(ObserverError);
  });
});
