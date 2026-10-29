import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFlameSize, saveFlameSize } from '../../apps/web/src/features/flameSize';

afterEach(() => vi.unstubAllGlobals());

describe('火焰大小只是一项本机视觉偏好', () => {
  it('accepts the supported range and rejects corrupted values', () => {
    let value: string | null = null;
    vi.stubGlobal('window', { localStorage: { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } } });
    expect(readFlameSize()).toBe(1);
    saveFlameSize(1.4);
    expect(readFlameSize()).toBe(1.4);
    saveFlameSize(9);
    expect(readFlameSize()).toBe(1.4);
    value = 'Infinity';
    expect(readFlameSize()).toBe(1);
    value = ' ';
    expect(readFlameSize()).toBe(1);
  });
  it('stays usable if the browser denies storage access', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } });
    expect(readFlameSize()).toBe(1);
    expect(() => saveFlameSize(0.8)).not.toThrow();
  });
});
