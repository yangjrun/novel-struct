import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { openDatabase, type DbHandle } from '@novelstruct/db';
import { MemoryJobQueue } from '@novelstruct/queue';
import { createApp } from '../../src/app.js';
import { stdioLogger } from '../../src/log.js';

export interface BrowserApi {
  readonly url: string;
  close(): Promise<void>;
}

/** Uses only disposable data and explicit offline dependencies; never loads the user's .env. */
export async function startBrowserApi(): Promise<BrowserApi> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'novelstruct-e2e-'));
  const handle = await openDatabase({ dataDir }).catch(async (error: unknown) => {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  });
  const jobs = new MemoryJobQueue({ db: handle.db, llm: undefined, logger: stdioLogger });
  const dispose = (): Promise<void> => disposeDatabase(handle, jobs, dataDir);
  try {
    await handle.migrate();
    const app = createApp({
      db: handle.db,
      databaseKind: handle.kind,
      llm: undefined,
      pricing: undefined,
      jobs,
      logger: stdioLogger,
    });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('E2E API has no TCP address');
    return {
      url: `http://127.0.0.1:${address.port}`,
      async close() {
        try {
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        } finally {
          await dispose();
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function disposeDatabase(handle: DbHandle, jobs: MemoryJobQueue, dataDir: string): Promise<void> {
  try {
    await jobs.close();
  } finally {
    try {
      await handle.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }
}
