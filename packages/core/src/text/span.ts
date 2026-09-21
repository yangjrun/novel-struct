/**
 * A half-open range [charStart, charEnd) of UTF-16 code units into a normalized chapter text.
 * See docs/03-novel-ir.md section 1 for the offset convention.
 */
export interface Span {
  readonly charStart: number;
  readonly charEnd: number;
}

export function isWellFormedSpan(span: Span, length: number): boolean {
  return (
    Number.isInteger(span.charStart) &&
    Number.isInteger(span.charEnd) &&
    span.charStart >= 0 &&
    span.charStart < span.charEnd &&
    span.charEnd <= length
  );
}

export function spanContains(outer: Span, inner: Span): boolean {
  return outer.charStart <= inner.charStart && inner.charEnd <= outer.charEnd;
}

export function spanContainsOffset(span: Span, offset: number): boolean {
  return span.charStart <= offset && offset < span.charEnd;
}

/** The first span covering `offset`, if any. */
export function spanAt<T extends Span>(spans: readonly T[], offset: number): T | undefined {
  return spans.find((s) => spanContainsOffset(s, offset));
}

export function sliceSpan(text: string, span: Span): string {
  return text.slice(span.charStart, span.charEnd);
}

/** Locates the first occurrence of `quote` at or after `from`. Returns undefined when absent or empty. */
export function findQuote(text: string, quote: string, from = 0): Span | undefined {
  if (quote.length === 0) return undefined;
  const at = text.indexOf(quote, from);
  return at === -1 ? undefined : { charStart: at, charEnd: at + quote.length };
}

/** Start offsets of every non-overlapping occurrence of `needle`, left to right. */
export function occurrences(text: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return starts;
    starts.push(at);
    from = at + needle.length;
  }
}

export function sortSpans<T extends Span>(spans: readonly T[]): T[] {
  return [...spans].sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd);
}

/**
 * Gaps of [0, length) not covered by `spans`. Input must be sorted by charStart and non-overlapping;
 * the result together with the input partitions the whole range.
 */
export function complementSpans(spans: readonly Span[], length: number): Span[] {
  const gaps: Span[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.charStart > cursor) gaps.push({ charStart: cursor, charEnd: span.charStart });
    cursor = Math.max(cursor, span.charEnd);
  }
  if (cursor < length) gaps.push({ charStart: cursor, charEnd: length });
  return gaps;
}
