import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  commitChapterIR,
  commitConsistencyFacts,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  memoryItems,
  openDatabase,
  type DbHandle,
} from '@novelstruct/db';
import { createPostgresMemoryStore } from '../src/index.js';

let handle: DbHandle;
let bookId: string;
let editionId: string;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '记忆测试' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode('第一章 一\n青崖来到石桥。\n第二章 二\n青崖来到山顶。')),
    })
  ).editionId;
  for (let index = 0; index < 2; index++) {
    const chapter = (await getChapterByIndex(handle.db, editionId, index))!;
    await commitChapterIR(
      handle.db,
      ChapterIRSchema.parse({
        irVersion: '0.1',
        bookId,
        editionId,
        chapterId: chapter.id,
        charCount: chapter.text.length,
        scenes: [
          {
            id: `scn_memory${index}`,
            index: 0,
            charStart: 0,
            charEnd: chapter.text.length,
            characterIds: ['ent_memory'],
          },
        ],
        segments: [
          {
            id: `seg_memory${index}`,
            sceneId: `scn_memory${index}`,
            index: 0,
            kind: 'narration',
            charStart: 0,
            charEnd: chapter.text.length,
          },
        ],
        entities: [
          {
            id: 'ent_memory',
            type: 'character',
            canonicalName: '青崖',
            aliases: [],
            confidence: 1,
            isNew: index === 0,
          },
        ],
        mentions: [],
        provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
      }),
    );
  }
  for (let index = 0; index < 2; index++) {
    const chapter = (await getChapterByIndex(handle.db, editionId, index))!;
    const evidence = { charStart: 0, charEnd: chapter.text.length, quote: chapter.text };
    await commitConsistencyFacts(handle.db, {
      bookId,
      editionId,
      chapterId: chapter.id,
      states: [
        { entityId: 'ent_memory', field: '位置', value: index === 0 ? '石桥' : '山顶', confidence: 1, evidence },
      ],
      relationships: [],
      events: [],
      foreshadows: [],
    });
  }
});
afterAll(async () => {
  await handle.close();
});

it('refreshes memory in the fact transaction, including the end of superseded state', async () => {
  const memory = createPostgresMemoryStore(handle.db);
  expect(await handle.db.select().from(memoryItems)).toHaveLength(2);
  expect((await memory.recallState(bookId, 'ent_memory', 0, editionId)).map((hit) => hit.content)).toEqual([
    '位置: 石桥',
  ]);
  expect((await memory.recallState(bookId, 'ent_memory', 1, editionId)).map((hit) => hit.content)).toEqual([
    '位置: 山顶',
  ]);
  expect(await memory.recallSimilar(bookId, '山顶', 10, editionId, 0)).toEqual([]);
  expect(await memory.recallSimilar(bookId, '石桥', 10, editionId, 1)).toEqual([]);
  expect((await memory.recallSimilar(bookId, '青崖来到山顶。', 10, editionId, 1))[0]?.content).toBe('位置: 山顶');
  await expect(memory.recallSimilar(bookId, '桥', 10, editionId, -1)).rejects.toThrow('index');
});

it('rebuilds deterministically from facts and recalls state at the requested chapter', async () => {
  const memory = createPostgresMemoryStore(handle.db);
  expect(await memory.rebuild(bookId)).toBe(2);
  expect(await memory.rebuild(bookId)).toBe(2);
  expect(await handle.db.select().from(memoryItems)).toHaveLength(2);
  expect((await memory.recallState(bookId, 'ent_memory', 0, editionId)).map((item) => item.content)).toEqual([
    '位置: 石桥',
  ]);
  expect((await memory.recallState(bookId, 'ent_memory', 1, editionId)).map((item) => item.content)).toEqual([
    '位置: 山顶',
  ]);
  expect((await memory.recallSimilar(bookId, '山顶', 2, editionId))[0]?.content).toContain('山顶');
  await expect(memory.recallState(bookId, 'ent_memory', 1, 'ed_wrong')).rejects.toThrow('不匹配');
});
