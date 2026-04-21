import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Next.js provides 'server-only' at build time; stub it for vitest.
      'server-only': path.resolve(__dirname, 'lib/test-stubs/server-only.ts'),
    },
  },
});
