import { createHash } from 'node:crypto';
import { ActionSpec } from './contracts.js';

// Canonical JSON rejects values JSON.stringify would otherwise silently change or omit.
function canonical(value: unknown, seen: Set<object> = new Set()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object') throw new Error('Only JSON values can be digested');
  if (seen.has(value)) throw new Error('Circular input cannot be digested');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) throw new Error('Sparse arrays cannot be digested');
        result.push(canonical(value[i], seen));
      }
      return `[${result.join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Only plain JSON objects can be digested');
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(object[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}

function sha(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }

/** Derive the key on the server before finalizing the action and approval digest. */
export function idempotencyKeyForAction(input: unknown): string {
  const action = ActionSpec.parse(input);
  return sha({ actionType: action.actionType, projectId: action.projectId, target: action.target, params: action.params, sourceVersion: action.expectedSourceVersion ?? null });
}

/** Digests bind only validated data. They do not themselves approve an action. */
export function actionDigests(input: unknown): { actionDigest: string; targetDigest: string; idempotencyKey: string } {
  const action = ActionSpec.parse(input);
  const idempotencyKey = idempotencyKeyForAction(action);
  if (action.idempotencyKey !== idempotencyKey) throw new Error('Idempotency key does not match action');
  return {
    actionDigest: sha(action),
    targetDigest: sha(action.target),
    idempotencyKey,
  };
}
