import { sha256Hex } from '@novelstruct/core';
import { decodeNovelBytes, type SourceEncoding } from './decode.js';
import { isZipArchive } from './epub/archive.js';
import { normalizeEpub } from './epub/normalize-epub.js';
import { splitLines } from './normalize-text.js';
import { splitChapters } from './split-chapters.js';
import type { NormalizedBook } from './types.js';

/**
 * Bump when any normalization rule changes; offsets from older versions are then invalid.
 * 0.2: repeated in-text chapter headings stay prose; unindented author's notes become `note` chapters.
 * 0.3: EPUB input (table of contents drives chapter boundaries); chapters without text are dropped.
 */
export const NORMALIZER_VERSION = '0.3';

/** Normalizes a novel file. A ZIP container is read as EPUB, anything else as TXT. */
export function normalizeNovel(bytes: Uint8Array): NormalizedBook {
  if (isZipArchive(bytes)) return normalizeEpub(bytes, sha256Hex(bytes));
  const decoded = decodeNovelBytes(bytes);
  return normalizeNovelText(decoded.text, {
    encoding: decoded.encoding,
    replacedSequences: decoded.replacedSequences,
    sourceHash: sha256Hex(bytes),
  });
}

export function normalizeNovelText(
  text: string,
  meta: { readonly encoding: SourceEncoding; readonly sourceHash: string; readonly replacedSequences?: number },
): NormalizedBook {
  const { volumes, chapters, warnings } = splitChapters(splitLines(text));
  return {
    normalizerVersion: NORMALIZER_VERSION,
    format: 'txt',
    encoding: meta.encoding,
    replacedSequences: meta.replacedSequences ?? 0,
    sourceHash: meta.sourceHash,
    metadata: {},
    volumes,
    chapters,
    warnings,
  };
}
