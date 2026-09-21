import { describe, expect, it } from 'vitest';
import { bucketItems } from '../src/index.js';
import { esc, fmtCompact, niceTicks, truncateToWidth } from '../src/html.js';
import { stackSegmentsForTest } from '../src/charts/stacked-columns.js';

describe('bucketItems', () => {
  const label = (g: readonly number[]) => `${g[0]}-${g[g.length - 1]}`;

  it('keeps one item per bucket when under the cap', () => {
    expect(bucketItems([1, 2, 3], 30, label).map((b) => b.items)).toEqual([[1], [2], [3]]);
  });

  it('folds into contiguous equal groups over the cap', () => {
    const buckets = bucketItems(
      Array.from({ length: 65 }, (_, i) => i),
      30,
      label,
    );
    expect(buckets).toHaveLength(22);
    expect(buckets[0]?.label).toBe('0-2');
    expect(buckets.at(-1)?.items).toEqual([63, 64]);
  });

  it('handles empty input', () => {
    expect(bucketItems([], 30, label)).toEqual([]);
  });
});

describe('html helpers', () => {
  it('escapes markup in user strings', () => {
    expect(esc('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  });

  it('produces clean ticks ending at or above the max', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('compacts big numbers and leaves small ones alone', () => {
    expect(fmtCompact(999)).toBe('999');
    expect(fmtCompact(12_345)).toBe('12.3K');
    expect(fmtCompact(2_500_000)).toBe('2.5M');
  });

  it('truncates labels that would not fit', () => {
    expect(truncateToWidth('沈青崖', 12, 100)).toBe('沈青崖');
    expect(truncateToWidth('一二三四五六七八', 12, 50)).toBe('一二三…');
  });
});

describe('stackSegments', () => {
  it('leaves a 2px surface gap below every segment except the top one', () => {
    const segments = stackSegmentsForTest([50, 30, 0, 20], 200);
    expect(segments.map((s) => [s.seriesIndex, s.top, s.height, s.isTop])).toEqual([
      [0, 152, 48, false],
      [1, 122, 28, false],
      [3, 100, 20, true],
    ]);
  });

  it('drops segments thinner than the gap', () => {
    expect(stackSegmentsForTest([1, 10], 100).map((s) => s.seriesIndex)).toEqual([1]);
  });
});
