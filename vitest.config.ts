import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hearth/contracts': r('./packages/contracts/src/index.ts'),
      '@hearth/core': r('./packages/core/src/index.ts'),
      '@hearth/storage': r('./packages/storage/src/index.ts'),
      '@hearth/connectors': r('./packages/connectors/src/index.ts'),
      '@hearth/agent-adapters': r('./packages/agent-adapters/src/index.ts'),
      '@hearth/panels': r('./packages/panels/src/index.ts'),
      '@hearth/eval': r('./packages/eval/src/index.ts'),
      '@hearth/project-observer': r('./packages/project-observer/src/index.ts'),
      '@hearth/project-insight': r('./packages/project-insight/src/index.ts'),
      '@hearth/hearth-contract': r('./packages/hearth-contract/src/index.ts'),
      '@hearth/project-analysis': r('./packages/project-analysis/src/index.ts'),
      'gsap': path.resolve(__dirname, 'apps/web/node_modules/gsap'),
      '@gsap/react': path.resolve(__dirname, 'apps/web/node_modules/@gsap/react'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
  },
});
