import { describe, expect, it } from 'vitest';
import { DirtyHintBuffer } from './fs/dirty.js';

describe('DirtyHintBuffer', () => {
  it('coalesces rapid hints into one flush (T03)', async () => {
    const flushes: string[][] = [];
    const buffer = new DirtyHintBuffer(30, (_id, paths) => {
      flushes.push(paths);
    });
    for (let i = 0; i < 10; i += 1) {
      buffer.hint('prj_1', `file-${i}.txt`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(flushes).toHaveLength(1);
    expect(flushes[0]?.length).toBe(10);
  });
});
