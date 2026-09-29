import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
  const endChapter = alias(chapters, 'state_end_chapter');
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
    .leftJoin(endChapter, eq(endChapter.id, stateFacts.validToChapterId))
    .where(
      and(
        eq(stateFacts.editionId, editionId),
        or(isNull(stateFacts.validToChapterId), gte(endChapter.index, beforeIndex)),
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
  const resolvedChapter = alias(chapters, 'foreshadow_resolved_chapter');
  return db
    .select({ id: foreshadows.id, summary: foreshadows.summary, chapterIndex: chapters.index })
    .from(foreshadows)
    .innerJoin(chapters, eq(chapters.id, foreshadows.plantedChapterId))
    .leftJoin(resolvedChapter, eq(resolvedChapter.id, foreshadows.resolvedChapterId))
    .where(
      and(
        eq(foreshadows.editionId, editionId),
        or(isNull(foreshadows.resolvedChapterId), gte(resolvedChapter.index, beforeIndex)),
        lt(chapters.index, beforeIndex),
      ),
    )
    .orderBy(desc(chapters.index), asc(foreshadows.id))
    .limit(20);
}
