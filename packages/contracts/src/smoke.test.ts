import { describe, expect, it } from 'vitest';
import { PACKAGE } from './index.js';

describe('workspace smoke', () => {
  it('loads contracts package', () => {
    expect(PACKAGE).toBe('contracts');
  });
});
