export type SourceEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export interface DecodedText {
  readonly text: string;
  readonly encoding: SourceEncoding;
  /** Invalid byte sequences replaced with U+FFFD; only non-zero for a UTF-8 file with stray bytes. */
  readonly replacedSequences: number;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;
const REPLACEMENT = '�';
/** Above this share of replacement characters the file is not UTF-8 with a few stray bytes; it is another encoding. */
const MAX_UTF8_REPLACEMENT_RATIO = 0.002;

/**
 * Decodes novel bytes. Byte order marks win. Otherwise the bytes are decoded as UTF-8 and the
 * replacement-character ratio decides: a handful of stray bytes keeps UTF-8 (lossy, reported),
 * anything worse falls back to GB18030, the superset of the GBK/GB2312 files common for Chinese
 * web novels.
 */
export function decodeNovelBytes(bytes: Uint8Array): DecodedText {
  if (startsWith(bytes, UTF8_BOM)) return lossless(decode(bytes.subarray(3), 'utf-8'), 'utf-8');
  if (startsWith(bytes, UTF16LE_BOM)) return lossless(decode(bytes.subarray(2), 'utf-16le'), 'utf-16le');
  if (startsWith(bytes, UTF16BE_BOM)) return lossless(decode(bytes.subarray(2), 'utf-16be'), 'utf-16be');

  const utf8 = decode(bytes, 'utf-8');
  const replaced = countReplacements(utf8);
  if (replaced === 0) return lossless(utf8, 'utf-8');
  if (replaced / Math.max(utf8.length, 1) <= MAX_UTF8_REPLACEMENT_RATIO) {
    return { text: utf8, encoding: 'utf-8', replacedSequences: replaced };
  }
  return lossless(decode(bytes, 'gb18030'), 'gb18030');
}

function lossless(text: string, encoding: SourceEncoding): DecodedText {
  return { text, encoding, replacedSequences: 0 };
}

function decode(bytes: Uint8Array, encoding: SourceEncoding): string {
  return new TextDecoder(encoding).decode(bytes);
}

function countReplacements(text: string): number {
  let count = 0;
  for (let at = text.indexOf(REPLACEMENT); at !== -1; at = text.indexOf(REPLACEMENT, at + 1)) count += 1;
  return count;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}
