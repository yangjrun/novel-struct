import { asc, count, eq } from 'drizzle-orm';
import type { SegmentKind } from '@novelstruct/core';
import type { Db } from '../client.js';
import { entityMentions, chapters, segments } from '../schema/index.js';

/** Compact segment row for whole-edition aggregation; text is deliberately excluded. */
export interface EditionSegmentRow {
  readonly chapterId: string;
  readonly kind: SegmentKind;
  readonly charStart: number;
  readonly charEnd: number;
  readonly speakerEntityId: string | null;
  readonly speakerSurface: string | null;
}

export interface MentionCountRow {
  readonly chapterId: string;
  readonly entityId: string;
  readonly count: number;
}

export async function listEditionSegments(db: Db, editionId: string): Promise<EditionSegmentRow[]> {
  return db
    .select({
      chapterId: segments.chapterId,
      kind: segments.kind,
      charStart: segments.charStart,
      charEnd: segments.charEnd,
      speakerEntityId: segments.speakerEntityId,
      speakerSurface: segments.speakerSurface,
    })
    .from(segments)
    .innerJoin(chapters, eq(chapters.id, segments.chapterId))
    .where(eq(chapters.editionId, editionId))
    .orderBy(asc(chapters.index), asc(segments.index));
}

export async function listEditionMentionCounts(db: Db, editionId: string): Promise<MentionCountRow[]> {
  return db
    .select({ chapterId: entityMentions.chapterId, entityId: entityMentions.entityId, count: count(entityMentions.id) })
    .from(entityMentions)
    .innerJoin(chapters, eq(chapters.id, entityMentions.chapterId))
    .where(eq(chapters.editionId, editionId))
    .groupBy(entityMentions.chapterId, entityMentions.entityId);
}
