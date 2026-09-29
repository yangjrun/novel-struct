import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  saveWeKnoraDocument,
  saveWeKnoraKb,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { retrieveWeKnoraEvidence } from '../src/index.js';

let handle: DbHandle;
let bookId: string;
let editionId: string;
let first: NonNullable<Awaited<ReturnType<typeof getChapterByIndex>>>;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '检索边界' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(
        new TextEncoder().encode(
          '第一章 一\n青崖在石桥。回声。回声。\n第二章 二\n青崖在山顶。\n第三章 三\n青崖在海边。',
        ),
      ),
    })
  ).editionId;
  await saveWeKnoraKb(handle.db, editionId, 'kb-evidence');
  for (let i = 0; i < 3; i++) {
    const chapter = (await getChapterByIndex(handle.db, editionId, i))!;
    if (i === 0) first = chapter;
    await saveWeKnoraDocument(handle.db, chapter.id, `doc-${i}`, chapter.contentHash);
  }
});
afterAll(async () => {
  await handle.close();
});

it('accepts only unique, current local text from earlier chapters of the requested edition', async () => {
  const search = vi.fn(async () => [
    { id: 'valid', knowledge_id: 'doc-0', knowledge_base_id: 'kb-evidence', content: '青崖在石桥。', score: 0.9 },
    { id: 'duplicate', knowledge_id: 'doc-0', content: '青崖在石桥。', score: 0.8 },
    { id: 'current', knowledge_id: 'doc-1', content: '青崖在山顶。', score: 1 },
    { id: 'future', knowledge_id: 'doc-2', content: '青崖在海边。', score: 1 },
    { id: 'wrong-kb', knowledge_id: 'doc-0', knowledge_base_id: 'other', content: '青崖在石桥。', score: 1 },
    { id: 'unmapped', knowledge_id: 'other-doc', content: '青崖在石桥。', score: 1 },
    { id: 'ambiguous', knowledge_id: 'doc-0', content: '回声。', score: 1 },
    { id: 'changed', knowledge_id: 'doc-0', content: '青崖飞走了。', score: 1 },
  ]);
  const input = { bookId, editionId, beforeChapterIndex: 1, query: '青崖', client: { search } };
  const result = await retrieveWeKnoraEvidence(handle.db, input);
  expect(search).toHaveBeenCalledWith('kb-evidence', '青崖', 50);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ editionId, chapterId: first.id, chapterIndex: 0, chunkId: 'valid' });
  expect(first.text.slice(result[0]!.charStart, result[0]!.charEnd)).toBe(result[0]!.quote);
  await expect(retrieveWeKnoraEvidence(handle.db, { ...input, bookId: 'wrong' })).rejects.toThrow('不匹配');
  search.mockClear();
  expect(await retrieveWeKnoraEvidence(handle.db, { ...input, beforeChapterIndex: 0 })).toEqual([]);
  expect(search).not.toHaveBeenCalled();
});

it('discards a document whose indexed hash no longer matches the chapter', async () => {
  await saveWeKnoraDocument(handle.db, first.id, 'doc-0', 'stale');
  const result = await retrieveWeKnoraEvidence(handle.db, {
    bookId,
    editionId,
    beforeChapterIndex: 1,
    query: '青崖',
    client: {
      search: async () => [{ id: 'old', knowledge_id: 'doc-0', content: '青崖在石桥。', score: 1 }],
    },
  });
  expect(result).toEqual([]);
});
