import { expect, it } from 'vitest';
import { locateConsistencyEvidence, locateTimedConsistencyEvidence } from '../src/consistency-evidence.js';

it('keeps the time anchor and intervening text in the persisted continuous quote', () => {
  const text = '九月初。\n沈青崖出门。\n她收下了糖。';
  expect(
    locateTimedConsistencyEvidence(text, {
      storyTime: '九月初',
      evidence: { quote: '她收下了糖。' },
      timeEvidence: { quote: '九月初。' },
    }),
  ).toEqual({ quote: text, charStart: 0, charEnd: text.length });
});

it('requires a real chapter quote for a supplied time and rejects orphan anchors', () => {
  const text = '她收下了糖。';
  expect(() => locateTimedConsistencyEvidence(text, { evidence: { quote: text }, storyTime: '九月初' })).toThrow(
    'timeEvidence',
  );
  expect(() =>
    locateTimedConsistencyEvidence(text, {
      evidence: { quote: text },
      storyTime: '九月初',
      timeEvidence: { quote: '九月初' },
    }),
  ).toThrow('找不到原文');
  expect(() =>
    locateTimedConsistencyEvidence(text, { evidence: { quote: text }, timeEvidence: { quote: text } }),
  ).toThrow('必须对应');
});

it('preserves UTF-16 boundaries when the time anchor follows the assertion or overlaps it', () => {
  const text = '🌙她收下了糖。那是九月初。';
  expect(
    locateTimedConsistencyEvidence(text, {
      storyTime: '九月初',
      evidence: { quote: '她收下了糖。' },
      timeEvidence: { quote: '那是九月初。' },
    }),
  ).toEqual({ quote: text.slice(2), charStart: 2, charEnd: text.length });
  expect(
    locateTimedConsistencyEvidence(text, {
      storyTime: '九月初',
      evidence: { quote: text },
      timeEvidence: { quote: '九月初' },
    }),
  ).toEqual({ quote: text, charStart: 0, charEnd: text.length });
});

it('requires disambiguation of repeated time anchors and rejects blank story times', () => {
  const text = '次日。她收下了糖。次日。';
  expect(() =>
    locateTimedConsistencyEvidence(text, {
      storyTime: '次日',
      evidence: { quote: '她收下了糖。' },
      timeEvidence: { quote: '次日。' },
    }),
  ).toThrow('不唯一');
  expect(() =>
    locateTimedConsistencyEvidence(text, { storyTime: ' ', evidence: { quote: text }, timeEvidence: { quote: text } }),
  ).toThrow('故事时间不能为空');
});

it('locates an exact quote using UTF-16 offsets without asking the model to count', () => {
  const text = '🌙夜里，沈青崖到了石桥。';
  const quote = '沈青崖到了石桥。';
  expect(locateConsistencyEvidence(text, { quote })).toEqual({ quote, charStart: 5, charEnd: text.length });
  expect(locateConsistencyEvidence(text, { quote, charStart: 4, charEnd: 12 })).toEqual({
    quote,
    charStart: 5,
    charEnd: text.length,
  });
});

it('uses valid offsets to distinguish a repeated quote', () => {
  expect(locateConsistencyEvidence('来了。来了。', { quote: '来了。', charStart: 3, charEnd: 6 })).toEqual({
    quote: '来了。',
    charStart: 3,
    charEnd: 6,
  });
});

it.each([
  ['来了。来了。', { quote: '来了。' }],
  ['来了。来了。', { quote: '来了。', charStart: 1, charEnd: 4 }],
  ['哈哈哈', { quote: '哈哈' }],
])('rejects ambiguous evidence including overlapping occurrences', (text, evidence) => {
  expect(() => locateConsistencyEvidence(text, evidence)).toThrow(/不唯一/);
});

it.each(['沈青崖到石桥。', '沈青崖到了石桥', '沈青崖…石桥。'])(
  'does not normalize, paraphrase or join evidence: %s',
  (quote) => {
    expect(() => locateConsistencyEvidence('沈青崖 到了石桥。', { quote })).toThrow(/找不到原文/);
  },
);

it('rejects empty evidence', () => {
  expect(() => locateConsistencyEvidence('原文', { quote: '' })).toThrow(/不能为空/);
});
