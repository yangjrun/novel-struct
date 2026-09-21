import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  collapseWhitespace,
  EpubFormatError,
  extractTextBlocks,
  headingFromBoundary,
  isZipArchive,
  normalizeNovel,
  parseNavToc,
  parseNcxToc,
  resolveHref,
  sameHeadingText,
} from '../src/index.js';
import { buildEpub, demoEpub2, demoEpub3, demoEpubWithoutToc } from './helpers/build-epub.js';

describe('resolveHref', () => {
  it('resolves relative paths against the referring file and keeps fragments', () => {
    expect(resolveHref('OEBPS/content.opf', 'Text/ch1.xhtml')).toEqual({ path: 'OEBPS/Text/ch1.xhtml' });
    expect(resolveHref('OEBPS/Text/nav.xhtml', '../Text/ch1.xhtml#c1')).toEqual({
      path: 'OEBPS/Text/ch1.xhtml',
      fragment: 'c1',
    });
    expect(resolveHref('content.opf', 'ch%201.xhtml')).toEqual({ path: 'ch 1.xhtml' });
    expect(resolveHref('OEBPS/nav.xhtml', '#top')).toEqual({ path: 'OEBPS/nav.xhtml', fragment: 'top' });
    expect(resolveHref('OEBPS/nav.xhtml', '/OEBPS/x.xhtml')).toEqual({ path: 'OEBPS/x.xhtml' });
  });
});

describe('collapseWhitespace', () => {
  it('drops line breaks inside Chinese text but keeps a space between Latin words', () => {
    expect(collapseWhitespace('　　你好\n    世界  ')).toBe('你好世界');
    expect(collapseWhitespace('Hello\n   World')).toBe('Hello World');
    expect(collapseWhitespace('a  b')).toBe('a b');
  });
});

describe('extractTextBlocks', () => {
  it('turns block elements into blocks, splits on br, skips head, scripts and ruby annotations', () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <h2 id="c1"><span>第一章</span> 断剑</h2>
      <p>第一段。<br/>第二段。</p>
      <div><p>嵌套<b>加粗</b>段。</p></div>
      <p>汉<ruby>字<rt>zì</rt></ruby>。</p>
      <script>alert(1)</script>
      <p>&nbsp;</p>
      <a id="anchor"></a>
      <p>最后&amp;一段。</p>
    </body></html>`;
    expect(extractTextBlocks(html)).toEqual([
      { text: '第一章 断剑', ids: ['c1'], headingLevel: 2 },
      { text: '第一段。', ids: [] },
      { text: '第二段。', ids: [] },
      { text: '嵌套加粗段。', ids: [] },
      { text: '汉字。', ids: [] },
      { text: '最后&一段。', ids: ['anchor'] },
    ]);
  });

  it('carries ids across empty blocks and accepts legacy a name anchors', () => {
    const blocks = extractTextBlocks('<body><div id="wrap"><a name="old"></a><p></p><p id="p1">文</p></div></body>');
    expect(blocks).toEqual([{ text: '文', ids: ['wrap', 'old', 'p1'] }]);
  });
});

describe('parseNavToc / parseNcxToc', () => {
  it('flattens a nav list, giving a linkless group the target of its first child', () => {
    const nav = `<html xmlns:epub="x"><body><nav epub:type="landmarks"><ol><li><a href="x.xhtml">x</a></li></ol></nav>
      <nav epub:type="toc"><ol>
        <li><a href="a.xhtml">甲</a></li>
        <li><span>第一卷</span><ol><li><a href="b.xhtml#b1">乙</a></li><li><a href="b.xhtml#b2">丙</a></li></ol></li>
        <li><span>没有目标的组</span></li>
      </ol></nav></body></html>`;
    expect(parseNavToc(nav, 'OEBPS/nav.xhtml')).toEqual([
      { label: '甲', target: { path: 'OEBPS/a.xhtml' }, hasChildren: false },
      { label: '第一卷', target: { path: 'OEBPS/b.xhtml', fragment: 'b1' }, hasChildren: true },
      { label: '乙', target: { path: 'OEBPS/b.xhtml', fragment: 'b1' }, hasChildren: false },
      { label: '丙', target: { path: 'OEBPS/b.xhtml', fragment: 'b2' }, hasChildren: false },
    ]);
  });

  it('flattens nested navPoints', () => {
    const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint><navLabel><text> 第一卷 </text></navLabel><content src="v1.xhtml"/>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="c1.xhtml"/></navPoint>
      </navPoint>
    </navMap></ncx>`;
    expect(parseNcxToc(ncx, 'toc.ncx')).toEqual([
      { label: '第一卷', target: { path: 'v1.xhtml' }, hasChildren: true },
      { label: '第一章', target: { path: 'c1.xhtml' }, hasChildren: false },
    ]);
  });
});

