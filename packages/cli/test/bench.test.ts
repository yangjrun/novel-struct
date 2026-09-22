import { describe, expect, it } from 'vitest';
import { chineseNumber, syntheticNovel } from '../src/commands/bench.js';

describe('chineseNumber', () => {
  it('writes numbers the way chapter headings do', () => {
    expect([1, 10, 11, 20, 99, 100, 101, 110, 234, 1000, 1005, 1234].map(chineseNumber)).toEqual([
      '一',
      '十',
      '十一',
      '二十',
      '九十九',
      '一百',
      '一百零一',
      '一百一十',
      '二百三十四',
      '一千',
      '一千零五',
      '一千二百三十四',
    ]);
  });
});

describe('syntheticNovel', () => {
  it('produces a titled TXT with one heading per chapter and distinct casts per book', () => {
    const a = syntheticNovel(1, 3);
    const b = syntheticNovel(2, 3);
    expect(a.title).toBe('压测小说001');
    expect(a.text.match(/^第.+章 第\d+天$/gm)).toHaveLength(3);
    expect(a.text).toContain('第三章 第3天');
    expect(a.text).not.toBe(b.text);
  });
});
