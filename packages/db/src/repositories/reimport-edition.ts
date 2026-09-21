import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { newId } from '@novelstruct/core';
import type { NormalizedBook, NormalizedChapter } from '@novelstruct/ingest';
import type { Db } from '../client.js';
import {
  bookEditions,
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

export interface ReimportEditionInput {
  readonly editionId: string;
  readonly sourceFilename?: string;
  readonly normalized: NormalizedBook;
}

export interface ReimportCounts {
  /** Chapters whose text is unchanged; id and parse results kept. */
  readonly kept: number;
  /** Chapters matched by number or title whose text changed; id kept, parse results dropped. */
  readonly updated: number;
  readonly added: number;
  readonly removed: number;
}

export interface ReimportEditionResult extends ReimportCounts {
  readonly editionId: string;
  readonly chapterIds: readonly string[];
}

export interface ExistingChapter {
  readonly id: string;
  readonly kind: NormalizedChapter['kind'];
  readonly number: number | null;
  readonly title: string | null;
  readonly contentHash: string;
}

export interface ChapterMatch {
  readonly oldId: string;
  readonly chapter: NormalizedChapter;
  readonly changed: boolean;
}

export interface ChapterMatching {
  readonly matched: readonly ChapterMatch[];
  readonly added: readonly NormalizedChapter[];
  readonly removedIds: readonly string[];
}

/**
 * Pairs stored chapters with incoming ones. First by content hash, so an unchanged chapter keeps
 * its id wherever it moved; then by kind plus number (or title when unnumbered), so a chapter
 * whose text was corrected keeps its id too. Anything left is added or removed.
 */
export function matchChapters(
  existing: readonly ExistingChapter[],
  incoming: readonly NormalizedChapter[],
): ChapterMatching {
  const byHash = new Map<string, ExistingChapter[]>();
  for (const old of existing) byHash.set(old.contentHash, [...(byHash.get(old.contentHash) ?? []), old]);

  const matched: ChapterMatch[] = [];
  const usedOld = new Set<string>();
  const unmatched: NormalizedChapter[] = [];
  for (const chapter of incoming) {
    const candidates = (byHash.get(chapter.contentHash) ?? []).filter((c) => !usedOld.has(c.id));
    const old = candidates.find((c) => c.title === (chapter.title ?? null)) ?? candidates[0];
    if (old === undefined) {
      unmatched.push(chapter);
      continue;
    }
    usedOld.add(old.id);
    matched.push({ oldId: old.id, chapter, changed: false });
  }

  const oldByKey = uniqueByKey(
    existing.filter((c) => !usedOld.has(c.id)),
    (c) => identityKey(c.kind, c.number, c.title),
  );
  const newByKey = uniqueByKey(unmatched, (c) => identityKey(c.kind, c.number ?? null, c.title ?? null));
  const added: NormalizedChapter[] = [];
  for (const chapter of unmatched) {
    const key = identityKey(chapter.kind, chapter.number ?? null, chapter.title ?? null);
    const old = key === undefined || !newByKey.has(key) ? undefined : oldByKey.get(key);
    if (old === undefined || usedOld.has(old.id)) {
      added.push(chapter);
      continue;
    }
    usedOld.add(old.id);
    matched.push({ oldId: old.id, chapter, changed: true });
  }

  return {
    matched: [...matched].sort((a, b) => a.chapter.index - b.chapter.index),
    added,
    removedIds: existing.filter((c) => !usedOld.has(c.id)).map((c) => c.id),
  };
}

function identityKey(kind: string, number: number | null, title: string | null): string | undefined {
  if (number !== null) return `${kind}#${number}`;
  return title === null ? undefined : `${kind}@${title}`;
}

/** Keys that occur exactly once; duplicates are ambiguous and never matched by identity. */
function uniqueByKey<T>(items: readonly T[], keyOf: (item: T) => string | undefined): ReadonlyMap<string, T> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && counts.get(key) === 1) unique.set(key, item);
  }
  return unique;
}

/**
 * Replaces an edition's chapters with a re-normalized book while keeping chapter ids, and the
 * parse results of unchanged chapters, wherever `matchChapters` finds a counterpart. Runs in
 * one transaction.
 */
