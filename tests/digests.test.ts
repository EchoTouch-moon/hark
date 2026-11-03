import { describe, expect, it } from 'vitest';
import { actionDigests, idempotencyKeyForAction } from '../src/digests.js';

const base = { id: 'a', actionType: 'repo.read_diagnose', projectId: 'p', target: { resourceId: 'p' }, params: { b: 2, a: 1 }, allowedCapabilities: ['read'], risk: 'L0', effect: 'read', maxSteps: 1, timeoutMs: 1000, maxCostUsd: 0, idempotencyKey: 'placeholder', verification: { kind: 'json_schema' } };
const finalize = (action: typeof base) => ({ ...action, idempotencyKey: idempotencyKeyForAction(action) });
describe('approval digests and idempotency', () => {
  it('is stable across key order and binds target, params, project and source version', () => {
    const result = actionDigests(finalize(base));
    expect(actionDigests(finalize({ ...base, params: { a: 1, b: 2 } }))).toEqual(result);
    for (const altered of [{ ...base, projectId: 'other' }, { ...base, target: { resourceId: 'other' } }, { ...base, params: { a: 2, b: 2 } }, { ...base, expectedSourceVersion: 'v2' }]) {
      expect(actionDigests(finalize(altered)).idempotencyKey).not.toBe(result.idempotencyKey);
    }
    expect(actionDigests(finalize({ ...base, target: { resourceId: 'other' } })).targetDigest).not.toBe(result.targetDigest);
    expect(() => actionDigests(base)).toThrow('Idempotency key does not match action');
  });
  it('refuses values that cannot be represented faithfully as JSON', () => {
    for (const bad of [undefined, NaN, Infinity, () => 1, new Date()]) expect(() => actionDigests({ ...base, params: { bad } })).toThrow();
  });
});
