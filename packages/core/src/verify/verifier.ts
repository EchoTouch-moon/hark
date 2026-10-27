import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionSpec } from '@hearth/contracts';
import { sha256Hex } from '@hearth/contracts';
import { resolveArtifactPath } from '../policy/artifact-path.js';
import type { ExecutorResult } from '../orchestration/executor.js';

export type VerifyVerdict = 'pass' | 'fail' | 'unknown';

export interface VerifyResult {
  verdict: VerifyVerdict;
  kind: string;
  sha256?: string;
  artifactPath?: string;
  reason?: string;
}

/**
 * Independent verifier: re-reads the artifact from disk itself and re-hashes
 * it. Never trusts the executor's self-report (S11: executor claiming
 * completion without an artifact can never reach `completed`).
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
