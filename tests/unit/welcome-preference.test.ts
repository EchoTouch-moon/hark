import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readWelcomePreference, saveWelcomePreference, WELCOME_STORAGE_KEY } from '../../apps/web/src/features/welcome';
let values: Map<string,string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('window', {localStorage:{getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>values.set(key,value)}});
});
afterEach(() => vi.unstubAllGlobals());
it('first entry has no invented name or completed registration', () => {
  expect(readWelcomePreference()).toEqual({completed:false,name:''});
});
it('saves only versioned browser UI preferences', () => {
  expect(saveWelcomePreference('  同行者  ')).toBe(true);
  expect(JSON.parse(values.get(WELCOME_STORAGE_KEY)!)).toEqual({version:1,completed:true,name:'同行者'});
  expect(readWelcomePreference()).toEqual({completed:true,name:'同行者'});
});
it.each(['not JSON','[]','null','{"version":2,"completed":true,"name":"x"}','{"version":1,"completed":true,"name":"x","approved":true}'])('rejects corrupt or unexpected external preference %s', raw => {
  values.set(WELCOME_STORAGE_KEY,raw);
  expect(readWelcomePreference()).toEqual({completed:false,name:''});
});
it('storage failure never pretends registration succeeded', () => {
  vi.stubGlobal('window', {localStorage:{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}}});
  expect(saveWelcomePreference('x')).toBe(false);
  expect(readWelcomePreference()).toEqual({completed:false,name:''});
});
