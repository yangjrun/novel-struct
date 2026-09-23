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

/** Short quoted terms inside narration, e.g. 以“第四天灾”的身份 / 所谓“废土人”. */
const QUOTED_TERM_SUFFIX =
  /^(?:的(?:身份|意思|概念|说法|名称|定义|区别|原因|地方|问题|称呼|标志)?|里(?:的)?|中(?:的)?|上(?:的)?|下(?:的)?|内(?:的)?|外(?:的)?|之一|那种|这种|一样|而言|而不是)/;
const QUOTED_TERM_PREFIX =
  /(?:所谓|称作|叫做|名为|被称为|称为|作为|以|属于|类似于|理解成|统称为|提到了|标签|身份|术语|称呼|像极了)$/;
export const QUOTE_EXTRACTION_VERSION = 'quotes/0.2';

function isQuotedTerm(
  text: string,
  paragraph: NormalizedParagraph,
  start: number,
  end: number,
  inner: string,
): boolean {
  // A short utterance can be genuinely spoken: punctuation, a speech tag, or a standalone quote
  // takes precedence. No length-only filter is safe for “嗯。” or “走。”
  if (inner.length > 16 || /[。！？!?；;，,：:]/.test(inner)) return false;
  const before = text.slice(paragraph.charStart, start).trimEnd();
  const after = text.slice(end, paragraph.charEnd).trimStart();
  if (before.length === 0 || after.length === 0) return false;
  if (/[：:]$/.test(before) || /^(?:说|道|问|答|喊|叫|骂|笑|想|嘀咕)/.test(after)) return false;
  return QUOTED_TERM_PREFIX.test(before) || QUOTED_TERM_SUFFIX.test(after) || /(?:确实有|是一种|是一个)$/.test(before);
}

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
      } else if (closed && isQuotedTerm(text, paragraph, i, charEnd, inner)) {
        warnings.push(`paragraph ${paragraph.index}: quoted term at ${i} kept as narration`);
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
