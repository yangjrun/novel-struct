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
import { EpubFormatError, type NormalizedBook, normalizeNovel } from '@novelstruct/ingest';
import { PipelineError } from './errors.js';

export interface ImportBookInput {
  readonly bytes: Uint8Array;
  /** Book title. May be omitted for an EPUB, whose metadata then supplies it. */
  readonly title?: string;
  /** Author. Falls back to EPUB metadata. */
  readonly author?: string;
  /** Edition label, defaults to `v1`. */
  readonly label?: string;
  /** Original file name, recorded on the edition. */
  readonly filename?: string;
}

export interface ImportBookResult {
  readonly bookId: string;
  readonly editionId: string;
  readonly title: string;
  readonly author?: string;
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

/**
 * Normalizes raw novel bytes (TXT or EPUB, told apart by content) and stores them. A new title
 * (or a new label under a known title) becomes a new book or edition. Importing the same title
 * and label again re-imports into the existing edition so chapter ids, and the parse results of
 * unchanged chapters, survive.
 */
export async function importBook(db: Db, input: ImportBookInput): Promise<ImportBookResult> {
  if (input.bytes.byteLength === 0) throw new PipelineError('invalid_input', '文件内容为空');
  const normalized = normalize(input.bytes);
  if (normalized.chapters.length === 0) throw new PipelineError('invalid_input', '文件里没有识别出任何章节');

  const title = nonEmpty(input.title) ?? nonEmpty(normalized.metadata.title);
  if (title === undefined) {
    throw new PipelineError(
      'invalid_input',
      normalized.format === 'epub' ? 'EPUB 里没有书名元数据，请指定书名' : '书名不能为空',
    );
  }
  const author = nonEmpty(input.author) ?? nonEmpty(normalized.metadata.author);
  const label = nonEmpty(input.label) ?? DEFAULT_LABEL;
  const sourceFilename = input.filename === undefined ? undefined : path.basename(input.filename);
  const existingBookId = await findBookByTitle(db, title, author);
  const existingEdition =
    existingBookId === undefined ? undefined : await findEditionByLabel(db, existingBookId, label);

  const common = {
    title,
    ...(author === undefined ? {} : { author }),
    chapterCount: normalized.chapters.length,
    volumeCount: normalized.volumes.length,
    normalized,
  };

  if (existingBookId !== undefined && existingEdition !== undefined) {
    const result = await reimportNormalizedBook(db, {
      editionId: existingEdition.id,
      ...(sourceFilename === undefined ? {} : { sourceFilename }),
      normalized,
    });
    return {
      bookId: existingBookId,
      editionId: existingEdition.id,
      ...common,
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
    sourceFormat: normalized.format,
    ...(sourceFilename === undefined ? {} : { sourceFilename }),
    normalized,
  });
  return { bookId, editionId: imported.editionId, ...common };
}

function normalize(bytes: Uint8Array): NormalizedBook {
  try {
    return normalizeNovel(bytes);
  } catch (error) {
    if (error instanceof EpubFormatError) throw new PipelineError('invalid_input', `EPUB 无法读取：${error.message}`);
    throw error;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
