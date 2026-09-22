import path from 'node:path';

export interface FilenameMeta {
  readonly title: string;
  readonly author?: string;
}

/** Bracket groups that describe the file, not the author. */
const NOT_AN_AUTHOR = /完结|全本|精校|校对|未删节|txt|epub|无弹窗|最新/i;
const BRACKETS: readonly (readonly [string, string])[] = [
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['【', '】'],
];
const AUTHOR_LABEL = /^(.*?)[\s_-]*作者[:：]\s*(.+)$/;

/**
 * Title and author from a novel file name. Chinese novel sites name files `书名(作者).txt`,
 * `书名【作者】.epub` or `书名 作者：某某.txt`; a trailing bracket group that only says
 * "完结" or "精校" is dropped rather than mistaken for an author.
 */
export function titleFromFilename(filename: string): FilenameMeta {
  const stem = path
    .basename(filename)
    .replace(/\.[^.]+$/, '')
    .trim();
  const labelled = AUTHOR_LABEL.exec(stem);
  if (labelled !== null) return meta(labelled[1] ?? '', labelled[2]);

  for (const [open, close] of BRACKETS) {
    if (!stem.endsWith(close)) continue;
    const start = stem.lastIndexOf(open);
    if (start <= 0) continue;
    const inner = stem.slice(start + open.length, -close.length).trim();
    const rest = stem.slice(0, start).trim();
    if (NOT_AN_AUTHOR.test(inner)) return titleFromFilename(`${rest}.x`);
    return meta(rest, inner);
  }
  return meta(stem, undefined);
}

function meta(title: string, author: string | undefined): FilenameMeta {
  const cleanTitle = title.trim().replace(/[\s_-]+$/, '');
  const cleanAuthor = author?.trim();
  return {
    title: cleanTitle,
    ...(cleanAuthor === undefined || cleanAuthor.length === 0 ? {} : { author: cleanAuthor }),
  };
}
