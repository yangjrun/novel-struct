import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  createBook,
  type DbHandle,
  ensureDefaultLibrary,
  finishParseRun,
  getChapterByIndex,
  heartbeatParseRun,
  importNormalizedBook,
  inspectChapterRuns,
  listEditionParseRuns,
  markRunInterrupted,
  openDatabase,
  parseRuns,
  startParseRun,
  sweepStaleRuns,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));
const MINUTE = 60_000;

const heuristic = { pass: 'structure', attributor: 'heuristic', promptVersion: 'test/1' } as const;
const llm = { pass: 'structure', attributor: 'llm', promptVersion: 'test/1', model: 'm' } as const;

let handle: DbHandle;
let editionId: string;
let chapterOne: string;
let chapterTwo: string;
let chapterThree: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  const bookId = await createBook(handle.db, { libraryId, title: '解析记录' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(fixture),
    })
  ).editionId;
  const ids = await Promise.all([1, 2, 3].map((i) => getChapterByIndex(handle.db, editionId, i)));
  [chapterOne, chapterTwo, chapterThree] = ids.map((c) => c!.id) as [string, string, string];
});

afterAll(async () => {
  await handle.close();
});

async function runById(id: string) {
  const run = (await listEditionParseRuns(handle.db, editionId)).find((r) => r.id === id);
  if (run === undefined) throw new Error(`run ${id} missing`);
  return run;
}

describe('parse run lifecycle', () => {
  it('numbers attempts per key and counts only failed outcomes against the chapter', async () => {
    expect(await inspectChapterRuns(handle.db, chapterOne, heuristic)).toEqual({
      succeeded: false,
      failedAttempts: 0,
      attempts: 0,
      running: undefined,
    });

    const first = await startParseRun(handle.db, {
      editionId,
      chapterId: chapterOne,
      ...heuristic,
      attempt: 1,
      workerId: 'test:1',
    });
    const whileRunning = await inspectChapterRuns(handle.db, chapterOne, heuristic);
    expect(whileRunning.attempts).toBe(1);
    expect(whileRunning.running).toMatchObject({ id: first, workerId: 'test:1', attributor: 'heuristic' });
    expect(whileRunning.running?.heartbeatAt).toBeInstanceOf(Date);

    await finishParseRun(handle.db, first, { status: 'failed', error: 'boom' });
    expect(await inspectChapterRuns(handle.db, chapterOne, heuristic)).toMatchObject({
      succeeded: false,
      failedAttempts: 1,
      attempts: 1,
      running: undefined,
    });

    const second = await startParseRun(handle.db, { editionId, chapterId: chapterOne, ...heuristic, attempt: 2 });
    await finishParseRun(handle.db, second, { status: 'succeeded', inputTokens: 10, outputTokens: 5 });
    expect(await inspectChapterRuns(handle.db, chapterOne, heuristic)).toMatchObject({
      succeeded: true,
      failedAttempts: 1,
      attempts: 2,
    });
    expect((await runById(second)).attempt).toBe(2);

    const otherKey = await inspectChapterRuns(handle.db, chapterOne, { ...heuristic, promptVersion: 'test/2' });
    expect(otherKey).toMatchObject({ succeeded: false, failedAttempts: 0, attempts: 0 });
  });

  it('reports a running run of any key, and an interrupted run counts for nobody', async () => {
    const foreign = await startParseRun(handle.db, {
      editionId,
      chapterId: chapterTwo,
      ...llm,
      attempt: 1,
      workerId: 'gpu:7',
    });
    const seen = await inspectChapterRuns(handle.db, chapterTwo, heuristic);
    expect(seen.attempts).toBe(0);
    expect(seen.running).toMatchObject({ id: foreign, workerId: 'gpu:7', attributor: 'llm' });

    expect(await markRunInterrupted(handle.db, foreign, '测试中断')).toBe(true);
    expect(await markRunInterrupted(handle.db, foreign, '再来一次')).toBe(false);
    expect(await runById(foreign)).toMatchObject({ status: 'interrupted', error: '测试中断' });
    expect((await runById(foreign)).finishedAt).toBeInstanceOf(Date);

    expect(await inspectChapterRuns(handle.db, chapterTwo, llm)).toMatchObject({
      succeeded: false,
      failedAttempts: 0,
      attempts: 1,
      running: undefined,
    });
  });

  it('refreshes the heartbeat only while running, and falls back to the start time', async () => {
    const run = await startParseRun(handle.db, { editionId, chapterId: chapterTwo, ...heuristic, attempt: 1 });
    const old = new Date(Date.now() - 5 * MINUTE);
    await heartbeatParseRun(handle.db, run, old);
    expect((await inspectChapterRuns(handle.db, chapterTwo, heuristic)).running?.heartbeatAt).toEqual(old);

    await handle.db.update(parseRuns).set({ heartbeatAt: null }).where(eq(parseRuns.id, run));
    const fallback = (await inspectChapterRuns(handle.db, chapterTwo, heuristic)).running;
    expect(fallback?.heartbeatAt).toEqual(fallback?.startedAt);

    await finishParseRun(handle.db, run, { status: 'succeeded' });
    await heartbeatParseRun(handle.db, run);
    expect((await runById(run)).heartbeatAt).toBeNull();
  });

  it('sweeps only running runs whose heartbeat is older than the threshold', async () => {
    const fresh = await startParseRun(handle.db, { editionId, chapterId: chapterThree, ...heuristic, attempt: 1 });
    const stale = await startParseRun(handle.db, { editionId, chapterId: chapterThree, ...llm, attempt: 1 });
    await heartbeatParseRun(handle.db, stale, new Date(Date.now() - 2 * MINUTE));

    expect(await sweepStaleRuns(handle.db, MINUTE)).toEqual([stale]);
    expect(await runById(stale)).toMatchObject({ status: 'interrupted', error: expect.stringContaining('心跳') });
    expect((await runById(fresh)).status).toBe('running');

    expect(await sweepStaleRuns(handle.db, 0)).toEqual([fresh]);
    expect(await sweepStaleRuns(handle.db, 0)).toEqual([]);
  });
});
