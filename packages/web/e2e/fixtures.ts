import { test as base, expect } from '@playwright/test';
import vue from '@vitejs/plugin-vue';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBrowserApi } from '../../api/test/helpers/browser-server.js';

export const test = base.extend<object, { appUrl: string }>({
  appUrl: [
    async ({}, use) => {
      const api = await startBrowserApi();
      try {
        const cacheDir = await mkdtemp(path.join(tmpdir(), 'novelstruct-e2e-web-'));
        try {
          const web = await createServer({
            configFile: false,
            envFile: false,
            cacheDir,
            root: fileURLToPath(new URL('..', import.meta.url)),
            plugins: [vue()],
            server: {
              host: '127.0.0.1',
              port: 4318,
              strictPort: false,
              proxy: { '/api': { target: api.url, changeOrigin: true } },
            },
          });
          try {
            await web.listen();
            const address = web.httpServer?.address();
            if (!address || typeof address === 'string') throw new Error('E2E web server has no TCP address');
            await use(`http://127.0.0.1:${address.port}`);
          } finally {
            await web.close();
          }
        } finally {
          await rm(cacheDir, { recursive: true, force: true });
        }
      } finally {
        await api.close();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ appUrl }, use) => use(appUrl),
});

export { expect };
