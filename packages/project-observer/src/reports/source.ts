import { unknownTestSummary, type TestSummary } from '../contracts.js';
import { ObserverError } from '../errors.js';
import { sha256Hex } from '../ids.js';
import { readFileInsideRoot } from '../paths.js';
import { redactText } from '../redact.js';
import { toIsoUtc } from '../time.js';
import { parseJunitXml } from './junit.js';

export interface ReportScanResult {
  summary: TestSummary;
  adapterError?: { errorCode: string; errorMessage: string };
}

export class TestReportSource {
  constructor(private readonly maxBytes: number = 16 * 1024 * 1024) {}

  scan(root: string, relativePath: string, observedAt: string, headChangedAt: string | null): ReportScanResult {
    try {
      const opened = readFileInsideRoot(root, relativePath, this.maxBytes);
      const parsed = parseJunitXml(opened.bytes.toString('utf8'));
      const mtimeIso = toIsoUtc(opened.mtime);
      const generatedAt = parsed.generatedAt ?? mtimeIso;
      const sourceTimeKind = parsed.generatedAt !== undefined ? 'report_timestamp' : 'file_mtime';
      const stale = headChangedAt !== null && Date.parse(generatedAt) <= Date.parse(headChangedAt);
      return {
        summary: {
          result: parsed.result,
          evidenceQuality: stale ? 'STALE' : 'OBSERVED',
          headBound: false,
          stale,
          tests: parsed.tests,
          passed: parsed.passed,
          failed: parsed.failed,
          skipped: parsed.skipped,
          errors: parsed.errors,
          generatedAt,
          observedAt,
          reportFingerprint: sha256Hex(opened.bytes),
          relativePath,
          sourceTimeKind,
        },
      };
    } catch (cause) {
      if (cause instanceof ObserverError && cause.code === 'PATH_NOT_FOUND') {
        return { summary: unknownTestSummary() };
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      const code = cause instanceof ObserverError ? cause.code : 'REPORT_INVALID';
      const mapped = code === 'REPORT_PARSE_ERROR' ? 'REPORT_INVALID' : code;
      return {
        summary: unknownTestSummary(),
        adapterError: { errorCode: mapped, errorMessage: redactText(message) },
      };
    }
  }
}
