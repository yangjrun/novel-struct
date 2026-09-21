import { type ChapterKind, sha256Hex } from '@novelstruct/core';
import { type Heading, parseHeading } from './headings.js';
import { detectLayout, type NormalizedLine } from './normalize-text.js';
import { paragraphsFromText } from './paragraphs.js';
import { headingFromBoundary, mergeHeading, sameHeadingText } from './toc-heading.js';
import type { NormalizedChapter, NormalizedVolume } from './types.js';

export interface SplitResult {
  readonly volumes: readonly NormalizedVolume[];
  readonly chapters: readonly NormalizedChapter[];
  /** Human-readable notes about lines that looked like headings but were kept as prose. */
  readonly warnings: readonly string[];
}

interface OpenChapter {
  readonly kind: ChapterKind;
  readonly heading?: Heading;
  readonly volumeIndex?: number;
  readonly lines: readonly string[];
  /**
   * Set when a table-of-contents entry opened the chapter but the line it pointed at was not the
   * heading itself; the heading may still be one of the next few lines.
   */
  readonly awaitingHeadingLine?: boolean;
}

const FRONT_MATTER_TITLE = '前言';
const VOLUME_PREFACE_TITLE = '卷首语';
/** How many stray lines (a book title, an image caption) may sit between a TOC target and its heading. */
const MAX_LINES_BEFORE_HEADING = 2;

/**
 * Groups normalized lines into volumes and chapters. Lines before the first heading become a
 * book-level `front_matter` chapter; lines between a volume heading and its first chapter become
 * a `front_matter` chapter attached to that volume. Chapter indexes are sequential across all
 * kinds and start at 0.
 *
 * Boundaries carried by a line (EPUB table of contents) open chapters and volumes before the
 * line is placed; the line is dropped when it is the heading the boundary announced. A chapter
 * heading repeating the number of the chapter that is already open (a page-break artifact of
 * scraped files: 第554章血的味道 in the middle of chapter 554) is kept as prose. Chapters that
 * end up with no text at all are dropped and reported.
 */
export function splitChapters(lines: readonly NormalizedLine[]): SplitResult {
  const layout = detectLayout(lines);
  const volumes: NormalizedVolume[] = [];
  const chapters: NormalizedChapter[] = [];
  const repeated = new Map<string, number>();
  const empty: string[] = [];
  let open: OpenChapter = { kind: 'front_matter', lines: [] };

  const close = (): void => {
    if (open.lines.length === 0) {
      if (open.heading !== undefined && open.kind !== 'front_matter') empty.push(open.heading.raw);
      return;
    }
    chapters.push(buildChapter(open, chapters.length));
  };
  const startVolume = (heading: Heading): void => {
    close();
    volumes.push(buildVolume(heading, volumes.length));
    open = { kind: 'front_matter', volumeIndex: volumes.length - 1, lines: [] };
  };
  const startChapter = (heading: Heading, awaitingHeadingLine: boolean): void => {
    close();
    open = openChapter(heading, volumes.length === 0 ? undefined : volumes.length - 1, awaitingHeadingLine);
  };
  const append = (text: string): void => {
    open = { ...open, lines: [...open.lines, text] };
  };

  for (const line of lines) {
    const boundaries = line.boundaries ?? [];
    if (boundaries.length > 0) {
      const headings = boundaries.map(headingFromBoundary);
      for (const heading of headings) {
        if (heading.kind === 'volume') startVolume(heading);
        else startChapter(heading, true);
      }
      const last = headings.at(-1)!;
      if (!sameHeadingText(line.text, last)) append(line.text);
      else if (last.kind !== 'volume')
        open = { ...open, heading: mergeHeading(last, line.text), awaitingHeadingLine: false };
      continue;
    }

    if (isAwaitedHeading(open, line.text)) {
      open = { ...open, heading: mergeHeading(open.heading!, line.text), awaitingHeadingLine: false };
      continue;
    }
    const heading = parseHeading(line.text, { standsOut: layout.indentedBody && !line.indented });
    if (heading === undefined) {
      append(line.text);
    } else if (repeatsOpenChapter(heading, open)) {
      repeated.set(heading.raw, (repeated.get(heading.raw) ?? 0) + 1);
      append(line.text);
    } else if (heading.kind === 'volume') {
      startVolume(heading);
    } else {
      startChapter(heading, false);
    }
  }
  close();
  return { volumes, chapters, warnings: [...repeatWarnings(repeated), ...emptyWarnings(empty)] };
}

function isAwaitedHeading(open: OpenChapter, text: string): boolean {
  return (
    open.awaitingHeadingLine === true &&
    open.heading !== undefined &&
    open.lines.length <= MAX_LINES_BEFORE_HEADING &&
    sameHeadingText(text, open.heading)
  );
}

function repeatsOpenChapter(heading: Heading, open: OpenChapter): boolean {
  return (
    heading.kind === 'chapter' &&
    heading.number !== undefined &&
    open.heading?.kind === 'chapter' &&
    open.heading.number === heading.number
  );
}

function repeatWarnings(repeated: ReadonlyMap<string, number>): string[] {
  return [...repeated.entries()].map(
    ([raw, count]) => `标题「${raw}」在同一章正文中重复出现 ${count} 次，已按正文处理`,
  );
}

function emptyWarnings(empty: readonly string[]): string[] {
  return empty.map((raw) => `章节「${raw}」没有正文，已跳过`);
}

function openChapter(heading: Heading, volumeIndex: number | undefined, awaitingHeadingLine: boolean): OpenChapter {
  const kind: ChapterKind = heading.kind === 'volume' ? 'chapter' : heading.kind;
  return {
    kind,
    heading,
    lines: [],
    ...(volumeIndex === undefined ? {} : { volumeIndex }),
    ...(awaitingHeadingLine ? { awaitingHeadingLine } : {}),
  };
}

function buildVolume(heading: Heading, index: number): NormalizedVolume {
  return {
    index,
    headingRaw: heading.raw,
    ...(heading.number === undefined ? {} : { number: heading.number }),
    ...(heading.title === undefined ? {} : { title: heading.title }),
  };
}

function buildChapter(open: OpenChapter, index: number): NormalizedChapter {
  const text = open.lines.join('\n');
  const heading = open.heading;
  const title = heading?.title ?? defaultTitle(open);
  return {
    index,
    kind: open.kind,
    text,
    paragraphs: paragraphsFromText(text),
    contentHash: sha256Hex(text),
    ...(heading?.number === undefined ? {} : { number: heading.number }),
    ...(title === undefined ? {} : { title }),
    ...(heading === undefined ? {} : { headingRaw: heading.raw }),
    ...(open.volumeIndex === undefined ? {} : { volumeIndex: open.volumeIndex }),
  };
}

function defaultTitle(open: OpenChapter): string | undefined {
  if (open.kind !== 'front_matter') return undefined;
  return open.volumeIndex === undefined ? FRONT_MATTER_TITLE : VOLUME_PREFACE_TITLE;
}