export async function reimportNormalizedBook(db: Db, input: ReimportEditionInput): Promise<ReimportEditionResult> {
  const { normalized, editionId } = input;
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: chapters.id,
        kind: chapters.kind,
        number: chapters.number,
        title: chapters.title,
        contentHash: chapters.contentHash,
      })
      .from(chapters)
      .where(eq(chapters.editionId, editionId));
    const matching = matchChapters(existing, normalized.chapters);

    for (const id of matching.removedIds) await deleteChapter(tx, id);
    const changed = matching.matched.filter((m) => m.changed);
    for (const m of changed) await clearChapterResults(tx, m.oldId);

    // Park kept chapters on negative indexes so the (edition, index) constraint cannot trip while reordering.
    for (const m of matching.matched) {
      await tx
        .update(chapters)
        .set({ index: -(m.chapter.index + 1), volumeId: null })
        .where(eq(chapters.id, m.oldId));
    }
    await tx.delete(volumes).where(eq(volumes.editionId, editionId));
    const volumeIds = normalized.volumes.map(() => newId('volume'));
    if (normalized.volumes.length > 0) {
      await tx.insert(volumes).values(
        normalized.volumes.map((v, i) => ({
          id: volumeIds[i]!,
          editionId,
          index: v.index,
          number: v.number ?? null,
          title: v.title ?? null,
          headingRaw: v.headingRaw,
        })),
      );
    }

    const volumeIdOf = (c: NormalizedChapter): string | null =>
      c.volumeIndex === undefined ? null : (volumeIds[c.volumeIndex] ?? null);
    for (const m of matching.matched) {
      await tx
        .update(chapters)
        .set({
          index: m.chapter.index,
          volumeId: volumeIdOf(m.chapter),
          kind: m.chapter.kind,
          number: m.chapter.number ?? null,
          headingRaw: m.chapter.headingRaw ?? null,
          title: m.chapter.title ?? null,
          ...(m.changed
            ? { text: m.chapter.text, charCount: m.chapter.text.length, contentHash: m.chapter.contentHash }
            : {}),
        })
        .where(eq(chapters.id, m.oldId));
    }

    const addedIds = new Map(matching.added.map((c) => [c.index, newId('chapter')] as const));
    if (matching.added.length > 0) {
      await tx.insert(chapters).values(
        matching.added.map((c) => ({
          id: addedIds.get(c.index)!,
          editionId,
          volumeId: volumeIdOf(c),
          index: c.index,
          kind: c.kind,
          number: c.number ?? null,
          headingRaw: c.headingRaw ?? null,
          title: c.title ?? null,
          text: c.text,
          charCount: c.text.length,
          contentHash: c.contentHash,
        })),
      );
    }

    await tx
      .update(bookEditions)
      .set({
        sourceHash: normalized.sourceHash,
        sourceEncoding: normalized.encoding,
        normalizerVersion: normalized.normalizerVersion,
        ...(input.sourceFilename === undefined ? {} : { sourceFilename: input.sourceFilename }),
      })
      .where(eq(bookEditions.id, editionId));

    const idByIndex = new Map<number, string>([
      ...matching.matched.map((m) => [m.chapter.index, m.oldId] as const),
      ...addedIds.entries(),
    ]);
    return {
      editionId,
      chapterIds: normalized.chapters.map((c) => idByIndex.get(c.index)!),
      kept: matching.matched.length - changed.length,
      updated: changed.length,
      added: matching.added.length,
      removed: matching.removedIds.length,
    };
  });
}

/** Drops every structure-pass result and run of a chapter; the chapter row itself stays. */
async function clearChapterResults(tx: Db, chapterId: string): Promise<void> {
  await tx.delete(entityMentions).where(eq(entityMentions.chapterId, chapterId));
  await tx.delete(segments).where(eq(segments.chapterId, chapterId));
  await tx.delete(scenes).where(eq(scenes.chapterId, chapterId));
  const refs = tx.select({ id: sourceRefs.id }).from(sourceRefs).where(eq(sourceRefs.chapterId, chapterId));
  await tx
    .update(entityAliases)
    .set({ sourceRefId: null })
    .where(and(isNotNull(entityAliases.sourceRefId), inArray(entityAliases.sourceRefId, refs)));
  await tx.delete(sourceRefs).where(eq(sourceRefs.chapterId, chapterId));
  await tx.delete(parseRuns).where(eq(parseRuns.chapterId, chapterId));
}

async function deleteChapter(tx: Db, chapterId: string): Promise<void> {
  await clearChapterResults(tx, chapterId);
  await tx.update(entities).set({ firstChapterId: null }).where(eq(entities.firstChapterId, chapterId));
  await tx
    .update(entityAliases)
    .set({ validFromChapterId: null })
    .where(eq(entityAliases.validFromChapterId, chapterId));
  await tx.update(entityAliases).set({ validToChapterId: null }).where(eq(entityAliases.validToChapterId, chapterId));
  await tx.delete(chapters).where(eq(chapters.id, chapterId));
}
