export { NORMALIZER_VERSION, normalizeNovel, normalizeNovelText } from './normalize.js';
export { decodeNovelBytes, type DecodedText, type SourceEncoding } from './decode.js';
export {
  detectLayout,
  splitLines,
  splitNormalizedLines,
  toLines,
  type LineLayout,
  type NormalizedLine,
} from './normalize-text.js';
export { parseChineseNumber } from './chinese-number.js';
export { parseHeading, type Heading, type HeadingContext, type HeadingKind } from './headings.js';
export { splitChapters, type SplitResult } from './split-chapters.js';
export { paragraphsFromText } from './paragraphs.js';
export type { NormalizedBook, NormalizedChapter, NormalizedParagraph, NormalizedVolume } from './types.js';
