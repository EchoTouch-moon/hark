import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ModelConfig } from './types.js';

const PROVIDER_CREDENTIAL: Record<string, string> = {
  stepfun: 'STEP_API_KEY',
  'stepfun-plan': 'STEP_PLAN_API_KEY',
};

function integer(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function regularFile(path: string | null): boolean {
  if (!path || !isAbsolute(path)) return false;
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch { return false; }
}

export function disabledModelConfig(reason: string | null = '模型未配置'): ModelConfig {
  return {
    mode: 'disabled', bin: null, provider: null, model: null, extension: null, credentialEnv: [],
    timeoutMs: 90_000, maxOutputBytes: 65_536, maxStderrBytes: 8_192, maxCalls: 20, workdir: null,
    previewTtlMs: 600_000, maxContextChars: 8_000, killGraceMs: 500, reason,
  };
}

/** Read explicit operator settings. This never chooses a provider or model by default. */
export function loadModelConfig(env: NodeJS.ProcessEnv): ModelConfig {
  const requested = env['HARK_MODEL_MODE'] ?? 'disabled';
  const timeoutMs = integer(env['HARK_MODEL_TIMEOUT_MS'], 90_000, 1, 120_000);
  const maxOutputBytes = integer(env['HARK_MODEL_MAX_OUTPUT_BYTES'], 65_536, 1, 1_048_576);
  const maxStderrBytes = integer(env['HARK_MODEL_MAX_STDERR_BYTES'], 8_192, 1, 131_072);
  const maxCalls = integer(env['HARK_MODEL_MAX_CALLS'], 20, 0, 100);
  const previewTtlMs = integer(env['HARK_MODEL_PREVIEW_TTL_MS'], 600_000, 1_000, 600_000);
  const maxContextChars = integer(env['HARK_MODEL_MAX_CONTEXT_CHARS'], 8_000, 200, 20_000);
  const killGraceMs = integer(env['HARK_MODEL_KILL_GRACE_MS'], 500, 50, 5_000);
  const limits = { timeoutMs, maxOutputBytes, maxStderrBytes, maxCalls, previewTtlMs, maxContextChars, killGraceMs };
  if (Object.values(limits).some(value => value === null)) return disabledModelConfig('模型限制配置无效');
  const base = { ...(limits as { timeoutMs: number; maxOutputBytes: number; maxStderrBytes: number; maxCalls: number; previewTtlMs: number; maxContextChars: number; killGraceMs: number }) };
  if (requested === 'disabled' || requested === '') return { ...disabledModelConfig(null), ...base, reason: '模型未配置' };
  if (requested === 'mock') {
    const model = env['HARK_PI_MODEL']?.trim() || 'synthetic-mock';
    return { ...disabledModelConfig(null), ...base, mode: 'mock', provider: 'mock', model, reason: null };
  }
  if (requested !== 'pi') return disabledModelConfig('模型模式无效');
  const provider = env['HARK_PI_PROVIDER']?.trim() ?? '';
  const model = env['HARK_PI_MODEL']?.trim() ?? '';
  const credential = PROVIDER_CREDENTIAL[provider];
  const requestedCredential = env['HARK_PI_PASS_PROVIDER_ENV']?.trim();
  const bin = env['HARK_PI_BIN']?.trim() ?? '';
  const extension = env['HARK_PI_PROVIDER_EXTENSION']?.trim() ?? '';
  const workdir = env['HARK_MODEL_WORKDIR']?.trim() ?? '';
  const fail = (reason: string): ModelConfig => ({ ...disabledModelConfig(reason), ...base, mode: 'pi', bin: bin || null, provider: provider || null, model: model || null, extension: extension || null, workdir: workdir || null });
  if (!credential) return fail('必须显式指定 StepFun Provider');
  if (!model || model.includes('/')) return fail('必须显式指定模型 ID');
  if (requestedCredential && requestedCredential !== credential) return fail('凭证环境变量与 Provider 不一致');
  if (!regularFile(bin) || !regularFile(extension)) return fail('Pi 路径或受信扩展不可用');
  if (!workdir || !isAbsolute(workdir)) return fail('模型工作目录未显式配置');
  try {
    const info = lstatSync(workdir);
    if (info.isSymbolicLink() || !info.isDirectory()) return fail('模型工作目录不可用');
  } catch { return fail('模型工作目录不可用'); }
  const secret = env[credential];
  if (typeof secret !== 'string' || secret.length === 0) return fail('缺少凭证，未发出请求');
  return { ...base, mode: 'pi', bin, provider, model, extension, credentialEnv: [credential], workdir, reason: null };
}
