import { z } from 'zod';
import type { Storage } from '@hearth/storage';

export const HearthPermKey = 'hearth.permissions';

export const ObserveWriteBody = z.object({ observe: z.boolean() }).strict();

export type HearthPerms = { observe: boolean; research: boolean; model: boolean };

/** 库里有记录就以库为准；否则用环境变量默认值。execute 永不入库。 */
export function readHearthPermissions(storage: Storage, envDefault: HearthPerms): HearthPerms {
  const stored = storage.getSetting<Partial<HearthPerms>>(HearthPermKey);
  if (stored === null) return { ...envDefault };
  return {
    observe: typeof stored.observe === 'boolean' ? stored.observe : envDefault.observe,
    research: typeof stored.research === 'boolean' ? stored.research : envDefault.research,
    model: typeof stored.model === 'boolean' ? stored.model : envDefault.model,
  };
}

/** 只持久化 observe；research/model 保留现值，execute 不写。 */
export function writeObservePermission(storage: Storage, envDefault: HearthPerms, observe: boolean): HearthPerms {
  const current = readHearthPermissions(storage, envDefault);
  const next: HearthPerms = { ...current, observe };
  storage.setSetting(HearthPermKey, next);
  return next;
}
