export { NORMALIZER_VERSION, normalizeNovel, normalizeNovelText } from './normalize.js';
export { decodeNovelBytes, type DecodedText, type SourceEncoding } from './decode.js';
export {
  detectLayout,
  splitLines,
  splitNormalizedLines,
  toLines,
  type LineLayout,
  type NormalizedLine,
  type TocBoundary,
} from './normalize-text.js';
export { parseChineseNumber } from './chinese-number.js';
export { parseHeading, type Heading, type HeadingContext, type HeadingKind } from './headings.js';
export { headingFromBoundary, sameHeadingText } from './toc-heading.js';
export { splitChapters, type SplitResult } from './split-chapters.js';
export { paragraphsFromText } from './paragraphs.js';
export { EpubFormatError, isZipArchive, openEpub, type EpubArchive } from './epub/archive.js';
export { normalizeEpub } from './epub/normalize-epub.js';
export { parsePackageDocument, type ManifestItem, type PackageDocument } from './epub/package-document.js';
export { parseNavToc, parseNcxToc, type TocEntry } from './epub/toc.js';
export { collapseWhitespace, extractTextBlocks, type TextBlock } from './epub/xhtml-text.js';
export { resolveHref, type HrefTarget } from './epub/paths.js';
export type {
  BookMetadata,
  NormalizedBook,
  NormalizedChapter,
  NormalizedParagraph,
  NormalizedVolume,
  SourceFormat,
} from './types.js';
