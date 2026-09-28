import { expect, it } from 'vitest';
import { locateConsistencyEvidence } from '../src/consistency-evidence.js';

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
