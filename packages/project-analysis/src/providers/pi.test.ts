import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PiAnalysisProvider } from './pi.js';
import type { ProjectContext } from '../contracts.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function cli(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hearth-pi-test-'));
  dirs.push(dir);
  // Written as a .js entry point rather than a shebang script: Windows cannot
  // execute extensionless files, and the provider runs a .js bin under the
  // current runtime on every platform.
  const bin = path.join(dir, 'pi.js');
  writeFileSync(bin, body);
  return bin;
}
const recommendation = {
  target: 'test', scope: 'test', statusSummary: 'UNKNOWN', findings: [], confidence: 'low',
  uncertainties: [], nextActions: [], risks: [],
};
const input = { context: {} as ProjectContext };
it('requires explicit model identity before calling Pi', async () => {
  const provider = new PiAnalysisProvider({ provider: '', model: '' });
  await expect(provider.analyze(input)).resolves.toMatchObject({ kind: 'unavailable' });
});
it('selects exact provider/model with only an explicit provider extension and text output', async () => {
  const bin = cli(`const a=process.argv.slice(2);
    for(const flag of ['--no-tools','--no-extensions','--no-mcp','--no-context-files','--no-session','--offline']) {
      if(!a.includes(flag)) process.exit(2);
    }
    for(const [flag,value] of [['--provider','stepfun-plan'],['--model','step-5-preview'],['--mode','text'],['-e','/trusted/provider.ts']]) {
      if(a[a.indexOf(flag)+1]!==value) process.exit(3);
    }
    console.log(${JSON.stringify(JSON.stringify(recommendation))});`);
  const provider = new PiAnalysisProvider({ bin, provider: 'stepfun-plan', model: 'step-5-preview', extension: '/trusted/provider.ts' });
  expect(provider.model).toBe('stepfun-plan/step-5-preview');
  await expect(provider.analyze(input)).resolves.toMatchObject({ kind: 'recommendation' });
});
it('does not expose provider stderr or fall back to Mock on auth failure', async () => {
  const bin = cli(`console.error('401 invalid x-api-key secret-synthetic-value'); process.exit(1);`);
  const provider = new PiAnalysisProvider({ bin, provider: 'stepfun-plan', model: 'step-5-preview' });
  await expect(provider.analyze(input)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Pi authentication rejected (exit 1)' });
});
it('reports timeout and invalid structured output', async () => {
  const timeout = new PiAnalysisProvider({ bin: cli('setInterval(()=>{},1000);'), provider: 'p', model: 'm', timeoutMs: 40 });
  await expect(timeout.analyze(input)).rejects.toMatchObject({ code: 'TIMEOUT' });
  const invalid = new PiAnalysisProvider({ bin: cli("console.log('not JSON');"), provider: 'p', model: 'm' });
  await expect(invalid.analyze(input)).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT' });
});
it('accepts an honest no-recommendation outcome', async () => {
  const bin = cli(`console.log(JSON.stringify({kind:'no_recommendation',reason:'Insufficient evidence'}));`);
  const provider = new PiAnalysisProvider({ bin, provider: 'p', model: 'm' });
  await expect(provider.analyze(input)).resolves.toEqual({ kind: 'no_recommendation', reason: 'Insufficient evidence' });
});

function marker(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hearth-pi-pid-'));
  dirs.push(dir);
  return path.join(dir, 'pid');
}
async function waitStarted(file: string): Promise<number> {
  for (let i = 0; i < 150; i += 1) {
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8'));
      // File creation is observable before its contents are flushed. PID 0
      // means the caller's process group to kill(0), not the child.
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await delay(10);
  }
  throw new Error('synthetic child did not start');
}
function expectExited(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow();
}
function hangingCli(file: string, tail = ''): string {
  return cli(`const fs=require('node:fs');
    process.on('SIGTERM',()=>{});
    fs.writeFileSync(${JSON.stringify(file)}, String(process.pid));
    setInterval(()=>{},1000);
    ${tail}`);
}
it.each(['stdout', 'stderr'] as const)('caps infinite %s output and waits for the TERM-ignoring child to exit', async (stream) => {
  const file = marker();
  const bin = hangingCli(file, `setInterval(()=>process.${stream}.write(Buffer.alloc(4096,120)),5);`);
  const provider = new PiAnalysisProvider({ bin, provider: 'p', model: 'm', maxStdoutBytes: 128, maxStderrBytes: 128, killGraceMs: 40 });
  const result = provider.analyze(input);
  // Register the rejection assertion immediately to avoid an unhandled rejection.
  const settled = expect(result).rejects.toMatchObject({ code: 'OUTPUT_LIMIT', message: `Pi ${stream} exceeded the byte limit` });
  const pid = await waitStarted(file);
  await settled;
  expectExited(pid);
});
it('escalates a timeout to SIGKILL and waits for process exit', async () => {
  const file = marker();
  const provider = new PiAnalysisProvider({ bin: hangingCli(file), provider: 'p', model: 'm', timeoutMs: 1000, killGraceMs: 40 });
  const result = provider.analyze(input);
  const settled = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
  const pid = await waitStarted(file);
  await settled;
  expectExited(pid);
});
it('cancels a running TERM-ignoring child without leaving an abort listener', async () => {
  const file = marker();
  const controller = new AbortController();
  let added = 0, removed = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args: Parameters<typeof add>) => { added += 1; return add(...args); };
  controller.signal.removeEventListener = (...args: Parameters<typeof remove>) => { removed += 1; return remove(...args); };
  const provider = new PiAnalysisProvider({ bin: hangingCli(file), provider: 'p', model: 'm', killGraceMs: 40 });
  const result = provider.analyze({ ...input, signal: controller.signal });
  const settled = expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  const pid = await waitStarted(file);
  controller.abort();
  await settled;
  expectExited(pid);
  expect(added).toBe(1);
  expect(removed).toBe(1);
});
it('does not spawn a child when the signal is already aborted', async () => {
  const file = marker();
  const controller = new AbortController();
  controller.abort();
  const provider = new PiAnalysisProvider({ bin: hangingCli(file), provider: 'p', model: 'm' });
  await expect(provider.analyze({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(existsSync(file)).toBe(false);
});
it('rejects invalid byte/deadline limits and reports spawn failure without leaking paths', async () => {
  const provider = new PiAnalysisProvider({ provider: 'p', model: 'm', maxStdoutBytes: Number.NaN });
  await expect(provider.analyze(input)).rejects.toMatchObject({ code: 'CONFIGURATION' });
  const missing = new PiAnalysisProvider({ provider: 'p', model: 'm', bin: '/missing/synthetic/pi' });
  await expect(missing.analyze(input)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Pi executable unavailable' });
});
