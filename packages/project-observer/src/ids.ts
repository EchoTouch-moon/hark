import { createHash, randomBytes } from 'node:crypto';
import { ObserverError } from './errors.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

export function newId(prefix: string): string {
  const id = `${prefix}_${randomBytes(8).toString('hex')}`;
  if (!ID.test(id)) {
    throw new ObserverError('INTERNAL', `generated id failed schema: ${id}`);
  }
  return id;
}

export function projectIdForPath(canonicalPath: string): string {
  const digest = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 16);
  return `prj_${digest}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
