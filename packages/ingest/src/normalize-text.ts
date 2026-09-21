/** One non-empty source line after trimming, plus whether the source indented it. */
export interface NormalizedLine {
  readonly text: string;
  /** True when the raw line started with whitespace (U+3000, tabs or two or more spaces). */
  readonly indented: boolean;
}

export interface LineLayout {
  /**
   * True when the file indents its body paragraphs, the common layout of Chinese TXT dumps.
   * In such a file an unindented line is a heading candidate even without a chapter marker.
   */
  readonly indentedBody: boolean;
}

const INDENT_PREFIX = /^(?:[　\t]|\s{2,})/;
/** Below this many lines a file is too short to trust its layout. */
const MIN_LINES_FOR_LAYOUT = 50;
/** Share of lines that must be indented before unindented lines count as heading candidates. */
const INDENTED_BODY_RATIO = 0.8;

/**
 * Normalizer rule 0.2: one non-empty line is one paragraph. Line endings are unified, every
 * line is trimmed of Unicode whitespace (including the U+3000 indent common in Chinese TXT
 * files) and blank lines are dropped. Nothing else is rewritten, so quotes and punctuation
 * reach the parser exactly as the source had them. Indentation is remembered as a layout hint.
 */
export function splitLines(raw: string): NormalizedLine[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({ text: line.trim(), indented: INDENT_PREFIX.test(line) }))
    .filter((line) => line.text.length > 0);
}

/** Trimmed non-empty lines only; kept for callers that do not need layout hints. */
export function splitNormalizedLines(raw: string): string[] {
  return splitLines(raw).map((line) => line.text);
}

export function detectLayout(lines: readonly NormalizedLine[]): LineLayout {
  if (lines.length < MIN_LINES_FOR_LAYOUT) return { indentedBody: false };
  const indented = lines.filter((line) => line.indented).length;
  return { indentedBody: indented / lines.length >= INDENTED_BODY_RATIO };
}

/** Wraps plain strings as unindented lines, for tests and callers without source layout. */
export function toLines(texts: readonly string[]): NormalizedLine[] {
  return texts.map((text) => ({ text, indented: false }));
}
