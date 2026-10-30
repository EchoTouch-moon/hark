import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { HearthViewModel } from '@hearth/hearth-contract';
import ok from '@hearth/hearth-contract/fixtures/ok.json';
import empty from '@hearth/hearth-contract/fixtures/empty.json';
import error from '@hearth/hearth-contract/fixtures/error.json';
import permissionDenied from '@hearth/hearth-contract/fixtures/permission-denied.json';
import stale from '@hearth/hearth-contract/fixtures/stale.json';

/** E1: the only Mind → Experience entry is a fixture, chosen by ?fixture=. No real API. */
/** Web-local derived variant (contract fixtures stay frozen): ok with flame.level 'bright'. Still Zod-validated below. */
const bright = { ...ok, narrative: { ...ok.narrative, flame: { ...ok.narrative.flame, level: 'bright' } } };
const FIXTURES: Record<string, unknown> = { ok, empty, error, 'permission-denied': permissionDenied, stale, bright };

/** E1 has no real Mind API: the shell is always in fixture mode and makes no legacy requests. */
export const FIXTURE_MODE = true;

export type ViewModelSource =
  | { kind: 'ready'; fixture: string; vm: HearthViewModel }
  | { kind: 'invalid'; fixture: string; message: string };

export function loadFixtureViewModel(search: string, key?: string): ViewModelSource {
  const fixture = key ?? new URLSearchParams(search).get('fixture') ?? 'ok';
  const raw = FIXTURES[fixture];
  if (raw === undefined) return { kind: 'invalid', fixture, message: `未知 fixture「${fixture}」，可选：${Object.keys(FIXTURES).join(' / ')}` };
  const parsed = HearthViewModel.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid', fixture, message: `ViewModel 校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}` };
  return { kind: 'ready', fixture, vm: parsed.data };
}

const Ctx = createContext<ViewModelSource | null>(null);

export function HearthViewModelProvider({ children }: { children: ReactNode }) {
  // ?from=<fixture> renders that fixture first, then switches to ?fixture= after 600ms,
  // so a level transition (e.g. neutral→bright, 800ms) can be observed and measured.
  const [source, setSource] = useState(() => {
    const from = new URLSearchParams(window.location.search).get('from');
    return loadFixtureViewModel(window.location.search, from ?? undefined);
  });
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get('from')) return;
    const t = window.setTimeout(() => setSource(loadFixtureViewModel(window.location.search)), 600);
    return () => window.clearTimeout(t);
  }, []);
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useViewModelSource(): ViewModelSource {
  const value = useContext(Ctx);
  if (!value) throw new Error('useViewModelSource 需在 HearthViewModelProvider 内使用');
  return value;
}
