import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PiAnalysisProvider } from './pi.js';
import type { ProjectContext } from '../contracts.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function cli(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hearth-pi-test-'));
  dirs.push(dir);
  const bin = path.join(dir, 'pi');
  writeFileSync(bin, `#!${process.execPath}\n${body}`);
  chmodSync(bin, 0o700);
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
