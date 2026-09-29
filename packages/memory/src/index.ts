import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { chapters, getEdition, memoryItems, rebuildBookMemory, type Db } from '@novelstruct/db';

export interface MemoryHit {
  readonly room: string;
  readonly entityId: string | null;
  readonly content: string;
  readonly sourceFactTable: string;
  readonly sourceFactId: string;
}

export interface MemoryStore {
  recallState(bookId: string, entityId: string, atChapterIndex: number, editionId: string): Promise<MemoryHit[]>;
  recallSimilar(
    bookId: string,
    query: string,
    limit: number,
    editionId: string,
    atChapterIndex?: number,
  ): Promise<MemoryHit[]>;
  rebuild(bookId: string): Promise<number>;
}

/** Rebuilds a disposable materialized view of fact rows without consulting previous memory. */
export function createPostgresMemoryStore(db: Db): MemoryStore {
  const verifyScope = async (bookId: string, editionId: string): Promise<void> => {
    const edition = await getEdition(db, editionId);
    if (!edition || edition.book.id !== bookId) throw new Error('记忆检索的书与版本不匹配');
  };
  return {
    rebuild: (bookId) => rebuildBookMemory(db, bookId),
    async recallState(bookId, entityId, atChapterIndex, editionId) {
      await verifyScope(bookId, editionId);
      validateChapterIndex(atChapterIndex);
      const rows = await db
        .select({ item: memoryItems, startIndex: chapters.index })
        .from(memoryItems)
        .innerJoin(chapters, eq(chapters.id, memoryItems.validFromChapterId))
        .where(
          and(
            eq(memoryItems.bookId, bookId),
            eq(memoryItems.editionId, editionId),
            eq(memoryItems.room, 'state'),
            eq(memoryItems.entityId, entityId),
            lte(chapters.index, atChapterIndex),
          ),
        )
        .orderBy(asc(chapters.index), asc(memoryItems.id));
      const endIds = rows.map((row) => row.item.validToChapterId).filter((id): id is string => !!id);
      const ends = endIds.length
        ? await db.select({ id: chapters.id, index: chapters.index }).from(chapters).where(inArray(chapters.id, endIds))
        : [];
      const endIndex = new Map(ends.map((ch) => [ch.id, ch.index] as const));
      return rows
        .filter(
          ({ item }) => item.validToChapterId === null || (endIndex.get(item.validToChapterId) ?? -1) > atChapterIndex,
        )
        .map(({ item }) => ({
          room: item.room,
          entityId: item.entityId,
          content: item.content,
          sourceFactTable: item.sourceFactTable,
          sourceFactId: item.sourceFactId,
        }));
    },
    async recallSimilar(bookId, query, limit, editionId, atChapterIndex) {
      await verifyScope(bookId, editionId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 必须在 1 到 100 之间');
      if (atChapterIndex !== undefined) validateChapterIndex(atChapterIndex);
      if (!query.trim()) return [];
      const rows = await db
        .select({ item: memoryItems })
        .from(memoryItems)
        .innerJoin(chapters, eq(chapters.id, memoryItems.validFromChapterId))
        .where(
          and(
            eq(memoryItems.bookId, bookId),
            eq(memoryItems.editionId, editionId),
            atChapterIndex === undefined ? undefined : lte(chapters.index, atChapterIndex),
          ),
        )
        .orderBy(asc(memoryItems.id));
      const endIds = rows.flatMap(({ item }) => (item.validToChapterId ? [item.validToChapterId] : []));
      const ends =
        atChapterIndex !== undefined && endIds.length
          ? await db
              .select({ id: chapters.id, index: chapters.index })
              .from(chapters)
              .where(inArray(chapters.id, endIds))
          : [];
      const endIndex = new Map(ends.map((chapter) => [chapter.id, chapter.index]));
      const terms = [
        ...new Set(
          [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(query.trim().toLowerCase())]
            .filter((part) => part.isWordLike)
            .map((part) => part.segment),
        ),
      ];
      return rows
        .map(({ item }) => item)
        .filter(
          (item) =>
            atChapterIndex === undefined ||
            item.validToChapterId === null ||
            (endIndex.get(item.validToChapterId) ?? -1) > atChapterIndex,
        )
        .map((item) => ({ item, score: terms.filter((term) => item.content.toLowerCase().includes(term)).length }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
        .slice(0, limit)
        .map(({ item }) => ({
          room: item.room,
          entityId: item.entityId,
          content: item.content,
          sourceFactTable: item.sourceFactTable,
          sourceFactId: item.sourceFactId,
        }));
    },
  };
}

function validateChapterIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('记忆章节 index 必须是非负整数');
}
