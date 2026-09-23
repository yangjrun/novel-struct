import { describe, expect, it } from 'vitest';
import type { SegmentView } from '@novelstruct/db';
import { formatSegments } from '../src/commands/show.js';

function view(overrides: Partial<SegmentView>): SegmentView {
  return {
    index: 0,
    kind: 'narration',
    sceneIndex: 0,
    sceneLocation: null,
    charStart: 0,
    charEnd: 1,
    text: '',
    speakerName: null,
    speakerEntityId: null,
    speakerSurface: null,
    speakerConfidence: null,
    emotionType: null,
    ...overrides,
  };
}

const sample = [
  view({ index: 0, text: '雨还在下。\n', sceneLocation: '铁匠铺' }),
  view({
    index: 1,
    kind: 'dialogue',
    text: '“修好了。”',
    speakerName: '铁老',
    speakerConfidence: 0.6,
    emotionType: 'calm',
  }),
  view({ index: 2, text: '\n他说。' }),
  view({
    index: 3,
    kind: 'thought',
    text: '“真的吗？”',
    speakerSurface: '他',
    speakerConfidence: 0.3,
    sceneIndex: 1,
  }),
];

describe('formatSegments', () => {
  it('prints scene banners, narration paragraphs and labelled speech', () => {
    expect(formatSegments(sample)).toEqual([
      '\n── 场景 0  铁匠铺 ──',
      '  雨还在下。',
      '铁老 (0.6) [calm]：“修好了。”',
      '  他说。',
      '\n── 场景 1 ──',
      '他 (0.3) 心声：“真的吗？”',
    ]);
  });

  it('drops narration that is only whitespace', () => {
    expect(formatSegments([view({ text: '\n' })])).toEqual(['\n── 场景 0 ──']);
  });

  it('colours each speaker consistently and leaves the quote text plain', () => {
    const lines = formatSegments(
      [
        view({ index: 0, kind: 'dialogue', text: '“一”', speakerName: '铁老', speakerConfidence: 0.6 }),
        view({ index: 1, kind: 'dialogue', text: '“二”', speakerName: '顾小满', speakerConfidence: 0.6 }),
        view({ index: 2, kind: 'dialogue', text: '“三”', speakerName: '铁老', speakerConfidence: 0.7 }),
        view({ index: 3, kind: 'dialogue', text: '“四”', speakerSurface: '[unknown]', speakerConfidence: 0 }),
      ],
      { colour: true },
    );
    const ansi = /\[[0-9;]*m/g;
    const codes = lines.slice(1).map((line) => line.match(ansi)?.[0]);
    expect(codes[0]).toBe(codes[2]);
    expect(codes[0]).not.toBe(codes[1]);
    expect(codes[3]).toBe('[38;5;244m');
    expect(lines.slice(1).map((line) => line.replace(ansi, ''))).toEqual([
      '铁老 (0.6)：“一”',
      '顾小满 (0.6)：“二”',
      '铁老 (0.7)：“三”',
      '? (0.0)：“四”',
    ]);
    expect(lines[1]?.endsWith('：“一”')).toBe(true);
  });
});
