import { parseChineseNumber } from './chinese-number.js';

/** `front_matter` is never produced from a text line; a table-of-contents label such as 版权信息 yields it. */
export type HeadingKind = 'volume' | 'chapter' | 'prologue' | 'extra' | 'note' | 'front_matter';

export interface Heading {
  readonly kind: HeadingKind;
  readonly number?: number;
  readonly title?: string;
  readonly raw: string;
}

export interface HeadingContext {
  /**
   * True when the line stands out from the file's layout (unindented in an indented-body file).
   * Only then is an author's note such as 请假一天 or 上架感言 accepted as a heading.
   */
  readonly standsOut?: boolean;
}

const MAX_HEADING_LENGTH = 40;
const NUMERAL = '[零〇一二两三四五六七八九十百千万\\d０-９]+';
const SEPARATOR_CHARS = '\\s:：、.．·\\-—';
const SEPARATOR = `[${SEPARATOR_CHARS}]*`;
const KEYWORDS = '楔子|序章|序言|序幕|引子|前言|序|番外|外传|外傳|后记|後記|尾声|尾聲|终章|終章';

/** Punctuation that never appears in a title, whatever follows the chapter marker. */
const HARD_SENTENCE_PUNCTUATION = /[。；;]/;
/** Punctuation that is fine in a real title (开战！) but marks prose when the title is glued to the marker. */
const SOFT_SENTENCE_PUNCTUATION = /[！？!?，,]/;
/** A glued continuation that starts like this is prose about the chapter, not its title: 第三章的内容真精彩 */
const GLUED_PROSE_LEAD = /^[的里中]/;
/** Quote marks; a line containing speech is prose, never a heading. */
const QUOTE_MARKS = /[“”"「」『』]/;

const VOLUME = new RegExp(`^第(${NUMERAL})[卷部](${SEPARATOR})(.*)$`);
const CHAPTER = new RegExp(`^第(${NUMERAL})[章回节集话話](${SEPARATOR})(.*)$`);
const PROLOGUE = new RegExp(`^(楔子|序章|序言|序幕|引子|前言|序)(${SEPARATOR})(.*)$`);
const EXTRA = new RegExp(`^(番外|外传|外傳|后记|後記|尾声|尾聲|终章|終章)(?:篇)?(?:${NUMERAL})?(${SEPARATOR})(.*)$`);
/** A keyword heading ends, or is followed by a separator, right after its optional number: 番外一：雨夜 yes, 序号为三 no. */
const KEYWORD_THEN_SEPARATOR = new RegExp(`^(?:${KEYWORDS})(?:篇)?(?:${NUMERAL})?(?:$|[${SEPARATOR_CHARS}])`);

/** Front-matter metadata lines from download sites; never headings even when they stand out. */
const METADATA_LINE = /^(书名|作者|简介|内容简介|类型|分类|状态|字数|来源|更新时间)[:：]/;
/**
 * Words that mark an author's note between chapters: leave requests, release notes, thanks for
 * donations. Matched only on lines that stand out from the layout, see `HeadingContext`.
 */
const NOTE_KEYWORDS =
  /(请.{0,2}假|感言|更新|公告|上架|完本|新书|单章|加更|两更|三更|四更|盟主|白银盟|黄金盟|白金盟|打赏|月票|推荐票|作者的话|书友|番外预告|感谢|兄弟们|朋友们|告一段落|跨年|新年|感冒|生病|卡文|停更|断更)/;

/**
 * Recognises a normalized (trimmed, non-empty) line as a heading. Returns undefined for prose.
 * Headings are short; their title never contains a full stop; a title glued to the marker with
 * no separator (第一章断剑, common in scraped files) is accepted unless it reads as prose.
 */
export function parseHeading(line: string, context: HeadingContext = {}): Heading | undefined {
  if (line.length === 0 || line.length > MAX_HEADING_LENGTH) return undefined;
  if (METADATA_LINE.test(line)) return undefined;
  return (
    matchNumbered(line, VOLUME, 'volume') ??
    matchNumbered(line, CHAPTER, 'chapter') ??
    matchKeyword(line) ??
    (context.standsOut === true ? matchNote(line) : undefined)
  );
}

function matchNumbered(line: string, pattern: RegExp, kind: 'volume' | 'chapter'): Heading | undefined {
  const m = pattern.exec(line);
  if (m === null) return undefined;
  const number = parseChineseNumber(m[1] ?? '');
  const title = cleanTitle(m[3], (m[2] ?? '').length > 0);
  if (number === undefined || title === null) return undefined;
  return withOptional({ kind, raw: line }, number, title);
}

function matchKeyword(line: string): Heading | undefined {
  if (!KEYWORD_THEN_SEPARATOR.test(line)) return undefined;
  const prologue = PROLOGUE.exec(line);
  if (prologue !== null) return keywordHeading('prologue', line, prologue[3]);
  const extra = EXTRA.exec(line);
  if (extra !== null) return keywordHeading('extra', line, extra[3]);
  return undefined;
}

/** An author's note: the whole line is its title, e.g. 请假一天 or 兄弟们，上架啦！这里是上架感言！ */
function matchNote(line: string): Heading | undefined {
  if (HARD_SENTENCE_PUNCTUATION.test(line) || QUOTE_MARKS.test(line)) return undefined;
  if (!NOTE_KEYWORDS.test(line)) return undefined;
  return { kind: 'note', title: line, raw: line };
}

function keywordHeading(kind: 'prologue' | 'extra', line: string, rawTitle: string | undefined): Heading | undefined {
  const title = cleanTitle(rawTitle, true);
  if (title === null) return undefined;
  return withOptional({ kind, raw: line }, undefined, title);
}

/** Returns null when the title looks like prose, undefined when absent, otherwise the trimmed title. */
function cleanTitle(raw: string | undefined, separated: boolean): string | undefined | null {
  const title = raw?.trim() ?? '';
  if (title.length === 0) return undefined;
  if (HARD_SENTENCE_PUNCTUATION.test(title)) return null;
  if (!separated && (SOFT_SENTENCE_PUNCTUATION.test(title) || GLUED_PROSE_LEAD.test(title))) return null;
  return title;
}

function withOptional(base: Heading, number: number | undefined, title: string | undefined): Heading {
  return {
    ...base,
    ...(number === undefined ? {} : { number }),
    ...(title === undefined ? {} : { title }),
  };
}
