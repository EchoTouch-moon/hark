import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Reference repositories in ignored directories must never be collected.
    include: ['tests/**/*.test.ts'],
  },
});
