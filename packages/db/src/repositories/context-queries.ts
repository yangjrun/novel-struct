import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chapters, entities, entityMentions, foreshadows, sourceRefs, stateFacts } from '../schema/index.js';

export interface HistoricalMention {
  readonly entityId: string;
  readonly chapterIndex: number;
  readonly charStart: number;
  readonly excerpt: string;
}

export async function recentEntityMentions(
  db: Db,
  bookId: string,
  editionId: string,
  beforeIndex: number,
  entityIds: readonly string[],
): Promise<HistoricalMention[]> {
  if (!entityIds.length) return [];
  const rows = await db
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
  const counts = new Map<string, number>();
  return rows.flatMap((row) => {
    const count = counts.get(row.entityId) ?? 0;
    counts.set(row.entityId, count + 1);
    return count >= 3
      ? []
      : [
          {
            entityId: row.entityId,
            chapterIndex: row.chapterIndex,
            charStart: row.charStart,
            excerpt: row.text.slice(Math.max(0, row.charStart - 100), row.charStart + 100),
          },
        ];
  });
}

export async function currentEntityStates(
  db: Db,
  editionId: string,
  beforeIndex: number,
  entityIds: readonly string[],
) {
  if (!entityIds.length) return [];
  const rows = await db
    .select({
      id: stateFacts.id,
      entityId: stateFacts.entityId,
      field: stateFacts.field,
      value: stateFacts.value,
      chapterIndex: chapters.index,
    })
    .from(stateFacts)
    .innerJoin(chapters, eq(chapters.id, stateFacts.validFromChapterId))
    .where(
      and(
        eq(stateFacts.editionId, editionId),
        isNull(stateFacts.validToChapterId),
        lt(chapters.index, beforeIndex),
        inArray(stateFacts.entityId, entityIds),
      ),
    )
    .orderBy(asc(stateFacts.entityId), asc(stateFacts.field), desc(chapters.index), asc(stateFacts.id));
  const counts = new Map<string, number>();
  return rows.filter((row) => {
    const n = counts.get(row.entityId) ?? 0;
    counts.set(row.entityId, n + 1);
    return n < 20;
  });
}

export async function unresolvedForeshadows(db: Db, editionId: string, beforeIndex: number) {
  return db
    .select({ id: foreshadows.id, summary: foreshadows.summary, chapterIndex: chapters.index })
    .from(foreshadows)
    .innerJoin(chapters, eq(chapters.id, foreshadows.plantedChapterId))
    .where(
      and(eq(foreshadows.editionId, editionId), isNull(foreshadows.resolvedChapterId), lt(chapters.index, beforeIndex)),
    )
    .orderBy(desc(chapters.index), asc(foreshadows.id))
    .limit(20);
}
