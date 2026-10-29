import { z } from 'zod';

const KEY = 'hearth.flame.size';
const sizeSchema = z.number().finite().min(0.65).max(1.4);

/** A visual preference only; invalid or inaccessible storage uses the default. */
export function readFlameSize(): number {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === null || value.trim() === '') return 1;
    const parsed = sizeSchema.safeParse(Number(value));
    return parsed.success ? parsed.data : 1;
  } catch { return 1; }
}

export function saveFlameSize(value: number): void {
  const parsed = sizeSchema.safeParse(value);
  if (!parsed.success) return;
  try { window.localStorage.setItem(KEY, String(parsed.data)); } catch { /* Keep this session's preference. */ }
}
