import { count, eq, inArray, isNotNull, and } from 'drizzle-orm';
import type { Db } from '../client.js';
import { books, bookEditions, chapters, sourceRefs, weknoraDocuments, weknoraKnowledgeBases } from '../schema/index.js';

export async function listWeKnoraEditions(db: Db, bookIds: readonly string[]) {
  if (!bookIds.length) return [];
  return db
    .select({
      bookId: books.id,
      bookTitle: books.title,
      editionId: bookEditions.id,
      editionLabel: bookEditions.label,
      kbId: weknoraKnowledgeBases.knowledgeBaseId,
    })
    .from(bookEditions)
    .innerJoin(books, eq(books.id, bookEditions.bookId))
    .leftJoin(weknoraKnowledgeBases, eq(weknoraKnowledgeBases.editionId, bookEditions.id))
    .where(inArray(books.id, [...bookIds]));
}

export async function listWeKnoraSources(db: Db, editionId: string, knowledgeIds: readonly string[]) {
  if (!knowledgeIds.length) return [];
  return db
    .select({
      chapterId: chapters.id,
      chapterIndex: chapters.index,
      chapterTitle: chapters.title,
      text: chapters.text,
      contentHash: chapters.contentHash,
      indexedHash: weknoraDocuments.contentHash,
      knowledgeId: weknoraDocuments.knowledgeId,
    })
    .from(chapters)
    .innerJoin(weknoraDocuments, eq(weknoraDocuments.chapterId, chapters.id))
    .where(and(eq(chapters.editionId, editionId), inArray(weknoraDocuments.knowledgeId, [...knowledgeIds])));
}

export async function getWeKnoraLocalStatus(db: Db, editionId: string) {
  const rows = await db
    .select({
      chapterId: chapters.id,
      index: chapters.index,
      title: chapters.title,
      knowledgeId: weknoraDocuments.knowledgeId,
      contentHash: chapters.contentHash,
      indexedHash: weknoraDocuments.contentHash,
    })
    .from(chapters)
    .leftJoin(weknoraDocuments, eq(weknoraDocuments.chapterId, chapters.id))
    .where(eq(chapters.editionId, editionId))
    .orderBy(chapters.index);
  const [total] = await db.select({ count: count() }).from(sourceRefs).where(eq(sourceRefs.editionId, editionId));
  const [linked] = await db
    .select({ count: count() })
    .from(sourceRefs)
    .where(and(eq(sourceRefs.editionId, editionId), isNotNull(sourceRefs.weknoraChunkId)));
  return { chapters: rows, evidenceTotal: total?.count ?? 0, evidenceLinked: linked?.count ?? 0 };
}
