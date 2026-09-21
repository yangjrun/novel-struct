import { type Heading, parseHeading } from './headings.js';
import type { TocBoundary } from './normalize-text.js';

/** Table-of-contents labels for pages that are not story text. */
const FRONT_MATTER_LABEL =
  /^(封面|封面页|版权|版权信息|版权页|版权声明|书籍信息|图书信息|内容简介|作品简介|简介|内容介绍|目录|扉页|作者简介|作者介绍|插图|彩页|cover|copyright|title page|contents|table of contents|toc)$/i;
/** `1. 初见`, `001 初见`, `12、雨夜` : a bare ordinal before the title. */
const LEADING_NUMBER = /^(\d{1,4})\s*[.、:：\-—)）]?\s+(\S.*)$/;
/** Whitespace and punctuation that differ between a table of contents and the heading it points at. */
const IGNORED_IN_COMPARISON = /[\s　:：、.．·\-—_,，!！?？'"“”‘’《》()（）[\]【】]/g;

/**
 * Turns a table-of-contents entry into a heading. The label is trusted: it is a heading by
 * definition, so author's notes (请假一天) are recognised without the layout check a text line
 * needs, and anything the text rules cannot read still becomes a chapter titled by the label.
 */
export function headingFromBoundary(boundary: TocBoundary): Heading {
  const label = boundary.label;
  if (FRONT_MATTER_LABEL.test(label)) return { kind: 'front_matter', title: label, raw: label };
  const parsed = parseHeading(label, { standsOut: true });
  if (parsed !== undefined) return parsed;
  if (boundary.hasChildren) return { kind: 'volume', title: label, raw: label };
  const numbered = LEADING_NUMBER.exec(label);
  if (numbered !== null) {
    return { kind: 'chapter', number: Number(numbered[1]), title: numbered[2]!.trim(), raw: label };
  }
  return { kind: 'chapter', title: label, raw: label };
}

/**
 * True when a text line is the heading a boundary announced, so the line is not body text:
 * same wording (ignoring spacing and punctuation), same chapter number, or the same title
 * once the line's own marker is stripped (label 夜谈 against line 第三章 夜谈, or the reverse).
 */
export function sameHeadingText(text: string, heading: Heading): boolean {
  const squashed = squash(text);
  if (squashed.length === 0) return false;
  if (squashed === squash(heading.raw)) return true;
  if (heading.title !== undefined && squashed === squash(heading.title)) return true;
  const parsed = parseHeading(text, { standsOut: true });
  if (parsed === undefined) return false;
  if (parsed.number !== undefined && parsed.kind === heading.kind && parsed.number === heading.number) return true;
  if (parsed.title === undefined) return false;
  const title = squash(parsed.title);
  return title === squash(heading.raw) || (heading.title !== undefined && title === squash(heading.title));
}

/** The boundary heading completed by what the heading line itself says: its raw text, and a number or title the label lacked. */
export function mergeHeading(base: Heading, line: string): Heading {
  const parsed = parseHeading(line, { standsOut: true });
  return {
    ...base,
    ...(base.number === undefined && parsed?.number !== undefined ? { number: parsed.number } : {}),
    ...(base.title === undefined && parsed?.title !== undefined ? { title: parsed.title } : {}),
    raw: line,
  };
}

function squash(text: string): string {
  return text.replace(IGNORED_IN_COMPARISON, '');
}
