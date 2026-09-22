/**
 * Runs only when a Redis is reachable: `REDIS_TEST_URL` or redis://127.0.0.1:6379. Uses a unique
 * prefix per run and removes its keys afterwards, so a shared local Redis stays clean.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openDatabase } from '@novelstruct/db';
import { importBook } from '@novelstruct/pipeline';
import { BullJobQueue } from '../src/bull/bull-queue.js';
import { createRedisConnection, probeRedis } from '../src/bull/connection.js';
import { ParseWorker } from '../src/bull/worker.js';
import type { JobDto } from '../src/contracts.js';
import { silentLogger } from '../src/log.js';
import { longNovel } from './helpers/long-novel.js';

const REDIS_URL = process.env['REDIS_TEST_URL']?.trim() || 'redis://127.0.0.1:6379';
const CHAPTERS = 40;
const available = await probeRedis(REDIS_URL, 1500);

const prefix = `novelstruct-test-${randomUUID().slice(0, 8)}`;
let handle: DbHandle;
let editionId: string;

function openQueue(inlineWorker: boolean): BullJobQueue {
  return new BullJobQueue({
    db: handle.db,
    llm: undefined,
    logger: silentLogger,
    redisUrl: REDIS_URL,
    prefix,
    inlineWorker,
  });
}

function startWorker(): { worker: ParseWorker; stop: () => Promise<void> } {
  const connection = createRedisConnection(REDIS_URL);
  const worker = new ParseWorker({ deps: { db: handle.db, llm: undefined, logger: silentLogger }, connection, prefix });
  return {
    worker,
    stop: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}

async function flushPrefix(): Promise<void> {
  const client = createRedisConnection(REDIS_URL);
  try {
    const keys = await client.keys(`${prefix}:*`);
    if (keys.length > 0) await client.del(...keys);
  } finally {
    await client.quit();
  }
}

async function waitFor(queue: BullJobQueue, id: string, done: (job: JobDto) => boolean): Promise<JobDto> {
  for (let i = 0; i < 2000; i += 1) {
    const job = await queue.get(id);
    if (job !== undefined && done(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${id} did not reach the expected state`);
}

const finished = (job: JobDto): boolean => job.status !== 'queued' && job.status !== 'running';
const all = { from: 0, to: null, attributor: 'heuristic', force: true, maxAttempts: 3 } as const;
const range = { attributor: 'heuristic', force: false, maxAttempts: 3 } as const;

describe.skipIf(!available)('BullJobQueue', () => {
  beforeAll(async () => {
    handle = await openDatabase({ inMemory: true });
    await handle.migrate();
    editionId = (await importBook(handle.db, { bytes: longNovel(CHAPTERS), title: 'BullMQ 测试' })).editionId;
  });

  afterAll(async () => {
    await handle.close();
    await flushPrefix();
  });

  it('persists a job, runs it with the inline worker and exposes events', async () => {
    const queue = openQueue(true);
    await queue.waitUntilReady();
    try {
      const queued = await queue.enqueue(editionId, { from: 1, to: 2, ...range });
      expect(queued.status).toBe('queued');
      expect(queued.total).toBe(2);
      const done = await waitFor(queue, queued.id, finished);
      expect(done.status).toBe('succeeded');
      expect(done.result).toEqual({ succeeded: 2, failed: 0, skipped: 0, stopped: false });
      expect(done.events.map((e) => e.chapter.index)).toEqual([1, 2]);
      expect(done.startedAt).not.toBeNull();
      expect(done.finishedAt).not.toBeNull();
      expect((await queue.list()).map((j) => j.id)).toContain(queued.id);
      expect(await queue.isBusy()).toBe(false);
    } finally {
      await queue.close();
    }
  });

  it('rejects unplannable jobs before they reach Redis', async () => {
    const queue = openQueue(false);
    try {
      await expect(queue.enqueue('ed_missing', { from: 0, to: null, ...range })).rejects.toMatchObject({
        code: 'not_found',
      });
      expect(await queue.get('job_nope')).toBeUndefined();
      expect(await queue.cancel('job_nope')).toBeUndefined();
    } finally {
      await queue.close();
    }
  });

  it('cancels a waiting job with no worker, and a running one at a chapter boundary', async () => {
    const queue = openQueue(false);
    try {
      const waiting = await queue.enqueue(editionId, all);
      expect(await queue.isBusy()).toBe(true);
      expect((await queue.cancel(waiting.id))?.status).toBe('cancelled');
      expect(await queue.isBusy()).toBe(false);

      const running = await queue.enqueue(editionId, all);
      const { stop } = startWorker();
      try {
        await waitFor(queue, running.id, (job) => job.status === 'running' && job.events.length >= 1);
        await queue.cancel(running.id);
        const done = await waitFor(queue, running.id, finished);
        expect({ status: done.status, error: done.error }).toEqual({ status: 'cancelled', error: null });
        expect(done.result?.stopped).toBe(true);
        expect(done.events.length).toBeGreaterThanOrEqual(1);
        expect(done.events.length).toBeLessThan(CHAPTERS + 1);

        const drained = await waitFor(queue, waiting.id, finished);
        expect(drained.status).toBe('cancelled');
        expect(drained.events).toEqual([]);
      } finally {
        await stop();
      }
    } finally {
      await queue.close();
    }
  });

  it('resumes a job interrupted by a worker shutdown from the next chapter', async () => {
    const queue = openQueue(false);
    try {
      const job = await queue.enqueue(editionId, all);
      const first = startWorker();
      await waitFor(queue, job.id, (j) => j.status === 'running' && j.events.length >= 1);
      await first.stop();

      const paused = await queue.get(job.id);
      expect(paused?.status).toBe('queued');
      const seen = paused?.events.length ?? 0;
      expect(seen).toBeGreaterThanOrEqual(1);
      expect(seen).toBeLessThan(CHAPTERS + 1);

      const second = startWorker();
      try {
        const done = await waitFor(queue, job.id, finished);
        expect(done.status).toBe('succeeded');
        expect(done.events.map((e) => e.chapter.index)).toEqual(Array.from({ length: CHAPTERS + 1 }, (_, i) => i));
        expect(done.result?.succeeded).toBe(CHAPTERS + 1);
      } finally {
        await second.stop();
      }
    } finally {
      await queue.close();
    }
  });
});

describe.skipIf(available)('BullJobQueue (skipped)', () => {
  it(`is skipped because no Redis answers at ${REDIS_URL}`, () => {
    expect(available).toBe(false);
  });
});
