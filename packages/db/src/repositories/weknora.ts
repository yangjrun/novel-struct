import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chapters, sourceRefs, weknoraDocuments, weknoraKnowledgeBases } from '../schema/index.js';

export async function getWeKnoraKb(db: Db, editionId: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: weknoraKnowledgeBases.knowledgeBaseId })
    .from(weknoraKnowledgeBases)
    .where(eq(weknoraKnowledgeBases.editionId, editionId))
    .limit(1);
  return rows[0]?.id;
}

export async function saveWeKnoraKb(db: Db, editionId: string, knowledgeBaseId: string): Promise<void> {
  await db
    .insert(weknoraKnowledgeBases)
    .values({ editionId, knowledgeBaseId })
    .onConflictDoUpdate({ target: weknoraKnowledgeBases.editionId, set: { knowledgeBaseId } });
}

export async function listChaptersForWeKnora(
  db: Db,
  editionId: string,
): Promise<
  {
    id: string;
    title: string | null;
    text: string;
    contentHash: string;
    knowledgeId: string | null;
    indexedHash: string | null;
  }[]
> {
  return db
    .select({
      id: chapters.id,
      title: chapters.title,
      text: chapters.text,
      contentHash: chapters.contentHash,
      knowledgeId: weknoraDocuments.knowledgeId,
      indexedHash: weknoraDocuments.contentHash,
    })
    .from(chapters)
    .leftJoin(weknoraDocuments, eq(weknoraDocuments.chapterId, chapters.id))
    .where(eq(chapters.editionId, editionId))
    .orderBy(chapters.index);
}

export async function saveWeKnoraDocument(
  db: Db,
  chapterId: string,
  knowledgeId: string,
  contentHash: string,
): Promise<void> {
  await db
    .insert(weknoraDocuments)
    .values({ chapterId, knowledgeId, contentHash })
    .onConflictDoUpdate({ target: weknoraDocuments.chapterId, set: { knowledgeId, contentHash } });
}

/** Match external chunk content within the chapter's normalized text; backfill only exact evidence spans. */
export async function linkWeKnoraChunks(
  db: Db,
  chapterId: string,
  chunks: readonly { id: string; content: string }[],
): Promise<number> {
  const chapter = (
    await db.select({ text: chapters.text }).from(chapters).where(eq(chapters.id, chapterId)).limit(1)
  )[0];
  if (!chapter) return 0;
  const refs = await db
    .select({ id: sourceRefs.id, charStart: sourceRefs.charStart, charEnd: sourceRefs.charEnd })
    .from(sourceRefs)
    .where(and(eq(sourceRefs.chapterId, chapterId), isNull(sourceRefs.weknoraChunkId)));
  let linked = 0;
  for (const ref of refs) {
    const matching = chunks.filter(({ content }) => {
      if (!content) return false;
      const start = chapter.text.indexOf(content);
      return (
        start !== -1 &&
        chapter.text.indexOf(content, start + 1) === -1 &&
        start <= ref.charStart &&
        ref.charEnd <= start + content.length
      );
    });
    if (matching.length === 1) {
      await db.update(sourceRefs).set({ weknoraChunkId: matching[0]!.id }).where(eq(sourceRefs.id, ref.id));
      linked += 1;
    }
  }
  return linked;
}

export async function clearWeKnoraPointers(db: Db, chapterId: string): Promise<void> {
  await db.update(sourceRefs).set({ weknoraChunkId: null }).where(eq(sourceRefs.chapterId, chapterId));
}

export async function clearWeKnoraEditionPointers(db: Db, editionId: string): Promise<void> {
  await db.update(sourceRefs).set({ weknoraChunkId: null }).where(eq(sourceRefs.editionId, editionId));
  const chapterIds = db.select({ id: chapters.id }).from(chapters).where(eq(chapters.editionId, editionId));
  await db.delete(weknoraDocuments).where(inArray(weknoraDocuments.chapterId, chapterIds));
  await db.delete(weknoraKnowledgeBases).where(eq(weknoraKnowledgeBases.editionId, editionId));
}
