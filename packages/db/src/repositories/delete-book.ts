import { count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  bookEditions,
  bookLocks,
  books,
  chapters,
  entities,
  entityAliases,
  entityMentions,
  parseRuns,
  scenes,
  segments,
  sourceRefs,
  volumes,
} from '../schema/index.js';

export interface DeleteBookResult {
  readonly bookId: string;
  readonly title: string;
  readonly editions: number;
  readonly chapters: number;
}

/**
 * Removes a book with every edition, chapter, parse run, structure result, entity and piece of
 * evidence, in one transaction and in dependency order (no foreign key cascades). The book's
 * lock row goes too, so the caller should hold that lock. Undefined when the book does not exist.
 */
export async function deleteBook(db: Db, bookId: string): Promise<DeleteBookResult | undefined> {
  return db.transaction(async (tx) => {
    const found = await tx.select({ title: books.title }).from(books).where(eq(books.id, bookId)).limit(1);
    const title = found[0]?.title;
    if (title === undefined) return undefined;

    const editionIds = tx.select({ id: bookEditions.id }).from(bookEditions).where(eq(bookEditions.bookId, bookId));
    const chapterIds = tx.select({ id: chapters.id }).from(chapters).where(inArray(chapters.editionId, editionIds));
    const entityIds = tx.select({ id: entities.id }).from(entities).where(eq(entities.bookId, bookId));

    const [editionCount] = await tx.select({ n: count() }).from(bookEditions).where(eq(bookEditions.bookId, bookId));
    const [chapterCount] = await tx
      .select({ n: count() })
      .from(chapters)
      .where(inArray(chapters.editionId, editionIds));

    await tx.delete(entityMentions).where(inArray(entityMentions.chapterId, chapterIds));
    await tx.delete(segments).where(inArray(segments.chapterId, chapterIds));
    await tx.delete(scenes).where(inArray(scenes.chapterId, chapterIds));
    await tx.delete(entityAliases).where(inArray(entityAliases.entityId, entityIds));
    await tx.delete(sourceRefs).where(inArray(sourceRefs.editionId, editionIds));
    await tx.delete(parseRuns).where(inArray(parseRuns.editionId, editionIds));
    // Self-referencing merged_into_id is fine: the whole set goes in one statement.
    await tx.delete(entities).where(eq(entities.bookId, bookId));
    await tx.delete(chapters).where(inArray(chapters.editionId, editionIds));
    await tx.delete(volumes).where(inArray(volumes.editionId, editionIds));
    await tx.delete(bookEditions).where(eq(bookEditions.bookId, bookId));
    await tx.delete(bookLocks).where(eq(bookLocks.bookId, bookId));
    await tx.delete(books).where(eq(books.id, bookId));

    return { bookId, title, editions: editionCount?.n ?? 0, chapters: chapterCount?.n ?? 0 };
  });
}
