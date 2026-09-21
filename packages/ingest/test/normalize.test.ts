import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeNovelBytes,
  detectLayout,
  normalizeNovel,
  paragraphsFromText,
  splitLines,
  splitNormalizedLines,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/demo-novel.txt', import.meta.url)));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('decodeNovelBytes', () => {
  it('decodes plain utf-8', () => {
    expect(decodeNovelBytes(utf8('第一章'))).toEqual({ text: '第一章', encoding: 'utf-8', replacedSequences: 0 });
  });

  it('strips a utf-8 byte order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('楔子')]);
    expect(decodeNovelBytes(bytes)).toEqual({ text: '楔子', encoding: 'utf-8', replacedSequences: 0 });
  });

  it('falls back to gb18030 for gbk encoded bytes', () => {
    // "中文" encoded in GBK
    expect(decodeNovelBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toEqual({
      text: '中文',
      encoding: 'gb18030',
      replacedSequences: 0,
    });
  });

  it('keeps utf-8 when only a stray byte is invalid, and reports it', () => {
    const clean = utf8('第一章 断剑\n'.repeat(200));
    const bytes = new Uint8Array([...clean.subarray(0, 30), 0xa0, ...clean.subarray(30)]);
    const decoded = decodeNovelBytes(bytes);
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.replacedSequences).toBe(1);
    expect(decoded.text.startsWith('第一章 断剑')).toBe(true);
  });
});

describe('splitLines', () => {
  it('unifies line endings, trims ideographic space and drops blank lines', () => {
    expect(splitNormalizedLines('　　甲\r\n\r\n  乙  \r丙\n\n')).toEqual(['甲', '乙', '丙']);
  });

  it('remembers which lines the source indented', () => {
    expect(splitLines('　　甲\n乙\n\t丙\n  丁\n 戊')).toEqual([
      { text: '甲', indented: true },
      { text: '乙', indented: false },
      { text: '丙', indented: true },
      { text: '丁', indented: true },
      { text: '戊', indented: false },
    ]);
  });
});

describe('detectLayout', () => {
  it('calls a file indented-body when most lines are indented, and only when it is long enough', () => {
    const body = Array.from({ length: 60 }, (_, i) => ({ text: `第${i}行`, indented: i % 10 !== 0 }));
    expect(detectLayout(body)).toEqual({ indentedBody: true });
    expect(detectLayout(body.slice(0, 20))).toEqual({ indentedBody: false });
    expect(detectLayout(body.map((l) => ({ ...l, indented: false })))).toEqual({ indentedBody: false });
  });
});

describe('paragraphsFromText', () => {
  it('returns offsets that slice back to the lines', () => {
    const text = '第一段\n第二段较长\n三';
    const paragraphs = paragraphsFromText(text);
    expect(paragraphs.map((p) => text.slice(p.charStart, p.charEnd))).toEqual(['第一段', '第二段较长', '三']);
    expect(paragraphs.at(-1)?.charEnd).toBe(text.length);
    expect(paragraphsFromText('')).toEqual([]);
  });
});

describe('normalizeNovel', () => {
  const book = normalizeNovel(fixture);

  it('detects the volume and every chapter kind', () => {
    expect(book.encoding).toBe('utf-8');
    expect(book.replacedSequences).toBe(0);
    expect(book.warnings).toEqual([]);
    expect(book.volumes).toHaveLength(1);
    expect(book.volumes[0]).toMatchObject({ index: 0, number: 1, title: '云来镇' });
    expect(book.chapters.map((c) => [c.index, c.kind, c.title])).toEqual([
      [0, 'prologue', undefined],
      [1, 'chapter', '断剑'],
      [2, 'chapter', '石桥'],
      [3, 'chapter', '夜谈'],
      [4, 'extra', '铁老的信'],
    ]);
  });

  it('assigns chapters after a volume heading to that volume', () => {
    expect(book.chapters[0]?.volumeIndex).toBeUndefined();
    expect(book.chapters[1]).toMatchObject({ number: 1, volumeIndex: 0, headingRaw: '第一章 断剑' });
  });

  it('keeps heading lines out of the text and removes indentation', () => {
    const chapter = book.chapters[1]!;
    expect(chapter.text.startsWith('沈青崖推开铁匠铺的门时')).toBe(true);
    expect(chapter.text.includes('第一章')).toBe(false);
    expect(chapter.text.includes('　')).toBe(false);
  });

  it('produces paragraph offsets that partition the chapter text', () => {
    const chapter = book.chapters[1]!;
    const slices = chapter.paragraphs.map((p) => chapter.text.slice(p.charStart, p.charEnd));
    expect(slices.join('\n')).toBe(chapter.text);
    expect(slices.every((s) => !s.includes('\n'))).toBe(true);
  });

  it('is deterministic', () => {
    const again = normalizeNovel(fixture);
    expect(again.sourceHash).toBe(book.sourceHash);
    expect(again.chapters.map((c) => c.contentHash)).toEqual(book.chapters.map((c) => c.contentHash));
  });

  it('puts text before the first heading into a front_matter chapter', () => {
    const withIntro = normalizeNovel(utf8('作者简介\n\n第一章 开始\n\n正文。'));
    expect(withIntro.chapters.map((c) => [c.kind, c.title])).toEqual([
      ['front_matter', '前言'],
      ['chapter', '开始'],
    ]);
  });

  it('attaches text between a volume heading and its first chapter to that volume', () => {
    const withPreface = normalizeNovel(utf8('第一章 甲\n正文。\n第二卷 北上\n本卷讲述北上的故事。\n第二章 乙\n正文。'));
    expect(withPreface.chapters.map((c) => [c.kind, c.title, c.volumeIndex])).toEqual([
      ['chapter', '甲', undefined],
      ['front_matter', '卷首语', 0],
      ['chapter', '乙', 0],
    ]);
  });

  it('keeps a repeated page-break heading inside the open chapter as prose, with a warning', () => {
    const text = ['第一章 甲', '　　正文一。', '　　第一章甲', '　　正文二。', '第二章 乙', '　　正文三。'].join('\n');
    const book2 = normalizeNovel(utf8(text));
    expect(book2.chapters.map((c) => [c.number, c.text])).toEqual([
      [1, '正文一。\n第一章甲\n正文二。'],
      [2, '正文三。'],
    ]);
    expect(book2.warnings).toEqual(['标题「第一章甲」在同一章正文中重复出现 1 次，已按正文处理']);
  });

  it("splits unindented author's notes out of an indented-body file", () => {
    const body = Array.from({ length: 30 }, (_, i) => `　　第一章的正文第${i}段。`);
    const body2 = Array.from({ length: 30 }, (_, i) => `　　第二章的正文第${i}段。`);
    const text = [
      '书名：测试',
      '第一章 甲',
      ...body,
      '请假一天',
      '　　今天有事，明天补上。',
      '第二章 乙',
      ...body2,
      '　　感谢大家的月票！',
    ].join('\n');
    const book3 = normalizeNovel(utf8(text));
    expect(book3.chapters.map((c) => [c.kind, c.title])).toEqual([
      ['front_matter', '前言'],
      ['chapter', '甲'],
      ['note', '请假一天'],
      ['chapter', '乙'],
    ]);
    expect(book3.chapters[2]?.text).toBe('今天有事，明天补上。');
    expect(book3.chapters[3]?.text.endsWith('感谢大家的月票！')).toBe(true);
  });
});
