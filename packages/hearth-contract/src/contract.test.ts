import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HearthViewModel } from './index';

const dir = join(__dirname, '../fixtures');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('fixtures', () => {
  for (const f of readdirSync(dir)) it(`${f} parses`, () => expect(HearthViewModel.safeParse(load(f)).success).toBe(true));
  it('covers five states', () => expect(readdirSync(dir).sort()).toEqual(['empty.json', 'error.json', 'ok.json', 'permission-denied.json', 'stale.json']));
});

describe('illegal states rejected', () => {
  it('error without error info', () => { const v = load('error.json'); delete v.error; expect(HearthViewModel.safeParse(v).success).toBe(false); });
  it('ok carrying error', () => expect(HearthViewModel.safeParse({ ...load('ok.json'), error: { code: 'x', message: 'y' } }).success).toBe(false));
  it('execute true', () => { const v = load('ok.json'); v.permissions.execute = true; expect(HearthViewModel.safeParse(v).success).toBe(false); });
  it('unknown flame level', () => { const v = load('ok.json'); v.narrative.flame.level = 'hot'; expect(HearthViewModel.safeParse(v).success).toBe(false); });
  it('extra heat field', () => { const v = load('ok.json'); v.narrative.flame.heat = 3; expect(HearthViewModel.safeParse(v).success).toBe(false); });
});
