import vue from '@vitejs/plugin-vue';
import type { UserConfig } from 'vite';
import type { InlineConfig } from 'vitest/node';

export default {
  root: import.meta.dirname,
  plugins: [vue()],
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
  },
} satisfies UserConfig & { test: InlineConfig };
