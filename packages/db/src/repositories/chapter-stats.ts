import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chapters, segments } from '../schema/index.js';

export interface ChapterSegmentCount {
  readonly chapterId: string;
  readonly segmentCount: number;
}

/** Segment counts per chapter of an edition; chapters without segments are absent. */
export async function listChapterSegmentCounts(db: Db, editionId: string): Promise<ChapterSegmentCount[]> {
  return db
    .select({ chapterId: segments.chapterId, segmentCount: count(segments.id) })
    .from(segments)
    .innerJoin(chapters, eq(chapters.id, segments.chapterId))
    .where(eq(chapters.editionId, editionId))
    .groupBy(segments.chapterId)
    .orderBy(asc(segments.chapterId));
}
