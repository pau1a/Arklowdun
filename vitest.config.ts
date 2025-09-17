import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), p);

export default defineConfig({
  resolve: {
    alias: {
      '@features': fromRoot('src/features'),
      '@ui': fromRoot('src/ui'),
      '@layout': fromRoot('src/layout'),
      '@lib': fromRoot('src/lib'),
      '@store': fromRoot('src/store'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'scripts/**',
        'src-tauri/**',
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/bindings/**'
      ]
    }
  }
});
