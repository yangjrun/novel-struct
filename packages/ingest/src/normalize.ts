import { sha256Hex } from '@novelstruct/core';
import { decodeNovelBytes, type SourceEncoding } from './decode.js';
import { splitLines } from './normalize-text.js';
import { splitChapters } from './split-chapters.js';
import type { NormalizedBook } from './types.js';

/**
 * Bump when any normalization rule changes; offsets from older versions are then invalid.
 * 0.2: repeated in-text chapter headings stay prose; unindented author's notes become `note` chapters.
 */
export const NORMALIZER_VERSION = '0.2';

export function normalizeNovel(bytes: Uint8Array): NormalizedBook {
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
    encoding: meta.encoding,
    replacedSequences: meta.replacedSequences ?? 0,
    sourceHash: meta.sourceHash,
    volumes,
    chapters,
    warnings,
  };
}
