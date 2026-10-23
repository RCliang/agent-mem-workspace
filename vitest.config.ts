import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-mem/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@agent-mem/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
      '@agent-mem/cli': fileURLToPath(new URL('./packages/cli/src/run.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
