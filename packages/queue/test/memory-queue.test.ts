import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openDatabase } from '@novelstruct/db';
import { importBook } from '@novelstruct/pipeline';
import type { JobDto } from '../src/contracts.js';
import { silentLogger } from '../src/log.js';
import { MemoryJobQueue } from '../src/memory-queue.js';
import { longNovel } from './helpers/long-novel.js';

const CHAPTERS = 40;
let handle: DbHandle;
let queue: MemoryJobQueue;
let editionId: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  editionId = (await importBook(handle.db, { bytes: longNovel(CHAPTERS), title: '队列测试' })).editionId;
  queue = new MemoryJobQueue({ db: handle.db, llm: undefined, logger: silentLogger, keepFinished: 2 });
});

afterAll(async () => {
  await queue.close();
  await handle.close();
});

async function waitFor(id: string, done: (job: JobDto) => boolean): Promise<JobDto> {
  for (let i = 0; i < 2000; i += 1) {
    const job = await queue.get(id);
    if (job !== undefined && done(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${id} did not reach the expected state`);
}

const finished = (job: JobDto): boolean => job.status !== 'queued' && job.status !== 'running';
const heuristic = { attributor: 'heuristic', force: false } as const;
const all = { from: 0, to: null, attributor: 'heuristic', force: true } as const;

describe('MemoryJobQueue', () => {
  it('rejects a job that cannot be planned', async () => {
    await expect(queue.enqueue('ed_missing', { from: 0, to: null, ...heuristic })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      queue.enqueue(editionId, { from: 0, to: null, attributor: 'llm', force: false }),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('runs a job to completion and records one event per chapter', async () => {
    const queued = await queue.enqueue(editionId, { from: 1, to: 2, ...heuristic });
    expect(queued.status).toBe('queued');
    expect(queued.total).toBe(2);
    const done = await waitFor(queued.id, finished);
    expect(done.status).toBe('succeeded');
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.result).toEqual({ succeeded: 2, failed: 0, skipped: 0, stopped: false });
    expect(done.events.map((e) => e.chapter.index)).toEqual([1, 2]);
  });

  it('cancels a queued job before it starts', async () => {
    const first = await queue.enqueue(editionId, all);
    const second = await queue.enqueue(editionId, all);
    const cancelled = await queue.cancel(second.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.finishedAt).not.toBeNull();
    expect((await waitFor(first.id, finished)).status).toBe('succeeded');
    expect((await queue.get(second.id))?.status).toBe('cancelled');
  });

  it('stops a running job at the next chapter boundary', async () => {
    const job = await queue.enqueue(editionId, all);
    await waitFor(job.id, (j) => j.status === 'running' && j.events.length >= 1);
    await queue.cancel(job.id);
    const done = await waitFor(job.id, finished);
    expect(done.status).toBe('cancelled');
    expect(done.result?.stopped).toBe(true);
    expect(done.events.length).toBeGreaterThanOrEqual(1);
    expect(done.events.length).toBeLessThan(CHAPTERS + 1);
  });

  it('returns undefined for unknown ids', async () => {
    expect(await queue.get('job_nope')).toBeUndefined();
    expect(await queue.cancel('job_nope')).toBeUndefined();
  });

  it('lists newest first and prunes finished jobs beyond keepFinished', async () => {
    const listed = await queue.list();
    const done = listed.filter(finished);
    expect(done.length).toBeLessThanOrEqual(2);
    const times = listed.map((j) => j.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('reports idle once every job has finished', async () => {
    expect(await queue.isBusy()).toBe(false);
  });
});
