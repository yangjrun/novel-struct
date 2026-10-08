import { defineConfig } from 'vitest/config';

const coverageThresholds = { statements: 80, branches: 80, functions: 80, lines: 80 };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/web/**'],
          testTimeout: 30_000,
        },
      },
      'packages/web/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'packages/web/src/**/*.vue'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        ...coverageThresholds,
        'packages/db/src/repositories/parse-run-views.ts': coverageThresholds,
        'packages/db/src/repositories/context-queries.ts': coverageThresholds,
        'packages/memory/src/index.ts': coverageThresholds,
        'packages/pipeline/src/parser-context.ts': coverageThresholds,
        'packages/api/src/routes/editions.ts': coverageThresholds,
        'packages/web/src/App.vue': coverageThresholds,
        'packages/web/src/pages/EditionPage.vue': coverageThresholds,
        'packages/web/src/pages/EntitiesPage.vue': coverageThresholds,
      },
    },
  },
});
