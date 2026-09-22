import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  createBook,
  type DbHandle,
  ensureDefaultLibrary,
  finishParseRun,
  getChapterByIndex,
  importNormalizedBook,
  markRunInterrupted,
  openDatabase,
  startParseRun,
  summarizeUsage,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));
const heuristic = { pass: 'structure', attributor: 'heuristic', promptVersion: 'h/1' } as const;
const llm = { pass: 'structure', attributor: 'llm', promptVersion: 'l/1', model: 'mimo' } as const;

let handle: DbHandle;
let editionId: string;
let otherEditionId: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  const bookId = await createBook(handle.db, { libraryId, title: '用量' });
  const normalized = normalizeNovel(fixture);
  editionId = (await importNormalizedBook(handle.db, { bookId, label: 'v1', sourceFormat: 'txt', normalized }))
    .editionId;
  otherEditionId = (await importNormalizedBook(handle.db, { bookId, label: 'v2', sourceFormat: 'txt', normalized }))
    .editionId;

  const one = (await getChapterByIndex(handle.db, editionId, 1))!.id;
  const two = (await getChapterByIndex(handle.db, editionId, 2))!.id;
  const first = await startParseRun(handle.db, { editionId, chapterId: one, ...heuristic, attempt: 1 });
  await finishParseRun(handle.db, first, { status: 'failed', error: 'x' });
  const second = await startParseRun(handle.db, { editionId, chapterId: one, ...heuristic, attempt: 2 });
  await finishParseRun(handle.db, second, { status: 'succeeded' });

  const a = await startParseRun(handle.db, { editionId, chapterId: one, ...llm, attempt: 1 });
  await finishParseRun(handle.db, a, { status: 'succeeded', inputTokens: 1000, outputTokens: 100 });
  const b = await startParseRun(handle.db, { editionId, chapterId: two, ...llm, attempt: 1 });
  await finishParseRun(handle.db, b, { status: 'failed', error: 'timeout', inputTokens: 500, outputTokens: 0 });
  const c = await startParseRun(handle.db, { editionId, chapterId: two, ...llm, attempt: 2 });
  await markRunInterrupted(handle.db, c, '死了');
});

afterAll(async () => {
  await handle.close();
});

describe('summarizeUsage', () => {
  it('groups token totals by edition, attributor and model, counting every run', async () => {
    const rows = await summarizeUsage(handle.db, { editionId });
    expect(rows.map((r) => [r.attributor, r.model])).toEqual([
      ['heuristic', null],
      ['llm', 'mimo'],
    ]);
    expect(rows[0]).toMatchObject({
      bookTitle: '用量',
      editionLabel: 'v1',
      runs: 2,
      succeeded: 1,
      failed: 1,
      chapters: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(rows[1]).toMatchObject({
      runs: 3,
      succeeded: 1,
      failed: 1,
      chapters: 2,
      inputTokens: 1500,
      outputTokens: 100,
    });
    expect(rows[1]?.lastRunAt).toBeInstanceOf(Date);
  });

  it('returns nothing for an edition without runs and everything without a filter', async () => {
    expect(await summarizeUsage(handle.db, { editionId: otherEditionId })).toEqual([]);
    expect((await summarizeUsage(handle.db)).map((r) => r.editionId)).toEqual([editionId, editionId]);
  });
});
