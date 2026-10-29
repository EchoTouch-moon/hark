import { SaxesParser } from 'saxes';
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

export const MAX_JUNIT_BYTES = 16 * 1024 * 1024;
export const MAX_JUNIT_DEPTH = 64;
export const MAX_JUNIT_NODES = 200_000;

type Counts = Pick<JunitCounts, 'tests' | 'passed' | 'failed' | 'skipped' | 'errors'>;
interface Frame {
  name: string;
  attributes: Record<string, string>;
  counts: Counts;
  outcome?: 'failed' | 'errors' | 'skipped';
}
const emptyCounts = (): Counts => ({ tests: 0, passed: 0, failed: 0, skipped: 0, errors: 0 });
function invalid(message: string): never { throw new ObserverError('REPORT_PARSE_ERROR', message); }
const isSuite = (name: string) => name === 'testsuite' || name === 'testsuites';

/** Strict, bounded SAX reader: no DTD/entities, no retained failure/stdout text. */
export function parseJunitXml(xml: string): JunitCounts {
  if (Buffer.byteLength(xml, 'utf8') > MAX_JUNIT_BYTES) invalid('JUnit report exceeds parser byte limit');
  const parser = new SaxesParser({ xmlns: false });
  const stack: Frame[] = [];
  let root: Frame | undefined;
  let generatedAt: string | undefined;
  let nodes = 0;
  parser.on('doctype', () => invalid('DOCTYPE/ENTITY is not allowed in test reports'));
  parser.on('error', () => invalid('JUnit XML is not well formed'));
  parser.on('opentag', (tag) => {
    nodes += 1;
    if (nodes > MAX_JUNIT_NODES || stack.length >= MAX_JUNIT_DEPTH) invalid('JUnit report exceeds structural limits');
    const parent = stack.at(-1);
    if (!parent && !isSuite(tag.name)) invalid('JUnit root must be testsuite or testsuites');
    if (isSuite(tag.name) && parent && !isSuite(parent.name)) invalid('JUnit suite is outside a suite');
    if (tag.name === 'testcase' && parent?.name !== 'testsuite') invalid('JUnit testcase is outside a testsuite');
    if (['failure', 'error', 'skipped'].includes(tag.name)) {
      if (parent?.name !== 'testcase') invalid('JUnit outcome is outside a testcase');
      if (parent.outcome) invalid('JUnit testcase has duplicate or conflicting outcomes');
      parent.outcome = tag.name === 'failure' ? 'failed' : tag.name === 'error' ? 'errors' : 'skipped';
    }
    if (generatedAt === undefined && isSuite(tag.name)) {
      const timestamp = tag.attributes['timestamp'];
      if (timestamp) {
        const candidate = timestamp.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`;
        if (isIsoDateTime(candidate) && !Number.isNaN(Date.parse(candidate))) generatedAt = candidate;
      }
    }
    stack.push({ name: tag.name, attributes: tag.attributes, counts: emptyCounts() });
  });
  parser.on('closetag', () => {
    const frame = stack.pop();
    if (!frame) invalid('JUnit close tag has no opening tag');
    if (frame.name === 'testcase') {
      frame.counts.tests = 1;
      frame.counts[frame.outcome ?? 'passed'] = 1;
    } else if (isSuite(frame.name)) {
      for (const [attribute, field] of [['tests', 'tests'], ['failures', 'failed'], ['errors', 'errors'], ['skipped', 'skipped']] as const) {
        const value = frame.attributes[attribute];
        if (value === undefined) continue;
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) !== frame.counts[field]) {
          invalid('JUnit aggregate counts do not match testcase outcomes');
        }
      }
    }
    const parent = stack.at(-1);
    if (parent) {
      for (const field of ['tests', 'passed', 'failed', 'skipped', 'errors'] as const) parent.counts[field] += frame.counts[field];
    } else root = frame;
  });
  try {
    parser.write(xml).close();
  } catch (cause) {
    if (cause instanceof ObserverError) throw cause;
    throw new ObserverError('REPORT_PARSE_ERROR', 'JUnit XML is not well formed');
  }
  if (!root || stack.length > 0) invalid('JUnit report is incomplete');
  const counts = root.counts;
  const failures = counts.failed + counts.errors;
  const result: TestResult = counts.tests === 0 || (counts.passed === 0 && failures === 0)
    ? 'UNKNOWN' : failures === 0 ? 'PASS' : counts.passed === 0 ? 'FAIL' : 'MIXED';
  return { ...counts, generatedAt, result };
}
