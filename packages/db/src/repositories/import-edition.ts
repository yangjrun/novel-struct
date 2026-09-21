import { newId } from '@novelstruct/core';
import type { NormalizedBook } from '@novelstruct/ingest';
import type { Db } from '../client.js';
import { bookEditions, chapters, volumes } from '../schema/index.js';

export interface ImportEditionInput {
  readonly bookId: string;
  readonly label: string;
  readonly sourceFormat: string;
  readonly sourceFilename?: string;
  readonly normalized: NormalizedBook;
}

export interface ImportEditionResult {
  readonly editionId: string;
  readonly chapterIds: readonly string[];
  readonly volumeCount: number;
}

/** Writes a normalized book as a new edition with its volumes and chapters, in one transaction. */
export async function importNormalizedBook(db: Db, input: ImportEditionInput): Promise<ImportEditionResult> {
  const { normalized } = input;
  const editionId = newId('edition');
  const volumeIds = normalized.volumes.map(() => newId('volume'));
  const chapterIds = normalized.chapters.map(() => newId('chapter'));

  await db.transaction(async (tx) => {
    await tx.insert(bookEditions).values({
      id: editionId,
      bookId: input.bookId,
      label: input.label,
      sourceFormat: input.sourceFormat,
      sourceFilename: input.sourceFilename ?? null,
      sourceHash: normalized.sourceHash,
      sourceEncoding: normalized.encoding,
      normalizerVersion: normalized.normalizerVersion,
    });

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

    if (normalized.chapters.length > 0) {
      await tx.insert(chapters).values(
        normalized.chapters.map((c, i) => ({
          id: chapterIds[i]!,
          editionId,
          volumeId: c.volumeIndex === undefined ? null : (volumeIds[c.volumeIndex] ?? null),
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
  });

  return { editionId, chapterIds, volumeCount: volumeIds.length };
}
