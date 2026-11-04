import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { ModelError, type GenerateResult, type ModelConfig, type ModelProvider } from './types.js';

function testDouble(bin: string): boolean {
  return /\.(?:cjs|mjs|js)$/i.test(bin);
}

/** Child environment carries the named provider credential only, never the user home or project tree. */
export function providerEnvironment(config: ModelConfig, env: NodeJS.ProcessEnv, workdir: string): Record<string, string> {
  const path = [config.bin ? dirname(config.bin) : '', dirname(process.execPath), '/usr/bin', '/bin'].filter(Boolean).join(':');
  const result: Record<string, string> = {
    PATH: path, HOME: workdir, TMPDIR: workdir, LANG: 'C', TERM: 'dumb', PI_OFFLINE: '1', PI_TELEMETRY: '0',
  };
  for (const key of config.credentialEnv) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  return result;
}

export class PiModelProvider implements ModelProvider {
  readonly providerId = 'pi' as const;
  readonly modelId: string;
  readonly configured: boolean;
  readonly unavailableReason: string | null;

  constructor(private readonly config: ModelConfig, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.modelId = config.provider && config.model ? `${config.provider}/${config.model}` : '';
    this.unavailableReason = config.mode === 'pi' && config.reason === null && this.modelId ? null : (config.reason ?? '模型未配置');
    this.configured = this.unavailableReason === null;
  }

  async generate(input: { system: string; user: string }, signal: AbortSignal): Promise<GenerateResult> {
    if (!this.configured || !this.config.bin || !this.config.provider || !this.config.model || !this.config.workdir) {
      throw new ModelError(this.config.reason === '缺少凭证，未发出请求' ? 'missing_credential' : 'unconfigured', this.unavailableReason ?? '模型未配置');
    }
    if (process.env['VITEST'] && !testDouble(this.config.bin)) throw new ModelError('rejected', '测试不能调用真实 Provider');
    for (const key of this.config.credentialEnv) {
      const value = this.env[key];
      if (typeof value !== 'string' || value.length === 0) throw new ModelError('missing_credential', '缺少凭证，未发出请求');
    }
    if (signal.aborted) throw new ModelError('cancelled', '已取消', 409);
    const args = [
      '--print', '--mode', 'text', '--no-tools', '--no-skills', '--no-extensions', '--no-mcp', '--no-context-files',
      '--no-session', '--no-prompt-templates', '--offline', '--thinking', 'off', '--system-prompt', input.system,
      '--provider', this.config.provider, '--model', this.config.model,
    ];
    if (this.config.extension) args.push('-e', this.config.extension);
    args.push('--', input.user);
    return { text: await this.run(this.config.bin, args, signal), usage: null };
  }

  private run(bin: string, args: string[], signal: AbortSignal): Promise<string> {
    const { timeoutMs, maxOutputBytes, maxStderrBytes, killGraceMs, workdir } = this.config;
    if (!workdir) return Promise.reject(new ModelError('unconfigured', '模型未配置'));
    return new Promise((resolve, reject) => {
      const processGroup = process.platform !== 'win32';
      const script = testDouble(bin);
      const child = spawn(script ? process.execPath : bin, script ? [bin, ...args] : args, {
        env: providerEnvironment(this.config, this.env, workdir), cwd: workdir, detached: processGroup, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = []; const stderr: Buffer[] = [];
      let stdoutBytes = 0; let stderrBytes = 0; let spawned = false;
      let failure: ModelError | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined; let closed = false;
      const signalChild = (name: NodeJS.Signals) => {
        if (processGroup && child.pid !== undefined) { try { process.kill(-child.pid, name); return; } catch { /* already exited */ } }
        child.kill(name);
      };
      const stop = (error: ModelError) => {
        if (closed || failure) return;
        failure = error; signalChild('SIGTERM'); killTimer = setTimeout(() => signalChild('SIGKILL'), killGraceMs);
      };
      const timer = setTimeout(() => stop(new ModelError('timeout', '调用超时')), timeoutMs);
      const onAbort = () => stop(new ModelError('cancelled', '已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      child.on('spawn', () => { spawned = true; });
      child.stdout?.on('data', (chunk: Buffer) => {
        if (failure) return;
        if (chunk.length > maxOutputBytes - stdoutBytes) { stop(new ModelError('output_limit', '输出超过长度限制')); return; }
        stdoutBytes += chunk.length; stdout.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (failure) return;
        if (chunk.length > maxStderrBytes - stderrBytes) { stop(new ModelError('output_limit', '输出超过长度限制')); return; }
        stderrBytes += chunk.length; stderr.push(chunk);
      });
      child.on('error', () => { failure ??= new ModelError('unavailable', '模型进程不可用'); });
      child.on('close', code => {
        closed = true;
        if (processGroup) signalChild('SIGKILL');
        clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
        signal.removeEventListener('abort', onAbort);
        if (!spawned && failure === undefined) failure = new ModelError('unavailable', '模型进程不可用');
        if (failure) { reject(failure); return; }
        if (!spawned) { reject(new ModelError('unavailable', '模型进程不可用')); return; }
        const output = Buffer.concat(stdout, stdoutBytes).toString('utf8');
        const diagnostic = Buffer.concat(stderr, stderrBytes).toString('utf8');
        if (code === 0) { resolve(output.trim()); return; }
        if (code === null) { reject(new ModelError('unknown_result', '网络结果未知')); return; }
        const authRejected = /401|invalid.x.api.key|authentication_error|unauthorized/i.test(diagnostic);
        reject(new ModelError(authRejected ? 'auth_rejected' : 'provider_error', authRejected ? '凭证被拒绝' : '模型 Provider 返回错误'));
      });
    });
  }
}

export class MockModelProvider implements ModelProvider {
  readonly providerId = 'mock' as const;
  readonly configured = true;
  readonly unavailableReason = null;
  constructor(readonly modelId = 'synthetic-mock') {}

  async generate(input: { system: string; user: string }, signal: AbortSignal): Promise<GenerateResult> {
    if (signal.aborted) throw new ModelError('cancelled', '已取消');
    const parsed = JSON.parse(input.user) as { question?: string; items?: Array<{ kind?: string; id?: string; citeable?: boolean }> };
    const fact = parsed.items?.find(item => item.citeable === true && item.id);
    const text = JSON.stringify({
      answer: `合成 Mock 模型回复：${parsed.question ?? ''}`,
      uncertainties: ['这是离线 Mock，不是 StepFun 的回答。'],
      evidenceRefs: fact?.id ? [{ id: fact.id }] : [],
      suggestedOpinion: { statement: '可以先核对待办，这只是 Mock 草案。', uncertainties: ['未经验证'] },
    });
    return { text, usage: null };
  }
}
