import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  entities,
  entityAliases,
  resolveEntityNameAt,
  mergeEntities,
  splitEntity,
  enqueueEntityReview,
  finishEntityReview,
  listEntityReviews,
  type DbHandle,
} from '../src/index.js';
import { normalizeNovel } from '@novelstruct/ingest';

let handle: DbHandle;
let bookId: string;
let editionId: string;
let chapters: string[];
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '身份测试' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(
        new TextEncoder().encode('第一章 一\n正文一。\n第二章 二\n正文二。\n第三章 三\n正文三。'),
      ),
    })
  ).editionId;
  chapters = [];
  for (let i = 0; i < 3; i++) chapters.push((await getChapterByIndex(handle.db, editionId, i))!.id);
  await handle.db.insert(entities).values([
    { id: 'ent_alpha', bookId, type: 'character', canonicalName: '甲', confidence: 1 },
    { id: 'ent_beta', bookId, type: 'character', canonicalName: '乙', confidence: 1 },
  ]);
  await handle.db.insert(entityAliases).values({
    id: 'als_alpha',
    entityId: 'ent_alpha',
    alias: '神秘人',
    validFromChapterId: chapters[0],
    validToChapterId: chapters[2],
  });
});
afterAll(async () => {
  await handle.close();
});

it('respects alias intervals, audits merge/split and records low-confidence reviews', async () => {
  expect(await resolveEntityNameAt(handle.db, bookId, editionId, '神秘人', 1)).toBe('ent_alpha');
  expect(await resolveEntityNameAt(handle.db, bookId, editionId, '神秘人', 2)).toBeUndefined();
  const reviewId = await enqueueEntityReview(handle.db, {
    bookId,
    editionId,
    chapterId: chapters[1],
    kind: 'identity',
    targetId: 'ent_alpha',
    reason: '归属不确定',
    confidence: 0.55,
  });
  expect((await listEntityReviews(handle.db, bookId))[0]?.status).toBe('pending');
  expect(await finishEntityReview(handle.db, reviewId, 'approved')).toBe(true);
  await mergeEntities(handle.db, {
    bookId,
    fromId: 'ent_alpha',
    intoId: 'ent_beta',
    reason: '同一人',
    createdBy: 'test',
    chapterId: chapters[2],
  });
  expect(await resolveEntityNameAt(handle.db, bookId, editionId, '甲', 1)).toBeUndefined();
  const split = await splitEntity(handle.db, {
    bookId,
    originalId: 'ent_beta',
    newName: '丙',
    reason: '不同人',
    createdBy: 'test',
  });
  expect(await resolveEntityNameAt(handle.db, bookId, editionId, '丙', 2)).toBe(split);
});
