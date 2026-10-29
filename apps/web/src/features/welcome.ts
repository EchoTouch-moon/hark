import { z } from 'zod';

/** Browser UI preferences only; never authentication, approval or relationship warmth. */
export const WELCOME_STORAGE_KEY = 'hearth.welcome.v1';
export interface WelcomePreference { completed: boolean; name: string }
const storedPreference = z.object({
  version: z.literal(1),
  completed: z.literal(true),
  name: z.string().max(40),
}).strict();

export function readWelcomePreference(): WelcomePreference {
  try {
    const raw = window.localStorage.getItem(WELCOME_STORAGE_KEY);
    const parsed = storedPreference.safeParse(raw ? JSON.parse(raw) as unknown : null);
    return parsed.success ? { completed: true, name: parsed.data.name.trim() } : { completed: false, name: '' };
  } catch {
    return { completed: false, name: '' };
  }
}

export function saveWelcomePreference(name: string): boolean {
  try {
    const value = storedPreference.parse({ version: 1, completed: true, name: name.trim().slice(0, 40) });
    window.localStorage.setItem(WELCOME_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
