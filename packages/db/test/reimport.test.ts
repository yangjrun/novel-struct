import { describe, expect, it } from 'vitest';
import type { NormalizedChapter } from '@novelstruct/ingest';
import { type ExistingChapter, matchChapters } from '../src/repositories/reimport-edition.js';

function incoming(index: number, number: number | undefined, title: string, text: string): NormalizedChapter {
  return {
    index,
    kind: 'chapter',
    ...(number === undefined ? {} : { number }),
    title,
    text,
    paragraphs: [],
    contentHash: `hash:${text}`,
  };
}

function existing(id: string, number: number | null, title: string, text: string): ExistingChapter {
  return { id, kind: 'chapter', number, title, contentHash: `hash:${text}` };
}

describe('matchChapters', () => {
  it('keeps ids of unchanged chapters even when they move', () => {
    const result = matchChapters(
      [existing('a', 1, '甲', 'A'), existing('b', 2, '乙', 'B')],
      [incoming(0, 0, '楔子', 'P'), incoming(1, 1, '甲', 'A'), incoming(2, 2, '乙', 'B')],
    );
    expect(result.matched.map((m) => [m.oldId, m.chapter.index, m.changed])).toEqual([
      ['a', 1, false],
      ['b', 2, false],
    ]);
    expect(result.added.map((c) => c.title)).toEqual(['楔子']);
    expect(result.removedIds).toEqual([]);
  });

  it('keeps the id of a chapter whose text changed, matched by number', () => {
    const result = matchChapters([existing('a', 1, '甲', 'A')], [incoming(0, 1, '甲（修订）', 'A2')]);
    expect(result.matched).toEqual([{ oldId: 'a', chapter: expect.objectContaining({ index: 0 }), changed: true }]);
    expect(result.added).toEqual([]);
  });

  it('matches unnumbered chapters by title', () => {
    const result = matchChapters([existing('n', null, '番外', 'X')], [incoming(0, undefined, '番外', 'X2')]);
    expect(result.matched[0]).toMatchObject({ oldId: 'n', changed: true });
  });

  it('refuses ambiguous identity matches and reports removals', () => {
    const result = matchChapters(
      [existing('a', 5, '甲', 'A'), existing('b', 5, '乙', 'B'), existing('c', 6, '丙', 'C')],
      [incoming(0, 5, '丁', 'D')],
    );
    expect(result.matched).toEqual([]);
    expect(result.added.map((c) => c.title)).toEqual(['丁']);
    expect(result.removedIds).toEqual(['a', 'b', 'c']);
  });

  it('prefers the hash match with the same title when duplicates exist', () => {
    const result = matchChapters(
      [existing('a', 1, '甲', 'SAME'), existing('b', 2, '乙', 'SAME')],
      [incoming(0, 2, '乙', 'SAME')],
    );
    expect(result.matched[0]?.oldId).toBe('b');
  });
});
