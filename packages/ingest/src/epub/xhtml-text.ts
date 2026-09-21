import { Parser } from 'htmlparser2';

/** One block of visible text from an XHTML content document. */
export interface TextBlock {
  readonly text: string;
  /**
   * `id` attributes (and legacy `<a name>`) seen since the previous block was emitted, including
   * those on or inside this block. A table-of-contents fragment resolves to the block that carries it.
   */
  readonly ids: readonly string[];
  /** 1 to 6 when the block is an h1 to h6 element. */
  readonly headingLevel?: number;
}

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);
/** Elements whose text is never story text: metadata, code, and ruby annotations (pinyin over a character). */
const SKIP_TAGS: ReadonlySet<string> = new Set([
  'head',
  'math',
  'rp',
  'rt',
  'script',
  'style',
  'svg',
  'template',
  'title',
]);
const HEADING_TAG = /^h([1-6])$/;
const LATIN = /[A-Za-z0-9]/;

/**
 * Flattens an XHTML document into text blocks: each block-level element becomes one block, `<br>`
 * splits a block, inline markup is dropped. Whitespace runs that contain a line break are removed
 * unless they sit between two Latin letters or digits, so pretty-printed source does not insert
 * spaces into Chinese sentences while "Hello\nWorld" keeps its space.
 */
export function extractTextBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  // Local accumulators; only `blocks` leaves this function.
  let buffer: string[] = [];
  let pendingIds: string[] = [];
  let skipDepth = 0;

  const flush = (headingLevel?: number): void => {
    const text = collapseWhitespace(buffer.join(''));
    buffer = [];
    if (text.length === 0) return;
    blocks.push({ text, ids: pendingIds, ...(headingLevel === undefined ? {} : { headingLevel }) });
    pendingIds = [];
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (SKIP_TAGS.has(name)) {
          skipDepth += 1;
          return;
        }
        if (skipDepth > 0) return;
        const id = attribs['id'] ?? (name === 'a' ? attribs['name'] : undefined);
        if (id !== undefined && id.length > 0) pendingIds = [...pendingIds, id];
        if (name === 'br' || BLOCK_TAGS.has(name)) flush();
      },
      ontext(text) {
        if (skipDepth === 0) buffer = [...buffer, text];
      },
      onclosetag(name) {
        if (SKIP_TAGS.has(name)) {
          skipDepth = Math.max(0, skipDepth - 1);
          return;
        }
        if (skipDepth > 0 || !BLOCK_TAGS.has(name)) return;
        const heading = HEADING_TAG.exec(name);
        flush(heading === null ? undefined : Number(heading[1]));
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  flush();
  return blocks;
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\s+/g, (run: string, offset: number, whole: string) => {
      if (!/[\r\n]/.test(run)) return ' ';
      const before = whole[offset - 1];
      const after = whole[offset + run.length];
      return before !== undefined && after !== undefined && LATIN.test(before) && LATIN.test(after) ? ' ' : '';
    })
    .trim();
}
