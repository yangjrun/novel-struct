import path from 'node:path';
import {
  createBook,
  type Db,
  ensureDefaultLibrary,
  findBookByTitle,
  findEditionByLabel,
  importNormalizedBook,
  type ReimportCounts,
  reimportNormalizedBook,
} from '@novelstruct/db';
import { type NormalizedBook, normalizeNovel } from '@novelstruct/ingest';
import { PipelineError } from './errors.js';

export interface ImportBookInput {
  readonly bytes: Uint8Array;
  readonly title: string;
  readonly author?: string;
  /** Edition label, defaults to `v1`. */
  readonly label?: string;
  /** Original file name; its extension becomes the edition's source format. */
  readonly filename?: string;
}

export interface ImportBookResult {
  readonly bookId: string;
  readonly editionId: string;
  readonly chapterCount: number;
  readonly volumeCount: number;
  readonly normalized: NormalizedBook;
  /**
   * Present when the same book and label already existed: the edition was updated in place,
   * chapter ids were kept wherever the chapter matched, and these counts say what changed.
   */
  readonly reimport?: ReimportCounts;
}

const DEFAULT_LABEL = 'v1';
const DEFAULT_FORMAT = 'txt';

/**
 * Normalizes raw novel bytes and stores them. A new title (or a new label under a known title)
 * becomes a new book or edition. Importing the same title and label again re-imports into the
 * existing edition so chapter ids, and the parse results of unchanged chapters, survive.
 */
export async function importBook(db: Db, input: ImportBookInput): Promise<ImportBookResult> {
  const title = input.title.trim();
  if (title.length === 0) throw new PipelineError('invalid_input', '书名不能为空');
  if (input.bytes.byteLength === 0) throw new PipelineError('invalid_input', '文件内容为空');

  const normalized = normalizeNovel(input.bytes);
  if (normalized.chapters.length === 0) throw new PipelineError('invalid_input', '文件里没有识别出任何章节');

  const author = nonEmpty(input.author);
  const label = nonEmptyOr(input.label, DEFAULT_LABEL);
  const sourceFilename = input.filename === undefined ? undefined : path.basename(input.filename);
  const existingBookId = await findBookByTitle(db, title, author);
  const existingEdition =
    existingBookId === undefined ? undefined : await findEditionByLabel(db, existingBookId, label);

  if (existingBookId !== undefined && existingEdition !== undefined) {
    const result = await reimportNormalizedBook(db, {
      editionId: existingEdition.id,
      ...(sourceFilename === undefined ? {} : { sourceFilename }),
      normalized,
    });
    return {
      bookId: existingBookId,
      editionId: existingEdition.id,
      chapterCount: normalized.chapters.length,
      volumeCount: normalized.volumes.length,
      normalized,
      reimport: { kept: result.kept, updated: result.updated, added: result.added, removed: result.removed },
    };
  }

  const bookId =
    existingBookId ??
    (await createBook(db, {
      libraryId: await ensureDefaultLibrary(db),
      title,
      ...(author === undefined ? {} : { author }),
    }));
  const imported = await importNormalizedBook(db, {
    bookId,
    label,
    sourceFormat: sourceFormatOf(input.filename),
    ...(sourceFilename === undefined ? {} : { sourceFilename }),
    normalized,
  });
  return {
    bookId,
    editionId: imported.editionId,
    chapterCount: normalized.chapters.length,
    volumeCount: imported.volumeCount,
    normalized,
  };
}

function sourceFormatOf(filename: string | undefined): string {
  if (filename === undefined) return DEFAULT_FORMAT;
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  return ext.length === 0 ? DEFAULT_FORMAT : ext;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function nonEmptyOr(value: string | undefined, fallback: string): string {
  return nonEmpty(value) ?? fallback;
}
