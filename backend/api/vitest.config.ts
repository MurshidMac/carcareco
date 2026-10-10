import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Runs before any test module is imported, so `src/config` sees valid
    // environment values when it validates them at import time.
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
