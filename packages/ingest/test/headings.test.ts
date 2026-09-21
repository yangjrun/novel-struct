import { describe, expect, it } from 'vitest';
import { parseChineseNumber } from '../src/chinese-number.js';
import { parseHeading } from '../src/headings.js';

describe('parseChineseNumber', () => {
  it.each([
    ['1', 1],
    ['325', 325],
    ['１２', 12],
    ['一', 1],
    ['十', 10],
    ['十五', 15],
    ['二十', 20],
    ['两百', 200],
    ['三百二十五', 325],
    ['一千零一', 1001],
    ['一万二千三百四十五', 12345],
    ['〇', 0],
    ['一〇八', 108],
    ['二零二四', 2024],
    ['一二三', 123],
  ])('parses %s as %d', (input, expected) => {
    expect(parseChineseNumber(input)).toBe(expected);
  });

  it('rejects non numerals', () => {
    expect(parseChineseNumber('')).toBeUndefined();
    expect(parseChineseNumber('abc')).toBeUndefined();
    expect(parseChineseNumber('三章')).toBeUndefined();
  });
});

describe('parseHeading', () => {
  it('recognises numbered chapters with and without titles', () => {
    expect(parseHeading('第一章 断剑')).toEqual({ kind: 'chapter', number: 1, title: '断剑', raw: '第一章 断剑' });
    expect(parseHeading('第325章：重返炎城')).toEqual({
      kind: 'chapter',
      number: 325,
      title: '重返炎城',
      raw: '第325章：重返炎城',
    });
    expect(parseHeading('第十二回')).toEqual({ kind: 'chapter', number: 12, raw: '第十二回' });
    expect(parseHeading('第一〇八章 夜袭')).toMatchObject({ number: 108, title: '夜袭' });
  });

  it('accepts titles glued to the marker and titles with expressive punctuation', () => {
    expect(parseHeading('第一章断剑')).toMatchObject({ kind: 'chapter', number: 1, title: '断剑' });
    expect(parseHeading('第五章 开战！')).toMatchObject({ number: 5, title: '开战！' });
    expect(parseHeading('第七章 风起，云涌')).toMatchObject({ number: 7, title: '风起，云涌' });
    expect(parseHeading('第九章 中秋')).toMatchObject({ number: 9, title: '中秋' });
    expect(parseHeading('第63章 大鱼吃小鱼，小鱼吃虾米（1/4）')).toMatchObject({ number: 63 });
    expect(parseHeading('第五章 第四天灾')).toMatchObject({ number: 5, title: '第四天灾' });
  });

  it('recognises volumes', () => {
    expect(parseHeading('第一卷 云来镇')).toEqual({ kind: 'volume', number: 1, title: '云来镇', raw: '第一卷 云来镇' });
  });

  it('recognises prologue and extra keywords', () => {
    expect(parseHeading('楔子')).toEqual({ kind: 'prologue', raw: '楔子' });
    expect(parseHeading('番外 铁老的信')).toEqual({ kind: 'extra', title: '铁老的信', raw: '番外 铁老的信' });
    expect(parseHeading('番外一：雨夜')).toEqual({ kind: 'extra', title: '雨夜', raw: '番外一：雨夜' });
  });

  it('does not treat prose as a heading', () => {
    expect(parseHeading('第三章的内容真精彩。')).toBeUndefined();
    expect(parseHeading('第三章的内容真精彩')).toBeUndefined();
    expect(parseHeading('第三章，他终于回来了')).toBeUndefined();
    expect(parseHeading('第三章 他终于回来了。')).toBeUndefined();
    expect(parseHeading('序号为三的房间')).toBeUndefined();
    expect(parseHeading('第一章 ' + '很长的标题'.repeat(10))).toBeUndefined();
    expect(parseHeading('他翻开第一章，开始读。')).toBeUndefined();
  });

  it('never treats download-site metadata as a heading', () => {
    expect(parseHeading('书名：这游戏也太真实了', { standsOut: true })).toBeUndefined();
    expect(parseHeading('作者：晨星LL', { standsOut: true })).toBeUndefined();
  });

  it("recognises an author's note only when the line stands out from the layout", () => {
    expect(parseHeading('请假一天', { standsOut: true })).toEqual({ kind: 'note', title: '请假一天', raw: '请假一天' });
    expect(parseHeading('兄弟们，上架啦！这里是上架感言！', { standsOut: true })).toMatchObject({ kind: 'note' });
    expect(parseHeading('感谢伊蕾娜大佬的白银盟！！！', { standsOut: true })).toMatchObject({ kind: 'note' });
    expect(parseHeading('今日更新推迟几个小时（不是请假！）', { standsOut: true })).toMatchObject({ kind: 'note' });
    expect(parseHeading('番外预告', { standsOut: true })).toMatchObject({ kind: 'note' });
    expect(parseHeading('请假一天')).toBeUndefined();
    expect(parseHeading('请假一天', { standsOut: false })).toBeUndefined();
  });

  it('does not turn ordinary prose into a note even when it stands out', () => {
    expect(parseHeading('他请假一天去了医院。', { standsOut: true })).toBeUndefined();
    expect(parseHeading('“我想请假一天”', { standsOut: true })).toBeUndefined();
    expect(parseHeading('楚光松了口气', { standsOut: true })).toBeUndefined();
  });
});
