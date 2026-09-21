import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chapters } from '../schema/index.js';

export type ChapterRow = typeof chapters.$inferSelect;

export interface ChapterSummary {
  readonly id: string;
  readonly index: number;
  readonly kind: ChapterRow['kind'];
  readonly number: number | null;
  readonly title: string | null;
  readonly charCount: number;
}

export async function getChapterById(db: Db, chapterId: string): Promise<ChapterRow | undefined> {
  const rows = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
  return rows[0];
}

export async function getChapterByIndex(db: Db, editionId: string, index: number): Promise<ChapterRow | undefined> {
  const rows = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.editionId, editionId), eq(chapters.index, index)))
    .limit(1);
  return rows[0];
}

/** The first `chapter`-kind row carrying this heading number (第N章), the stable reference for gold sets. */
export async function getChapterByNumber(db: Db, editionId: string, number: number): Promise<ChapterRow | undefined> {
  const rows = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.editionId, editionId), eq(chapters.kind, 'chapter'), eq(chapters.number, number)))
    .orderBy(asc(chapters.index))
    .limit(1);
  return rows[0];
}

export async function listChapterSummaries(db: Db, editionId: string): Promise<ChapterSummary[]> {
  return db
    .select({
      id: chapters.id,
      index: chapters.index,
      kind: chapters.kind,
      number: chapters.number,
      title: chapters.title,
      charCount: chapters.charCount,
    })
    .from(chapters)
    .where(eq(chapters.editionId, editionId))
    .orderBy(asc(chapters.index));
}
