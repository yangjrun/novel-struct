import { createHash } from 'node:crypto';
import { and, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { bookEditions, books, chapters, sceneEmbeddings, scenes } from '../schema/index.js';

export const EMBEDDING_DIMENSIONS = 1536;

export interface SceneToIndex {
  readonly sceneId: string;
  readonly bookId: string;
  readonly editionId: string;
  readonly chapterId: string;
  readonly chapterIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
  readonly contentHash: string;
}

export function sceneContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Only current scenes from the selected editions; stale or re-parsed scenes are re-indexed. */
export async function listScenesToIndex(db: Db, editionIds: readonly string[], model: string): Promise<SceneToIndex[]> {
  if (editionIds.length === 0) return [];
  const rows = await db
    .select({
      sceneId: scenes.id,
      bookId: books.id,
      editionId: scenes.editionId,
      chapterId: chapters.id,
      chapterIndex: chapters.index,
      charStart: scenes.charStart,
      charEnd: scenes.charEnd,
      chapterText: chapters.text,
      indexedModel: sceneEmbeddings.model,
      indexedHash: sceneEmbeddings.contentHash,
    })
    .from(scenes)
    .innerJoin(chapters, eq(chapters.id, scenes.chapterId))
    .innerJoin(bookEditions, eq(bookEditions.id, scenes.editionId))
    .innerJoin(books, eq(books.id, bookEditions.bookId))
    .leftJoin(sceneEmbeddings, eq(sceneEmbeddings.sceneId, scenes.id))
    .where(inArray(scenes.editionId, editionIds))
    .orderBy(scenes.editionId, chapters.index, scenes.index);
  return rows.flatMap((row) => {
    const text = row.chapterText.slice(row.charStart, row.charEnd);
    const contentHash = sceneContentHash(text);
    return row.indexedModel === model && row.indexedHash === contentHash
      ? []
      : [
          {
            sceneId: row.sceneId,
            bookId: row.bookId,
            editionId: row.editionId,
            chapterId: row.chapterId,
            chapterIndex: row.chapterIndex,
            charStart: row.charStart,
            charEnd: row.charEnd,
            text,
            contentHash,
          },
        ];
  });
}

export function validateEmbedding(values: readonly number[]): number[] {
  if (values.length !== EMBEDDING_DIMENSIONS || values.some((n) => !Number.isFinite(n))) {
    throw new Error(`embedding must have ${EMBEDDING_DIMENSIONS} finite numbers`);
  }
  return [...values];
}

/** A scene may disappear while a concurrent parse replaces it. Never resurrect a stale vector. */
export async function saveSceneEmbedding(
  db: Db,
  scene: SceneToIndex,
  model: string,
  embedding: number[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const live = await tx
      .select({ chapterText: chapters.text, charStart: scenes.charStart, charEnd: scenes.charEnd })
      .from(scenes)
      .innerJoin(chapters, eq(chapters.id, scenes.chapterId))
      .where(eq(scenes.id, scene.sceneId))
      .limit(1);
    const current = live[0];
    if (
      current === undefined ||
      sceneContentHash(current.chapterText.slice(current.charStart, current.charEnd)) !== scene.contentHash
    )
      return false;
    await tx
      .insert(sceneEmbeddings)
      .values({
        sceneId: scene.sceneId,
        bookId: scene.bookId,
        editionId: scene.editionId,
        model,
        contentHash: scene.contentHash,
        embedding: validateEmbedding(embedding),
      })
      .onConflictDoUpdate({
        target: sceneEmbeddings.sceneId,
        set: { model, contentHash: scene.contentHash, embedding },
      });
    return true;
  });
}

export interface SceneSearchHit {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly editionId: string;
  readonly editionLabel: string;
  readonly chapterId: string;
  readonly chapterIndex: number;
  readonly chapterTitle: string | null;
  readonly sceneId: string;
  readonly sceneIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly excerpt: string;
  readonly similarity: number;
}

export async function searchSceneEmbeddings(
  db: Db,
  input: {
    readonly embedding: number[];
    readonly model: string;
    readonly bookIds: readonly string[];
    readonly limit: number;
  },
): Promise<SceneSearchHit[]> {
  if (input.bookIds.length === 0) return [];
  const distance = cosineDistance(sceneEmbeddings.embedding, validateEmbedding(input.embedding));
  const rows = await db
    .select({
      bookId: books.id,
      bookTitle: books.title,
      editionId: bookEditions.id,
      editionLabel: bookEditions.label,
      chapterId: chapters.id,
      chapterIndex: chapters.index,
      chapterTitle: chapters.title,
      chapterText: chapters.text,
      sceneId: scenes.id,
      sceneIndex: scenes.index,
      charStart: scenes.charStart,
      charEnd: scenes.charEnd,
      distance: sql<number>`${distance}`,
    })
    .from(sceneEmbeddings)
    .innerJoin(scenes, eq(scenes.id, sceneEmbeddings.sceneId))
    .innerJoin(chapters, eq(chapters.id, scenes.chapterId))
    .innerJoin(bookEditions, eq(bookEditions.id, scenes.editionId))
    .innerJoin(books, eq(books.id, bookEditions.bookId))
    .where(and(eq(sceneEmbeddings.model, input.model), inArray(sceneEmbeddings.bookId, input.bookIds)))
    .orderBy(distance)
    .limit(input.limit);
  return rows.map(({ chapterText, distance: score, ...row }) => ({
    ...row,
    excerpt: chapterText.slice(row.charStart, Math.min(row.charEnd, row.charStart + 240)),
    similarity: 1 - score,
  }));
}
