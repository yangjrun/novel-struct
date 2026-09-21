import { describe, expect, it } from 'vitest';
import { aggregateReport, type AggregateInput } from '../src/index.js';

const base: AggregateInput = {
  bookTitle: '示例',
  author: null,
  editionId: 'ed_1',
  editionLabel: 'v1',
  generatedAt: '2026-09-20T00:00:00.000Z',
  chapters: [
    { id: 'chp_1', index: 1, kind: 'chapter', number: 1, title: '断剑', charCount: 100 },
    { id: 'chp_0', index: 0, kind: 'prologue', number: null, title: null, charCount: 30 },
    { id: 'chp_2', index: 2, kind: 'chapter', number: 2, title: null, charCount: 50 },
  ],
  segments: [
    { chapterId: 'chp_1', kind: 'narration', charStart: 0, charEnd: 40, speakerEntityId: null, speakerSurface: null },
    {
      chapterId: 'chp_1',
      kind: 'dialogue',
      charStart: 40,
      charEnd: 60,
      speakerEntityId: 'ent_a',
      speakerSurface: '沈青崖',
    },
    { chapterId: 'chp_1', kind: 'dialogue', charStart: 60, charEnd: 70, speakerEntityId: null, speakerSurface: '他' },
    {
      chapterId: 'chp_1',
      kind: 'thought',
      charStart: 70,
      charEnd: 80,
      speakerEntityId: null,
      speakerSurface: '[unknown]',
    },
    { chapterId: 'chp_1', kind: 'narration', charStart: 80, charEnd: 100, speakerEntityId: null, speakerSurface: null },
    {
      chapterId: 'chp_1',
      kind: 'dialogue',
      charStart: 0,
      charEnd: 0,
      speakerEntityId: 'ent_a',
      speakerSurface: '沈青崖',
    },
  ],
  mentions: [
    { chapterId: 'chp_1', entityId: 'ent_a', count: 3 },
    { chapterId: 'chp_1', entityId: 'ent_b', count: 1 },
  ],
  entities: [
    { id: 'ent_a', type: 'character', canonicalName: '沈青崖' },
    { id: 'ent_b', type: 'location', canonicalName: '云来镇' },
    { id: 'ent_c', type: 'character', canonicalName: '铁老' },
  ],
};

describe('aggregateReport', () => {
  const report = aggregateReport(base);

  it('orders chapters by index and marks which are parsed', () => {
    expect(report.chapters.map((c) => [c.index, c.parsed])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
  });

  it('falls back to a kind or number based title', () => {
    expect(report.chapters.map((c) => c.title)).toEqual(['楔子', '断剑', '第2章']);
  });

  it('counts dialogue by speaker state and chars by segment kind', () => {
    const chapter = report.chapters[1]!;
    expect(chapter.dialogue).toEqual({ resolved: 2, surfaceOnly: 1, unknown: 1 });
    expect(chapter.narrationChars).toBe(60);
    expect(chapter.spokenChars).toBe(40);
    expect(chapter.dialogueBySpeaker).toEqual({ ent_a: 2 });
    expect(chapter.mentionsByEntity).toEqual({ ent_a: 3, ent_b: 1 });
  });

  it('lists only characters, with totals across chapters', () => {
    expect(report.characters).toEqual([
      { id: 'ent_a', name: '沈青崖', dialogueCount: 2, mentionCount: 3 },
      { id: 'ent_c', name: '铁老', dialogueCount: 0, mentionCount: 0 },
    ]);
  });

  it('does not mutate its input', () => {
    const snapshot = JSON.stringify(base);
    aggregateReport(base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
