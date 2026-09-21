import type { Element } from 'domhandler';
import { findOne, getAttributeValue, isTag, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import { localName } from './package-document.js';
import { type HrefTarget, resolveHref } from './paths.js';

/**
 * One table-of-contents entry in document order. A grouping entry without its own link (a
 * volume heading wrapping its chapters) borrows the target of its first linked descendant, so
 * it still marks where the volume starts.
 */
export interface TocEntry {
  readonly label: string;
  readonly target?: HrefTarget;
  readonly hasChildren: boolean;
}

/** EPUB 3 navigation document: the `<nav epub:type="toc">` list, nested `<ol>` for children. */
export function parseNavToc(html: string, navPath: string): TocEntry[] {
  const doc = parseDocument(html);
  const isNav = (el: Element): boolean => el.name === 'nav';
  const tocNav =
    findOne((el) => isNav(el) && /\btoc\b/i.test(getAttributeValue(el, 'epub:type') ?? ''), doc.children, true) ??
    findOne(isNav, doc.children, true);
  const list = tocNav === null ? null : findOne((el) => el.name === 'ol', tocNav.children, true);
  return list === null ? [] : flattenNavList(list, navPath);
}

function flattenNavList(list: Element, navPath: string): TocEntry[] {
  return childElements(list)
    .filter((li) => li.name === 'li')
    .flatMap((li) => {
      const own = childElements(li);
      const labelEl = own.find((el) => el.name !== 'ol');
      const nested = own.find((el) => el.name === 'ol');
      const children = nested === undefined ? [] : flattenNavList(nested, navPath);
      const label = labelEl === undefined ? '' : cleanLabel(textContent(labelEl));
      const anchor =
        labelEl === undefined
          ? null
          : labelEl.name === 'a'
            ? labelEl
            : findOne((el) => el.name === 'a', labelEl.children, true);
      const href = anchor === null ? undefined : getAttributeValue(anchor, 'href');
      return entryWithChildren(label, href === undefined ? undefined : resolveHref(navPath, href), children);
    });
}

/** EPUB 2 NCX: nested `<navPoint>` elements with `<navLabel><text>` and `<content src>`. */
export function parseNcxToc(xml: string, ncxPath: string): TocEntry[] {
  const doc = parseDocument(xml, { xmlMode: true });
  const navMap = findOne((el) => localName(el) === 'navmap', doc.children, true);
  return navMap === null ? [] : flattenNavPoints(navMap, ncxPath);
}

function flattenNavPoints(parent: Element, ncxPath: string): TocEntry[] {
  return childElements(parent)
    .filter((el) => localName(el) === 'navpoint')
    .flatMap((point) => {
      const own = childElements(point);
      const labelEl = own.find((el) => localName(el) === 'navlabel');
      const content = own.find((el) => localName(el) === 'content');
      const label = labelEl === undefined ? '' : cleanLabel(textContent(labelEl));
      const src = content === undefined ? undefined : getAttributeValue(content, 'src');
      const children = flattenNavPoints(point, ncxPath);
      return entryWithChildren(label, src === undefined ? undefined : resolveHref(ncxPath, src), children);
    });
}

function entryWithChildren(label: string, target: HrefTarget | undefined, children: TocEntry[]): TocEntry[] {
  const borrowed = target ?? children.find((c) => c.target !== undefined)?.target;
  if (label.length === 0 || borrowed === undefined) return children;
  return [{ label, target: borrowed, hasChildren: children.length > 0 }, ...children];
}

function childElements(el: Element): Element[] {
  return el.children.filter(isTag);
}

function cleanLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
