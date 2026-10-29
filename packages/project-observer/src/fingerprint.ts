/**
 * @fileoverview 项目可观测状态指纹计算（Snapshot Fingerprint）
 * 严格排除观察时间戳（observedAt）与主键 ID，仅对状态语义内容进行规范化 JSON 序列化并计算 SHA-256。
 * 若项目状态未变，计算出的指纹完全相同，从而实现零误报幂等。
 */

import type { ProjectSnapshot } from './contracts.js';
import { sha256Hex } from './ids.js';

/** 规范化 JSON 编码 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * 计算项目状态的确定性 SHA-256 指纹
 * @param snapshot 剔除元数据后的核心状态
 * @returns 64位十六进制哈希指纹
 */
export function snapshotFingerprint(
  snapshot: Omit<ProjectSnapshot, 'id' | 'projectId' | 'observedAt' | 'fingerprint'>,
): string {
  return sha256Hex(
    canonicalJson({
      accessibility: snapshot.accessibility,
      headSha: snapshot.headSha,
      branch: snapshot.branch,
      detached: snapshot.detached,
      unborn: snapshot.unborn,
      gitIdentity: snapshot.gitIdentity,
      worktree: snapshot.worktree,
      test: {
        result: snapshot.test.result,
        evidenceQuality: snapshot.test.evidenceQuality,
        headBound: snapshot.test.headBound,
        stale: snapshot.test.stale,
        tests: snapshot.test.tests ?? null,
        passed: snapshot.test.passed ?? null,
        failed: snapshot.test.failed ?? null,
        skipped: snapshot.test.skipped ?? null,
        errors: snapshot.test.errors ?? null,
        reportFingerprint: snapshot.test.reportFingerprint ?? null,
        relativePath: snapshot.test.relativePath ?? null,
      },
    }),
  );
}
