import { NORMALIZER_VERSION } from '../normalize.js';
import type { NormalizedLine, TocBoundary } from '../normalize-text.js';
import { splitChapters } from '../split-chapters.js';
import type { NormalizedBook } from '../types.js';
import { type EpubArchive, openEpub } from './archive.js';
import {
  isTextDocument,
  type ManifestItem,
  NCX_MEDIA_TYPE,
  type PackageDocument,
  parsePackageDocument,
} from './package-document.js';
import { parseNavToc, parseNcxToc, type TocEntry } from './toc.js';
import { extractTextBlocks, type TextBlock } from './xhtml-text.js';

/** Deepest heading element that stands in for a table of contents when the EPUB has none. */
const FALLBACK_HEADING_LEVEL = 3;

/**
 * Normalizes an EPUB: spine documents in reading order become lines (one block element each),
 * table-of-contents entries mark where chapters and volumes begin, and the shared chapter
 * splitter does the rest, so TXT and EPUB agree on headings, author's notes and page-break
 * duplicates. The navigation document itself is never story text and is skipped.
 */
export function normalizeEpub(bytes: Uint8Array, sourceHash: string): NormalizedBook {
  const archive = openEpub(bytes);
  const pkg = parsePackageDocument(archive.readText(archive.opfPath)!, archive.opfPath);
  const toc = readToc(archive, pkg);
  const spine = spineDocuments(pkg);
  const { lines, warnings } = collectLines(archive, pkg, spine, toc.entries);
  const split = splitChapters(lines);
  return {
    normalizerVersion: NORMALIZER_VERSION,
    format: 'epub',
    encoding: 'utf-8',
    replacedSequences: 0,
    sourceHash,
    metadata: pkg.metadata,
    volumes: split.volumes,
    chapters: split.chapters,
    warnings: [...toc.warnings, ...warnings, ...split.warnings],
  };
}

interface TocResult {
  readonly entries: readonly TocEntry[];
  readonly warnings: readonly string[];
}

/** EPUB 3 nav first, EPUB 2 NCX second; whichever yields entries. */
function readToc(archive: EpubArchive, pkg: PackageDocument): TocResult {
  const nav = pkg.navId === undefined ? undefined : pkg.manifest.get(pkg.navId);
  const navText = nav === undefined ? undefined : archive.readText(nav.path);
  const fromNav = nav === undefined || navText === undefined ? [] : parseNavToc(navText, nav.path);
  if (fromNav.length > 0) return { entries: fromNav, warnings: [] };

  const ncx =
    (pkg.ncxId === undefined ? undefined : pkg.manifest.get(pkg.ncxId)) ??
    [...pkg.manifest.values()].find((item) => item.mediaType === NCX_MEDIA_TYPE);
  const ncxText = ncx === undefined ? undefined : archive.readText(ncx.path);
  const fromNcx = ncx === undefined || ncxText === undefined ? [] : parseNcxToc(ncxText, ncx.path);
  if (fromNcx.length > 0) return { entries: fromNcx, warnings: [] };

  return { entries: [], warnings: [`EPUB 没有可用的目录，按 h1 到 h${FALLBACK_HEADING_LEVEL} 标题和章节标题规则切章`] };
}

function spineDocuments(pkg: PackageDocument): ManifestItem[] {
  return pkg.spine.flatMap((id) => {
    const item = pkg.manifest.get(id);
    return item !== undefined && item.id !== pkg.navId && isTextDocument(item) ? [item] : [];
  });
}

interface CollectedLines {
  readonly lines: readonly NormalizedLine[];
  readonly warnings: readonly string[];
}

function collectLines(
  archive: EpubArchive,
  pkg: PackageDocument,
  spine: readonly ManifestItem[],
  entries: readonly TocEntry[],
): CollectedLines {
  const spinePaths = new Set(spine.map((item) => item.path));
  const warnings: string[] = [];
  const lines: NormalizedLine[] = [];
  const entriesByPath = groupByPath(entries);

  for (const entry of entries) {
    const target = entry.target!;
    if (!spinePaths.has(target.path) && !isNavDocument(pkg, target.path)) {
      warnings.push(`目录条目「${entry.label}」指向的 ${target.path} 不在阅读顺序中，已忽略`);
    }
  }

  for (const item of spine) {
    const html = archive.readText(item.path);
    if (html === undefined) {
      warnings.push(`阅读顺序中的 ${item.path} 在文件里不存在，已跳过`);
      continue;
    }
    const blocks = extractTextBlocks(html);
    const own = entriesByPath.get(item.path) ?? [];
    const boundaries =
      entries.length === 0 ? headingBoundaries(blocks) : placeEntries(own, blocks, item.path, warnings);
    blocks.forEach((block, i) => {
      const at = boundaries.get(i);
      lines.push({ text: block.text, indented: false, ...(at === undefined ? {} : { boundaries: at }) });
    });
  }
  return { lines, warnings };
}

function groupByPath(entries: readonly TocEntry[]): ReadonlyMap<string, readonly TocEntry[]> {
  const grouped = new Map<string, TocEntry[]>();
  for (const entry of entries) {
    const path = entry.target!.path;
    grouped.set(path, [...(grouped.get(path) ?? []), entry]);
  }
  return grouped;
}

function isNavDocument(pkg: PackageDocument, path: string): boolean {
  return pkg.navId !== undefined && pkg.manifest.get(pkg.navId)?.path === path;
}

/**
 * Block index → boundaries, in entry order. An entry whose anchor is missing is dropped when
 * other entries locate positions in the same file (pinning it to the start would collide with
 * them), and pinned to the first block when it is the only entry for the file.
 */
function placeEntries(
  entries: readonly TocEntry[],
  blocks: readonly TextBlock[],
  path: string,
  warnings: string[],
): ReadonlyMap<number, readonly TocBoundary[]> {
  const placed = new Map<number, TocBoundary[]>();
  if (blocks.length === 0) {
    entries.forEach((entry) => warnings.push(`目录条目「${entry.label}」指向的 ${path} 没有文字，已忽略`));
    return placed;
  }
  const located = entries.map((entry) => {
    const fragment = entry.target!.fragment;
    return { entry, index: fragment === undefined ? 0 : blocks.findIndex((b) => b.ids.includes(fragment)) };
  });
  const anyLocated = located.some((l) => l.index !== -1);
  for (const { entry, index } of located) {
    const fragment = entry.target!.fragment ?? '';
    if (index === -1 && anyLocated) {
      warnings.push(`目录条目「${entry.label}」的锚点 #${fragment} 在 ${path} 中不存在，已忽略，交给正文标题规则`);
      continue;
    }
    if (index === -1)
      warnings.push(`目录条目「${entry.label}」的锚点 #${fragment} 在 ${path} 中不存在，已挂到文件开头`);
    const at = Math.max(index, 0);
    placed.set(at, [...(placed.get(at) ?? []), { label: entry.label, hasChildren: entry.hasChildren }]);
  }
  return placed;
}

/** Without a table of contents, h1 to h3 elements stand in for it. */
function headingBoundaries(blocks: readonly TextBlock[]): ReadonlyMap<number, readonly TocBoundary[]> {
  const placed = new Map<number, readonly TocBoundary[]>();
  blocks.forEach((block, i) => {
    if (block.headingLevel !== undefined && block.headingLevel <= FALLBACK_HEADING_LEVEL) {
      placed.set(i, [{ label: block.text, hasChildren: false }]);
    }
  });
  return placed;
}
