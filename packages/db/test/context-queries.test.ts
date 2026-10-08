import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  chapters,
  createBook,
  ensureDefaultLibrary,
  entities,
  entityMentions,
  getChapterByIndex,
  importNormalizedBook,
  recentEntityMentions,
  sourceRefs,
} from '../src/index.js';
import { createLoggedDatabase } from './helpers/logged-database.js';

const handle = createLoggedDatabase();
const IDS = ['ent_history_a', 'ent_history_b'];
const OFFSETS = [0, 2, 4, 100, 180, 180];
let bookId: string;
let editionId: string;
let otherEditionId: string;
let otherBookId: string;

async function addMentions(targetEditionId: string, entityId: string, index: number): Promise<void> {
  const chapter = (await getChapterByIndex(handle.db, targetEditionId, index))!;
  for (const [position, charStart] of OFFSETS.entries()) {
    const id = `${targetEditionId}-${entityId}-${index}-${position}`;
    const quote = chapter.text.slice(charStart, charStart + 2);
    await handle.db.insert(sourceRefs).values({
      id: `src-${id}`,
      editionId: targetEditionId,
      chapterId: chapter.id,
      charStart,
      charEnd: charStart + 2,
      quote,
    });
    await handle.db.insert(entityMentions).values({
      id: `mention-${id}`,
      entityId,
      chapterId: chapter.id,
      sourceRefId: `src-${id}`,
      surface: quote,
      confidence: 1,
    });
  }
}

beforeAll(async () => {
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookId = await createBook(handle.db, { libraryId, title: '历史提及边界' });
  otherBookId = await createBook(handle.db, { libraryId, title: '其他书' });
  const normalized = normalizeNovel(
    new TextEncoder().encode(
      ['第一章 往事', '第二章 昨日', '第三章 今日', '第四章 以后']
        .map((heading, index) => `${heading}\n🧭青崖${'甲'.repeat(300)}${index}`)
        .join('\n'),
    ),
  );
  editionId = (await importNormalizedBook(handle.db, { bookId, label: 'v1', sourceFormat: 'txt', normalized }))
    .editionId;
  otherEditionId = (await importNormalizedBook(handle.db, { bookId, label: 'v2', sourceFormat: 'txt', normalized }))
    .editionId;
  await handle.db
    .insert(entities)
    .values([
      ...IDS.map((id) => ({ id, bookId, type: 'character' as const, canonicalName: id, confidence: 1 })),
      { id: 'ent_foreign', bookId: otherBookId, type: 'character', canonicalName: '外书角色', confidence: 1 },
    ]);
  for (const id of IDS) {
    for (let index = 0; index < 4; index += 1) await addMentions(editionId, id, index);
    await addMentions(otherEditionId, id, 1);
  }
  await addMentions(editionId, 'ent_foreign', 1);
});

afterAll(async () => handle.close());

/** Independent reference for the previous full-read-and-truncate semantics. */
async function previousResult(beforeIndex: number, entityIds: readonly string[]) {
  const rows = await handle.db
    .select({
      entityId: entityMentions.entityId,
      chapterIndex: chapters.index,
      charStart: sourceRefs.charStart,
      text: chapters.text,
    })
    .from(entityMentions)
    .innerJoin(chapters, eq(chapters.id, entityMentions.chapterId))
    .innerJoin(sourceRefs, eq(sourceRefs.id, entityMentions.sourceRefId))
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(
      and(
        eq(entities.bookId, bookId),
        eq(chapters.editionId, editionId),
        lt(chapters.index, beforeIndex),
        inArray(entityMentions.entityId, entityIds),
      ),
    )
    .orderBy(asc(entityMentions.entityId), desc(chapters.index), desc(sourceRefs.charStart), asc(entityMentions.id));
  return [...new Set(entityIds)]
    .sort()
    .flatMap((entityId) => rows.filter((row) => row.entityId === entityId).slice(0, 3))
    .map(({ entityId, chapterIndex, charStart, text }) => ({
      entityId,
      chapterIndex,
      charStart,
      excerpt: text.slice(Math.max(0, charStart - 100), charStart + 100),
    }));
}

describe('bounded historical mentions', () => {
  it('returns exactly the prior result while applying the per-entity limit in one SQL query', async () => {
    const input = [IDS[1]!, IDS[0]!, IDS[1]!, 'ent_missing', 'ent_foreign'];
    const expected = await previousResult(2, input);
    handle.clearQueries();
    const result = await recentEntityMentions(handle.db, bookId, editionId, 2, input);
    expect(result).toEqual(expected);
    expect(result).toHaveLength(6);
    expect(result.map((row) => row.entityId)).toEqual([IDS[0], IDS[0], IDS[0], IDS[1], IDS[1], IDS[1]]);
    expect(result.map((row) => row.charStart)).toEqual([180, 180, 100, 180, 180, 100]);
    expect(result.every((row) => row.chapterIndex === 1)).toBe(true);
    expect(handle.queries).toHaveLength(1);
    expect(handle.queries[0]!.sql).toMatch(/row_number\(\)\s+over\s*\(/i);
    expect(handle.queries[0]!.sql).toContain('partition by');
    expect(handle.queries[0]!.params).toContain(3);
  });

  it('preserves JS UTF-16 slicing and clamping at the start of a chapter', async () => {
    const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
    const entityId = 'ent_unicode';
    await handle.db
      .insert(entities)
      .values({ id: entityId, bookId, type: 'character', canonicalName: 'Unicode', confidence: 1 });
    for (const charStart of [0, 2]) {
      const id = `unicode-${charStart}`;
      const quote = chapter.text.slice(charStart, charStart + 2);
      await handle.db
        .insert(sourceRefs)
        .values({ id, editionId, chapterId: chapter.id, charStart, charEnd: charStart + 2, quote });
      await handle.db
        .insert(entityMentions)
        .values({ id, entityId, chapterId: chapter.id, sourceRefId: id, surface: quote, confidence: 1 });
    }
    const result = await recentEntityMentions(handle.db, bookId, editionId, 1, [entityId]);
    expect(result).toEqual([
      { entityId, chapterIndex: 0, charStart: 2, excerpt: chapter.text.slice(0, 102) },
      { entityId, chapterIndex: 0, charStart: 0, excerpt: chapter.text.slice(0, 100) },
    ]);
    expect(result[0]!.excerpt.startsWith('🧭青崖')).toBe(true);
  });

  it('keeps the cutoff strict and does not mix books or editions', async () => {
    expect(await recentEntityMentions(handle.db, bookId, editionId, 0, IDS)).toEqual([]);
    expect(await recentEntityMentions(handle.db, otherBookId, editionId, 2, IDS)).toEqual([]);
    expect(await recentEntityMentions(handle.db, bookId, 'ed_missing', 2, IDS)).toEqual([]);
    const first = await recentEntityMentions(handle.db, bookId, editionId, 1, IDS);
    expect(first).toHaveLength(6);
    expect(first.every((row) => row.chapterIndex === 0)).toBe(true);
    const alternate = await recentEntityMentions(handle.db, bookId, otherEditionId, 4, IDS);
    expect(alternate).toHaveLength(6);
    expect(alternate.every((row) => row.chapterIndex === 1)).toBe(true);
  });

  it('does not execute SQL for an empty entity list', async () => {
    handle.clearQueries();
    expect(await recentEntityMentions(handle.db, bookId, editionId, 2, [])).toEqual([]);
    expect(handle.queries).toEqual([]);
  });
});
