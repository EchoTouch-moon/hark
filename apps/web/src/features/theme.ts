/** Device-only appearance preference. No business state or server writes. */
export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'hearth.theme';
const EVENT = 'hearth-theme-change';
let preference: ThemePreference = 'light';
let initialized = false;
const valid = (value: string | null): ThemePreference => value === 'dark' || value === 'system' ? value : 'light';
function apply(): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.dispatchEvent(new Event(EVENT));
}
export function initializeTheme(): void {
  if (initialized) return;
  initialized = true;
  try { preference = valid(window.localStorage.getItem(KEY)); } catch { /* Memory-only preference remains usable. */ }
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) { preference = valid(event.newValue); apply(); }
  });
}
export function setThemePreference(value: ThemePreference): void {
  preference = value;
  try { window.localStorage.setItem(KEY, value); } catch { /* Storage can be disabled. */ }
  apply();
}
export const getThemePreference = (): ThemePreference => preference;
export function subscribeTheme(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
