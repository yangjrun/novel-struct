import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import {
  commitChapterIR,
  createBook,
  deleteBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  listScenesToIndex,
  openDatabase,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { indexEditionScenes, searchScenes, type Embedder } from '../src/index.js';

let handle: DbHandle;
let books: string[];
let editions: string[];
const embedding = (value: number): number[] => [value, 1 - value, ...Array<number>(1534).fill(0)];
const embedder: Embedder = { model: 'test-embedding', embed: async (input) => embedding(input.includes('桥') ? 0 : 1) };

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  books = [];
  editions = [];
  for (const [i, text] of ['桥边相遇，桥下流水。', '山顶看日出，山间起雾。'].entries()) {
    const bookId = await createBook(handle.db, { libraryId, title: `检索书${i}` });
    const imported = await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode(`第一章 开始\n${text}`)),
    });
    const chapter = await getChapterByIndex(handle.db, imported.editionId, 0);
    if (!chapter) throw new Error('missing chapter');
    await commitChapterIR(
      handle.db,
      ChapterIRSchema.parse({
        irVersion: '0.1',
        bookId,
        editionId: imported.editionId,
        chapterId: chapter.id,
        charCount: chapter.text.length,
        scenes: [{ id: `scn_${i}`, index: 0, charStart: 0, charEnd: chapter.text.length, characterIds: [] }],
        segments: [
          {
            id: `seg_${i}`,
            sceneId: `scn_${i}`,
            index: 0,
            kind: 'narration',
            charStart: 0,
            charEnd: chapter.text.length,
          },
        ],
        entities: [],
        mentions: [],
        provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
      }),
    );
    books.push(bookId);
    editions.push(imported.editionId);
  }
});

afterAll(async () => {
  await handle.close();
});

it('indexes each scene once and ranks only within an explicit book scope', async () => {
  expect((await indexEditionScenes(handle.db, { editionId: editions[0]!, embedder })).indexed).toBe(1);
  expect((await indexEditionScenes(handle.db, { editionId: editions[0]!, embedder })).indexed).toBe(0);
  await indexEditionScenes(handle.db, { editionId: editions[1]!, embedder });
  const all = await searchScenes(handle.db, { query: '山', bookIds: books, embedder });
  expect(all.map((hit) => hit.bookId)).toEqual([books[1], books[0]]);
  expect(all[0]?.excerpt).toContain('山顶');
  expect(all[0]?.charStart).toBe(0);
  expect((await searchScenes(handle.db, { query: '山', bookIds: [books[0]!], embedder })).map((h) => h.bookId)).toEqual(
    [books[0]],
  );
});

it('discards vectors on re-parse and delete without leaving orphan retrieval results', async () => {
  const chapter = await getChapterByIndex(handle.db, editions[0]!, 0);
  if (!chapter) throw new Error('missing chapter');
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId: books[0],
      editionId: editions[0],
      chapterId: chapter.id,
      charCount: chapter.text.length,
      scenes: [{ id: 'scn_replaced', index: 0, charStart: 0, charEnd: chapter.text.length, characterIds: [] }],
      segments: [
        {
          id: 'seg_replaced',
          sceneId: 'scn_replaced',
          index: 0,
          kind: 'narration',
          charStart: 0,
          charEnd: chapter.text.length,
        },
      ],
      entities: [],
      mentions: [],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
  expect(await listScenesToIndex(handle.db, [editions[0]!], embedder.model)).toHaveLength(1);
  expect(await searchScenes(handle.db, { query: '桥', bookIds: [books[0]!], embedder })).toEqual([]);
  await indexEditionScenes(handle.db, { editionId: editions[0]!, embedder });
  await deleteBook(handle.db, books[0]!);
  expect(await listScenesToIndex(handle.db, [editions[0]!], embedder.model)).toEqual([]);
});
