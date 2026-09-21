import type { Element } from 'domhandler';
import { findAll, findOne, getAttributeValue, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import type { BookMetadata } from '../types.js';
import { resolveHref } from './paths.js';

export interface ManifestItem {
  readonly id: string;
  /** Zip entry path, resolved against the OPF location. */
  readonly path: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

export interface PackageDocument {
  readonly metadata: BookMetadata;
  readonly manifest: ReadonlyMap<string, ManifestItem>;
  /** Manifest ids in reading order; items marked `linear="no"` are left out. */
  readonly spine: readonly string[];
  /** Manifest id of the EPUB 2 NCX, from the spine's `toc` attribute. */
  readonly ncxId?: string;
  /** Manifest id of the EPUB 3 navigation document. */
  readonly navId?: string;
}

const HTML_MEDIA_TYPES: ReadonlySet<string> = new Set(['application/xhtml+xml', 'text/html', 'application/xml']);
const HTML_EXTENSION = /\.(x?html?|xml)$/i;
export const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

/** Reads manifest, spine and Dublin Core title/creator from an OPF package document. */
export function parsePackageDocument(xml: string, opfPath: string): PackageDocument {
  const doc = parseDocument(xml, { xmlMode: true });
  const manifest = new Map<string, ManifestItem>();
  for (const el of findAll((el) => localName(el) === 'item', doc.children)) {
    const id = getAttributeValue(el, 'id');
    const href = getAttributeValue(el, 'href');
    if (id === undefined || href === undefined) continue;
    manifest.set(id, {
      id,
      path: resolveHref(opfPath, href).path,
      mediaType: (getAttributeValue(el, 'media-type') ?? '').trim().toLowerCase(),
      properties: (getAttributeValue(el, 'properties') ?? '').split(/\s+/).filter((p) => p.length > 0),
    });
  }

  const spineEl = findOne((el) => localName(el) === 'spine', doc.children, true);
  const spine =
    spineEl === null
      ? []
      : findAll((el) => localName(el) === 'itemref', spineEl.children).flatMap((el) => {
          const idref = getAttributeValue(el, 'idref');
          return idref === undefined || getAttributeValue(el, 'linear') === 'no' ? [] : [idref];
        });
  const ncxId = spineEl === null ? undefined : getAttributeValue(spineEl, 'toc');
  const navId = [...manifest.values()].find((item) => item.properties.includes('nav'))?.id;
  const title = dublinCore(doc.children, 'title');
  const author = dublinCore(doc.children, 'creator');

  return {
    metadata: { ...(title === undefined ? {} : { title }), ...(author === undefined ? {} : { author }) },
    manifest,
    spine,
    ...(ncxId === undefined ? {} : { ncxId }),
    ...(navId === undefined ? {} : { navId }),
  };
}

/** True for a manifest item that carries chapter text rather than an image, font or style sheet. */
export function isTextDocument(item: ManifestItem): boolean {
  return HTML_MEDIA_TYPES.has(item.mediaType) || (item.mediaType.length === 0 && HTML_EXTENSION.test(item.path));
}

function dublinCore(nodes: Element['children'], name: string): string | undefined {
  const el = findOne((el) => localName(el) === name && isMetadataChild(el), nodes, true);
  const text = el === null ? '' : textContent(el).replace(/\s+/g, ' ').trim();
  return text.length === 0 ? undefined : text;
}

function isMetadataChild(el: Element): boolean {
  const parent = el.parent;
  if (parent === null || parent.type !== 'tag') return false;
  const parentName = localName(parent);
  return parentName === 'metadata' || parentName === 'dc-metadata';
}

export function localName(el: Element): string {
  return (el.name.split(':').pop() ?? el.name).toLowerCase();
}
