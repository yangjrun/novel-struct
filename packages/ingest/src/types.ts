import type { ChapterKind } from '@novelstruct/core';
import type { SourceEncoding } from './decode.js';

export interface NormalizedParagraph {
  readonly index: number;
  readonly charStart: number;
  readonly charEnd: number;
}

export interface NormalizedVolume {
  readonly index: number;
  readonly number?: number;
  readonly title?: string;
  readonly headingRaw: string;
}

/**
 * One chapter of normalized text. `text` excludes the heading line; paragraphs are joined by a
 * single "\n" and every offset is a UTF-16 code unit index into `text`.
 */
export interface NormalizedChapter {
  readonly index: number;
  readonly kind: ChapterKind;
  readonly number?: number;
  readonly title?: string;
  readonly headingRaw?: string;
  readonly volumeIndex?: number;
  readonly text: string;
  readonly paragraphs: readonly NormalizedParagraph[];
  readonly contentHash: string;
}

export interface NormalizedBook {
  readonly normalizerVersion: string;
  readonly encoding: SourceEncoding;
  /** Invalid byte sequences that were replaced while decoding; zero for a clean file. */
  readonly replacedSequences: number;
  readonly sourceHash: string;
  readonly volumes: readonly NormalizedVolume[];
  readonly chapters: readonly NormalizedChapter[];
  /** Lines that looked like headings but were kept as prose, one message each. */
  readonly warnings: readonly string[];
}
