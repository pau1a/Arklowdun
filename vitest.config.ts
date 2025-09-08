import { defineConfig } from 'vitest/config';

export default defineConfig({
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
