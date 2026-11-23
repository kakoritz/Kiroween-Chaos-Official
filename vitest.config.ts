import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

// Many files are CPU heavy (property tests, sweeps) or spawn real bot processes. Running one worker per core starves the workers' RPC to the
// runner ("Timeout calling onTaskUpdate") and makes the spec-lint CLI test time out. Cap the workers at half the cores (3 to 6) and use forks so
// a busy worker never blocks the runner's event loop.
const workers = Math.max(3, Math.min(6, Math.floor(cpus().length / 2)));

export default defineConfig({
  resolve: {
    alias: {
      '@haunt/shared': fileURLToPath(new URL('./packages/haunt/src/shared/index.ts', import.meta.url)),
      '@haunt/sdk': fileURLToPath(new URL('./packages/haunt/src/sdk/index.ts', import.meta.url)),
      '@haunt/bot': fileURLToPath(new URL('./packages/haunt/src/bot/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['packages/*/test/contract/**', 'node_modules/**'],
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 20000,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: workers } },
  },
});
