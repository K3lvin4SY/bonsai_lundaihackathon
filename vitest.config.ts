import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/main/**/*.{test,spec}.ts'],
    exclude: ['src/renderer/**'],
    mockReset: true,
  },
});
