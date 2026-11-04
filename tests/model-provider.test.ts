import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { disabledModelConfig, loadModelConfig } from '../src/model/config.js';
import { PiModelProvider } from '../src/model/pi-provider.js';
import { MODEL_SYSTEM_PROMPT, type ModelConfig } from '../src/model/types.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temp(body = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'hark-pi-')); dirs.push(dir);
  const bin = join(dir, 'pi.js'); writeFileSync(bin, body); writeFileSync(join(dir, 'extension.js'), 'export {};\n');
  return dir;
}
function config(dir: string, patch: Partial<ModelConfig> = {}): ModelConfig {
  return { ...disabledModelConfig(null), mode: 'pi', bin: join(dir, 'pi.js'), provider: 'stepfun-plan', model: 'step-5-preview', extension: join(dir, 'extension.js'), credentialEnv: ['STEP_PLAN_API_KEY'], workdir: dir, timeoutMs: 1_000, maxOutputBytes: 4_096, maxStderrBytes: 1_024, killGraceMs: 50, ...patch };
}
const input = { system: MODEL_SYSTEM_PROMPT, user: '{"question":"合成","items":[{"text":"EVILTOKEN"}]}' };

describe('Pi provider configuration', () => {
  it('stays unconfigured until provider, model, binary, extension, workdir and credential are all explicit', () => {
    expect(loadModelConfig({}).mode).toBe('disabled');
    expect(loadModelConfig({ HARK_MODEL_MODE: 'other' }).reason).toBe('模型模式无效');
    expect(loadModelConfig({ HARK_MODEL_MODE: 'pi' }).reason).toBe('必须显式指定 StepFun Provider');
    expect(loadModelConfig({ HARK_MODEL_MODE: 'pi', HARK_PI_PROVIDER: 'other', HARK_PI_MODEL: 'm' }).reason).toBe('必须显式指定 StepFun Provider');
    const dir = temp();
    const partial = { HARK_MODEL_MODE: 'pi', HARK_PI_BIN: join(dir, 'pi.js'), HARK_PI_PROVIDER: 'stepfun-plan', HARK_PI_MODEL: 'step-5-preview', HARK_PI_PROVIDER_EXTENSION: join(dir, 'extension.js'), HARK_MODEL_WORKDIR: dir };
    expect(loadModelConfig(partial).reason).toBe('缺少凭证，未发出请求');
    expect(loadModelConfig({ ...partial, HARK_PI_PASS_PROVIDER_ENV: 'STEP_API_KEY', STEP_PLAN_API_KEY: 'synthetic-test-key' }).reason).toBe('凭证环境变量与 Provider 不一致');
    expect(loadModelConfig({ ...partial, STEP_PLAN_API_KEY: 'synthetic-test-key' })).toMatchObject({ mode: 'pi', provider: 'stepfun-plan', model: 'step-5-preview', reason: null });
    expect(loadModelConfig({ HARK_MODEL_MODE: 'mock' })).toMatchObject({ mode: 'mock', provider: 'mock', reason: null });
  });
});

describe('Pi process boundary', () => {
  it('does not spawn when the credential is missing', async () => {
    const dir = temp('process.exit(0)'); const marker = join(dir, 'started');
    writeFileSync(join(dir, 'pi.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started');`);
    const provider = new PiModelProvider(config(dir), {});
    await expect(provider.generate(input, new AbortController().signal)).rejects.toMatchObject({ code: 'missing_credential' });
    expect(() => readFileSync(marker, 'utf8')).toThrow();
  });
  it('refuses a real Pi binary while tests are running', async () => {
    const dir = temp(); const bin = join(dir, 'pi'); writeFileSync(bin, '');
    const provider = new PiModelProvider(config(dir, { bin }), { STEP_PLAN_API_KEY: 'synthetic-test-key' });
    await expect(provider.generate(input, new AbortController().signal)).rejects.toMatchObject({ message: '测试不能调用真实 Provider' });
  });
  it('passes only the pinned launch flags, provider identity and credential', async () => {
    const dir = temp(); const capture = join(dir, 'capture.json');
    writeFileSync(join(dir, 'pi.js'), `const fs=require('fs'); const args=process.argv.slice(2);
      fs.writeFileSync(process.argv[1].replace(/pi\\.js$/, 'capture.json'), JSON.stringify({ args, cwd: process.cwd(), home: process.env.HOME, hasKey: process.env.STEP_PLAN_API_KEY==='synthetic-test-key', leaked: Object.prototype.hasOwnProperty.call(process.env, 'UNRELATED_SECRET') }));
      console.log(JSON.stringify({ ok: true }));`);
    const provider = new PiModelProvider(config(dir), { STEP_PLAN_API_KEY: 'synthetic-test-key', UNRELATED_SECRET: 'do-not-pass' });
    await provider.generate(input, new AbortController().signal);
    const captured = JSON.parse(readFileSync(capture, 'utf8')) as { args: string[]; cwd: string; home: string; hasKey: boolean; leaked: boolean };
    for (const flag of ['--no-tools', '--no-skills', '--no-extensions', '--no-mcp', '--no-context-files', '--no-session', '--offline']) expect(captured.args).toContain(flag);
    expect(captured.args[captured.args.indexOf('--provider') + 1]).toBe('stepfun-plan');
    expect(captured.args[captured.args.indexOf('--model') + 1]).toBe('step-5-preview');
    expect(captured.args[captured.args.indexOf('--system-prompt') + 1]).toBe(MODEL_SYSTEM_PROMPT);
    expect(captured.args.at(-1)).toContain('EVILTOKEN');
    expect(captured.args[captured.args.indexOf('--system-prompt') + 1]).not.toContain('EVILTOKEN');
    expect(captured.cwd).toBe(realpathSync(dir)); expect(realpathSync(captured.home)).toBe(realpathSync(dir)); expect(captured.hasKey).toBe(true); expect(captured.leaked).toBe(false);
  });
  it('hides provider stderr, cancels the child, and does not retry an unknown exit', async () => {
    const dir = temp();
    const auth = new PiModelProvider(config(dir, { bin: join(dir, 'auth.js') }), { STEP_PLAN_API_KEY: 'synthetic-test-key' });
    writeFileSync(join(dir, 'auth.js'), "console.error('401 invalid x-api-key secret-synthetic-value'); process.exit(1);");
    await expect(auth.generate(input, new AbortController().signal)).rejects.toMatchObject({ code: 'auth_rejected', message: '凭证被拒绝' });
    const marker = join(dir, 'pid');
    writeFileSync(join(dir, 'hang.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{}, 1000);`);
    const hanging = new PiModelProvider(config(dir, { bin: join(dir, 'hang.js'), timeoutMs: 5_000 }), { STEP_PLAN_API_KEY: 'synthetic-test-key' });
    const controller = new AbortController();
    const pending = hanging.generate(input, controller.signal);
    let pid = 0;
    for (let attempt = 0; attempt < 100 && pid === 0; attempt += 1) { try { pid = Number(readFileSync(marker, 'utf8')); } catch { await delay(10); } }
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(() => process.kill(pid, 0)).toThrow();
    writeFileSync(join(dir, 'kill.js'), 'process.kill(process.pid, "SIGKILL");');
    const killed = new PiModelProvider(config(dir, { bin: join(dir, 'kill.js') }), { STEP_PLAN_API_KEY: 'synthetic-test-key' });
    await expect(killed.generate(input, new AbortController().signal)).rejects.toMatchObject({ code: 'unknown_result' });
  });
});