describe('headingFromBoundary / sameHeadingText', () => {
  it('maps labels to kinds, trusting the label as a heading', () => {
    expect(headingFromBoundary({ label: '版权信息', hasChildren: false })).toMatchObject({ kind: 'front_matter' });
    expect(headingFromBoundary({ label: '第一卷 云来镇', hasChildren: true })).toMatchObject({
      kind: 'volume',
      number: 1,
    });
    expect(headingFromBoundary({ label: '正文', hasChildren: true })).toMatchObject({ kind: 'volume', title: '正文' });
    expect(headingFromBoundary({ label: '请假一天', hasChildren: false })).toMatchObject({ kind: 'note' });
    expect(headingFromBoundary({ label: '12. 雨夜', hasChildren: false })).toMatchObject({
      kind: 'chapter',
      number: 12,
      title: '雨夜',
    });
    expect(headingFromBoundary({ label: 'Chapter One', hasChildren: false })).toEqual({
      kind: 'chapter',
      title: 'Chapter One',
      raw: 'Chapter One',
    });
  });

  it('recognises the heading line a label announced, with or without the chapter marker', () => {
    const chapter = headingFromBoundary({ label: '第三章 夜谈', hasChildren: false });
    expect(sameHeadingText('第三章　夜谈', chapter)).toBe(true);
    expect(sameHeadingText('夜谈', chapter)).toBe(true);
    expect(sameHeadingText('第三章 另一个题目', chapter)).toBe(true);
    expect(sameHeadingText('夜里，雨终于停了。', chapter)).toBe(false);
    const bare = headingFromBoundary({ label: '夜谈', hasChildren: false });
    expect(sameHeadingText('第三章 夜谈', bare)).toBe(true);
  });
});

describe('normalizeNovel with an EPUB', () => {
  it('reads EPUB 3 metadata, follows the nav, and splits chapters at its targets', () => {
    const book = normalizeNovel(demoEpub3());
    expect(book.format).toBe('epub');
    expect(book.metadata).toEqual({ title: '示例小说', author: '示例作者' });
    expect(book.volumes).toEqual([{ index: 0, number: 1, title: '云来镇', headingRaw: '第一卷 云来镇' }]);
    expect(book.chapters.map((c) => [c.kind, c.number, c.title, c.volumeIndex])).toEqual([
      ['front_matter', undefined, '版权信息', undefined],
      ['chapter', 1, '断剑', 0],
      ['chapter', 2, '石桥', 0],
      ['chapter', 3, '夜谈', 0],
      ['extra', undefined, '铁老的信', 0],
      ['note', undefined, '请假一天', 0],
    ]);
    expect(book.chapters[0]?.text).toBe('示例小说 / 示例作者');
    expect(book.chapters[1]?.headingRaw).toBe('第一章 断剑');
    expect(book.chapters[1]?.text.startsWith('沈青崖推开铁匠铺的门时')).toBe(true);
    expect(book.chapters[1]?.text.includes('第一章')).toBe(false);
    expect(book.chapters[3]?.headingRaw).toBe('夜谈');
    expect(book.chapters[3]?.text).toBe('夜里，雨终于停了。\n“青崖哥，你为什么一定要用这柄剑？”她问。');
    expect(book.warnings).toEqual(['目录条目「封面」指向的 OEBPS/cover.xhtml 没有文字，已忽略']);
  });

  it('reads EPUB 2 NCX, drops an entry whose anchor is missing, and warns', () => {
    const book = normalizeNovel(demoEpub2());
    expect(book.volumes).toHaveLength(1);
    expect(book.chapters.map((c) => [c.kind, c.title])).toEqual([
      ['front_matter', '版权信息'],
      ['chapter', '断剑'],
      ['chapter', '石桥'],
      ['extra', '铁老的信'],
      ['note', '请假一天'],
    ]);
    // 第三章's anchor is broken and its heading has no chapter marker, so it stays inside 第二章.
    expect(book.chapters[2]?.text).toContain('夜谈');
    expect(book.warnings).toEqual([
      '目录条目「第三章 夜谈」的锚点 #nope 在 OEBPS/ch2-3.xhtml 中不存在，已忽略，交给正文标题规则',
    ]);
  });

  it('lets a chapter opened by a TOC entry claim a heading line that follows a stray line', () => {
    const book = normalizeNovel(
      buildEpub({
        title: 't',
        docs: { 'c.xhtml': '<p>书名</p><h2>夜谈</h2><p>正文。</p>' },
        nav: '<nav epub:type="toc"><ol><li><a href="c.xhtml">第三章 夜谈</a></li></ol></nav>',
      }),
    );
    expect(book.chapters.map((c) => [c.number, c.title, c.headingRaw, c.text])).toEqual([
      [3, '夜谈', '夜谈', '书名\n正文。'],
    ]);
  });

  it('falls back to headings and chapter markers when there is no table of contents', () => {
    const book = normalizeNovel(demoEpubWithoutToc());
    expect(book.metadata).toEqual({ title: '无目录' });
    expect(book.chapters.map((c) => [c.kind, c.number, c.title, c.text])).toEqual([
      ['front_matter', undefined, '前言', '作者简介：某人。'],
      ['chapter', 1, '甲', '正文一。'],
      ['chapter', 2, '乙', '正文二。'],
      ['extra', undefined, undefined, '正文三。\n不是章节\n正文四。'],
    ]);
    expect(book.warnings).toEqual(['EPUB 没有可用的目录，按 h1 到 h3 标题和章节标题规则切章']);
  });

  it('is deterministic and keeps TXT input on the TXT path', () => {
    const once = normalizeNovel(demoEpub3());
    const twice = normalizeNovel(demoEpub3());
    expect(twice.chapters.map((c) => c.contentHash)).toEqual(once.chapters.map((c) => c.contentHash));
    const txt = normalizeNovel(new TextEncoder().encode('第一章 甲\n正文。'));
    expect(txt.format).toBe('txt');
    expect(txt.metadata).toEqual({});
    expect(isZipArchive(new TextEncoder().encode('PK not really'))).toBe(false);
  });

  it('rejects a zip that is not an EPUB with a readable message', () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi') });
    expect(isZipArchive(zip)).toBe(true);
    expect(() => normalizeNovel(zip)).toThrow(EpubFormatError);
    expect(() => normalizeNovel(zip)).toThrow(/container\.xml/);
  });
});
