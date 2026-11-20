import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@haunt/shared': fileURLToPath(new URL('./packages/haunt/src/shared/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['packages/*/test/contract/**', 'node_modules/**'],
    testTimeout: 30000,
  },
});
