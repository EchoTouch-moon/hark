/**
 * @fileoverview 独立产物验证器（Independent Verifier，S11）
 * 绝不信任执行器的自我汇报。独立核验器从磁盘物理读取产物文件，
 * 重新计算 SHA-256 哈希值或校验 JSON Schema，核验通过才允许任务进入 completed 终态。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionSpec } from '@hearth/contracts';
import { sha256Hex } from '@hearth/contracts';
import { resolveArtifactPath } from '../policy/artifact-path.js';
import type { ExecutorResult } from '../orchestration/executor.js';

/** 验证裁决结果：pass(通过), fail(失败), unknown(未知) */
export type VerifyVerdict = 'pass' | 'fail' | 'unknown';

/** 验证详细报告结构 */
export interface VerifyResult {
  verdict: VerifyVerdict;
  kind: string;
  sha256?: string;
  artifactPath?: string;
  reason?: string;
}

/**
 * 独立物理产物验证器
 * 从磁盘重新读取产物并重新计算哈希与校验结构
 */
export class IndependentVerifier {
  constructor(private readonly artifactRoot: string) {}

  async verify(spec: ActionSpec, result: ExecutorResult): Promise<VerifyResult> {
    const rel = result.artifactRelPath ?? spec.verification.artifactPath;
    if (!rel) {
      return { verdict: 'unknown', kind: 'no-artifact', reason: 'no artifact path claimed' };
    }
    const resolved = resolveArtifactPath(this.artifactRoot, rel);
    if (!resolved.ok) {
      return { verdict: 'fail', kind: 'artifact-path', reason: resolved.reason };
    }
    let content: string;
    try {
      content = await readFile(resolved.absPath, 'utf8');
    } catch (err) {
      return { verdict: 'fail', kind: 'artifact-missing', reason: `artifact not readable: ${String(err)}` };
    }
    if (content.trim().length === 0) {
      return { verdict: 'fail', kind: 'artifact-empty', reason: 'artifact is empty' };
    }
    const hash = sha256Hex(content);
    if (result.sha256 && result.sha256 !== hash) {
      return { verdict: 'fail', kind: 'hash-mismatch', reason: 'recomputed hash differs from executor claim', sha256: hash };
    }
    if (spec.verification.kind === 'json_schema') {
      return this.verifyJsonSchema(spec, content, hash, resolved.relPath);
    }
    return { verdict: 'pass', kind: 'artifact_sha256', sha256: hash, artifactPath: resolved.relPath };
  }

  private verifyJsonSchema(spec: ActionSpec, content: string, hash: string, relPath: string): VerifyResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { verdict: 'fail', kind: 'json-parse', reason: 'artifact is not valid JSON', sha256: hash };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { verdict: 'fail', kind: 'json-shape', reason: 'artifact root not an object', sha256: hash };
    }
    const obj = parsed as Record<string, unknown>;
    const required = ['generatedAt', 'projectId', 'actionType'];
    const missing = required.filter((k) => !(k in obj));
    if (missing.length > 0) {
      return { verdict: 'fail', kind: 'json-schema', reason: `missing fields: ${missing.join(',')}`, sha256: hash };
    }
    if (obj['actionType'] !== spec.actionType) {
      return { verdict: 'fail', kind: 'json-schema', reason: 'actionType mismatch', sha256: hash };
    }
    return { verdict: 'pass', kind: 'json_schema', sha256: hash, artifactPath: relPath };
  }

  artifactAbsPath(rel: string): string | null {
    const resolved = resolveArtifactPath(this.artifactRoot, rel);
    return resolved.ok ? resolved.absPath : null;
  }
}

export { path as pathUtil };
