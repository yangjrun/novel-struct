import type { NormalizedParagraph } from '@novelstruct/ingest';

/** A quoted utterance inside one paragraph. The span includes the quote marks. */
export interface QuoteSpan {
  readonly id: string;
  readonly paragraphIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
  readonly inner: string;
}

export interface QuoteExtraction {
  readonly quotes: readonly QuoteSpan[];
  readonly warnings: readonly string[];
}

const CLOSER_FOR: ReadonlyMap<string, string> = new Map([
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
]);

/**
 * Deterministic dialogue candidates. A quote never crosses a paragraph; an opener with no closer
 * in its paragraph extends to the paragraph end, which matches the Chinese convention of leaving
 * every paragraph of a multi-paragraph speech open except the last.
 */
export function extractQuotes(text: string, paragraphs: readonly NormalizedParagraph[]): QuoteExtraction {
  const quotes: QuoteSpan[] = [];
  const warnings: string[] = [];

  for (const paragraph of paragraphs) {
    let i = paragraph.charStart;
    while (i < paragraph.charEnd) {
      const closer = CLOSER_FOR.get(text[i]!);
      if (closer === undefined) {
        i += 1;
        continue;
      }
      const closeAt = text.indexOf(closer, i + 1);
      const closed = closeAt !== -1 && closeAt < paragraph.charEnd;
      const charEnd = closed ? closeAt + 1 : paragraph.charEnd;
      const inner = text.slice(i + 1, closed ? closeAt : charEnd);
      if (!closed) warnings.push(`paragraph ${paragraph.index}: unclosed quote at ${i}, extended to paragraph end`);
      if (inner.trim().length === 0) {
        warnings.push(`paragraph ${paragraph.index}: empty quote at ${i} ignored`);
      } else {
        quotes.push({
          id: `q${quotes.length}`,
          paragraphIndex: paragraph.index,
          charStart: i,
          charEnd,
          text: text.slice(i, charEnd),
          inner,
        });
      }
      i = charEnd;
    }
  }
  return { quotes, warnings };
}
