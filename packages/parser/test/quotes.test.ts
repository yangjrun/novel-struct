import { describe, expect, it } from 'vitest';
import { paragraphsFromText } from '@novelstruct/ingest';
import { extractQuotes } from '../src/index.js';

function extract(text: string) {
  return extractQuotes(text, paragraphsFromText(text));
}

describe('extractQuotes', () => {
  it('finds closed quotes with their marks and inner text', () => {
    const text = '铁老说道：“修好了。”他点点头。';
    const { quotes, warnings } = extract(text);
    expect(warnings).toEqual([]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ id: 'q0', paragraphIndex: 0, text: '“修好了。”', inner: '修好了。' });
    expect(text.slice(quotes[0]!.charStart, quotes[0]!.charEnd)).toBe('“修好了。”');
  });

  it('finds several quotes in one paragraph in order', () => {
    const { quotes } = extract('“青崖哥！”顾小满喘着气，“石桥塌了！”');
    expect(quotes.map((q) => q.inner)).toEqual(['青崖哥！', '石桥塌了！']);
    expect(quotes.map((q) => q.id)).toEqual(['q0', 'q1']);
  });

  it('supports corner brackets and ascii quotes', () => {
    const { quotes } = extract('「你倒是想得开。」\n"Fine."');
    expect(quotes.map((q) => [q.paragraphIndex, q.inner])).toEqual([
      [0, '你倒是想得开。'],
      [1, 'Fine.'],
    ]);
  });

  it('extends an unclosed quote to the paragraph end and warns', () => {
    const text = '“第一段没有闭合\n“第二段闭合了。”';
    const { quotes, warnings } = extract(text);
    expect(quotes.map((q) => q.text)).toEqual(['“第一段没有闭合', '“第二段闭合了。”']);
    expect(warnings).toHaveLength(1);
  });

  it('ignores empty quotes', () => {
    const { quotes, warnings } = extract('他说：“”然后走了。');
    expect(quotes).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('keeps short quoted terms in narration while retaining short utterances', () => {
    const text = [
      '他们以“第四天灾”的身份降临。',
      '所谓“废土人”没有受过教育。',
      '像极了“刁民时代”里的那种。',
      '确实有“五个”盒子。',
      '楚光说道：“走。”',
      '“嗯。”他点头。',
      '“谢谢。”她说。',
    ].join('\n');
    const { quotes, warnings } = extract(text);
    expect(quotes.map((q) => q.inner)).toEqual(['走。', '嗯。', '谢谢。']);
    expect(quotes.map((q) => q.id)).toEqual(['q0', 'q1', 'q2']);
    expect(warnings.filter((warning) => warning.includes('quoted term'))).toHaveLength(4);
  });
});
