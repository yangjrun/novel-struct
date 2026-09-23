import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import {
  chapters,
  foreshadows,
  getBook,
  getEdition,
  memoryItems,
  relationships,
  stateFacts,
  storyEvents,
  type Db,
} from '@novelstruct/db';

export interface MemoryHit {
  readonly room: string;
  readonly entityId: string | null;
  readonly content: string;
  readonly sourceFactTable: string;
  readonly sourceFactId: string;
}

export interface MemoryStore {
  recallState(bookId: string, entityId: string, atChapterIndex: number, editionId: string): Promise<MemoryHit[]>;
  recallSimilar(bookId: string, query: string, limit: number, editionId: string): Promise<MemoryHit[]>;
  rebuild(bookId: string): Promise<number>;
}

/** Rebuilds a disposable materialized view of fact rows without consulting previous memory. */
export function createPostgresMemoryStore(db: Db): MemoryStore {
  const verifyScope = async (bookId: string, editionId: string): Promise<void> => {
    const edition = await getEdition(db, editionId);
    if (!edition || edition.book.id !== bookId) throw new Error('记忆检索的书与版本不匹配');
  };
  return {
    async rebuild(bookId) {
      if (!(await getBook(db, bookId))) throw new Error(`书 ${bookId} 不存在`);
      return db.transaction(async (tx) => {
        await tx.delete(memoryItems).where(eq(memoryItems.bookId, bookId));
        const [states, relations, events, clues] = await Promise.all([
          tx.select().from(stateFacts).where(eq(stateFacts.bookId, bookId)),
          tx.select().from(relationships).where(eq(relationships.bookId, bookId)),
          tx.select().from(storyEvents).where(eq(storyEvents.bookId, bookId)),
          tx.select().from(foreshadows).where(eq(foreshadows.bookId, bookId)),
        ]);
        const items = [
          ...states.map((f) => ({
            id: `mem_state_${f.id}`,
            bookId,
            editionId: f.editionId,
            room: 'state',
            entityId: f.entityId,
            content: `${f.field}: ${f.value}`,
            validFromChapterId: f.validFromChapterId,
            validToChapterId: f.validToChapterId,
            sourceFactTable: 'state_facts',
            sourceFactId: f.id,
          })),
          ...relations.map((f) => ({
            id: `mem_relation_${f.id}`,
            bookId,
            editionId: f.editionId,
            room: 'relationship',
            entityId: f.subjectId,
            content: `${f.subjectId} ${f.predicate} ${f.objectId}`,
            validFromChapterId: f.validFromChapterId,
            validToChapterId: f.validToChapterId,
            sourceFactTable: 'relationships',
            sourceFactId: f.id,
          })),
          ...events.map((f) => ({
            id: `mem_event_${f.id}`,
            bookId,
            editionId: f.editionId,
            room: 'event',
            entityId: f.actorId,
            content: f.summary,
            validFromChapterId: f.chapterId,
            validToChapterId: null,
            sourceFactTable: 'events',
            sourceFactId: f.id,
          })),
          ...clues.map((f) => ({
            id: `mem_clue_${f.id}`,
            bookId,
            editionId: f.editionId,
            room: 'foreshadow',
            entityId: null,
            content: f.summary,
            validFromChapterId: f.plantedChapterId,
            validToChapterId: f.resolvedChapterId,
            sourceFactTable: 'foreshadows',
            sourceFactId: f.id,
          })),
        ];
        for (let offset = 0; offset < items.length; offset += 100)
          await tx.insert(memoryItems).values(items.slice(offset, offset + 100));
        return items.length;
      });
    },
    async recallState(bookId, entityId, atChapterIndex, editionId) {
      await verifyScope(bookId, editionId);
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
    async recallSimilar(bookId, query, limit, editionId) {
      await verifyScope(bookId, editionId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 必须在 1 到 100 之间');
      if (!query.trim()) return [];
      const rows = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.bookId, bookId), eq(memoryItems.editionId, editionId)))
        .orderBy(asc(memoryItems.id));
      const terms = [...new Set(query.trim().toLowerCase().split(/\s+/))];
      return rows
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
