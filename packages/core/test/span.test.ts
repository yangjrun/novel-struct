import { describe, expect, it } from 'vitest';
import {
  complementSpans,
  entityNames,
  findQuote,
  isIdOfKind,
  isWellFormedSpan,
  newId,
  occurrences,
  sliceSpan,
  sortSpans,
  spanAt,
  spanContainsOffset,
} from '../src/index.js';

describe('span helpers', () => {
  it('finds a quote and slices it back out', () => {
    const text = '他说：“走吧。”然后转身。';
    const span = findQuote(text, '“走吧。”');
    expect(span).toBeDefined();
    expect(sliceSpan(text, span!)).toBe('“走吧。”');
  });

  it('returns undefined for an empty or absent quote', () => {
    expect(findQuote('abc', '')).toBeUndefined();
    expect(findQuote('abc', 'z')).toBeUndefined();
  });

  it('lists non-overlapping occurrences', () => {
    expect(occurrences('aaaa', 'aa')).toEqual([0, 2]);
    expect(occurrences('青崖青崖哥', '青崖')).toEqual([0, 2]);
    expect(occurrences('abc', '')).toEqual([]);
    expect(occurrences('abc', 'z')).toEqual([]);
  });

  it('finds the span covering an offset with a half-open end', () => {
    const spans = [
      { charStart: 0, charEnd: 5, id: 'a' },
      { charStart: 5, charEnd: 9, id: 'b' },
    ];
    expect(spanAt(spans, 4)?.id).toBe('a');
    expect(spanAt(spans, 5)?.id).toBe('b');
    expect(spanAt(spans, 9)).toBeUndefined();
    expect(spanContainsOffset(spans[0]!, 5)).toBe(false);
  });

  it('computes the complement of sorted spans', () => {
    const gaps = complementSpans(
      [
        { charStart: 2, charEnd: 4 },
        { charStart: 4, charEnd: 6 },
        { charStart: 8, charEnd: 9 },
      ],
      10,
    );
    expect(gaps).toEqual([
      { charStart: 0, charEnd: 2 },
      { charStart: 6, charEnd: 8 },
      { charStart: 9, charEnd: 10 },
    ]);
  });

  it('complement of nothing is the whole range', () => {
    expect(complementSpans([], 5)).toEqual([{ charStart: 0, charEnd: 5 }]);
    expect(complementSpans([], 0)).toEqual([]);
  });

  it('sorts without mutating the input', () => {
    const input = [
      { charStart: 5, charEnd: 6 },
      { charStart: 1, charEnd: 2 },
    ];
    const sorted = sortSpans(input);
    expect(sorted.map((s) => s.charStart)).toEqual([1, 5]);
    expect(input.map((s) => s.charStart)).toEqual([5, 1]);
  });

  it('checks span well-formedness', () => {
    expect(isWellFormedSpan({ charStart: 0, charEnd: 1 }, 1)).toBe(true);
    expect(isWellFormedSpan({ charStart: 1, charEnd: 1 }, 1)).toBe(false);
    expect(isWellFormedSpan({ charStart: 0, charEnd: 2 }, 1)).toBe(false);
    expect(isWellFormedSpan({ charStart: -1, charEnd: 1 }, 1)).toBe(false);
  });
});

describe('ids and domain helpers', () => {
  it('generates prefixed ids and recognises them', () => {
    const id = newId('chapter');
    expect(id.startsWith('chp_')).toBe(true);
    expect(isIdOfKind('chapter', id)).toBe(true);
    expect(isIdOfKind('scene', id)).toBe(false);
    expect(isIdOfKind('chapter', 'chp_')).toBe(false);
  });

  it('lists entity names canonical first', () => {
    expect(entityNames({ canonicalName: '沈青崖', aliases: ['青崖哥', '青崖'] })).toEqual(['沈青崖', '青崖哥', '青崖']);
  });
});
