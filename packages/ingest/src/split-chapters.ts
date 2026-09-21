import { type ChapterKind, sha256Hex } from '@novelstruct/core';
import { type Heading, parseHeading } from './headings.js';
import { detectLayout, type NormalizedLine } from './normalize-text.js';
import { paragraphsFromText } from './paragraphs.js';
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
}

const FRONT_MATTER_TITLE = '前言';
const VOLUME_PREFACE_TITLE = '卷首语';

/**
 * Groups normalized lines into volumes and chapters. Lines before the first heading become a
 * book-level `front_matter` chapter; lines between a volume heading and its first chapter become
 * a `front_matter` chapter attached to that volume. Empty front matter is dropped. Chapter
 * indexes are sequential across all kinds and start at 0.
 *
 * A chapter heading repeating the number of the chapter that is already open (a page-break
 * artifact of scraped files: 第554章血的味道 in the middle of chapter 554) is kept as prose.
 */
export function splitChapters(lines: readonly NormalizedLine[]): SplitResult {
  const layout = detectLayout(lines);
  const volumes: NormalizedVolume[] = [];
  const chapters: NormalizedChapter[] = [];
  const repeated = new Map<string, number>();
  let open: OpenChapter = { kind: 'front_matter', lines: [] };

  const close = (): void => {
    if (open.kind === 'front_matter' && open.lines.length === 0) return;
    chapters.push(buildChapter(open, chapters.length));
  };

  for (const line of lines) {
    const heading = parseHeading(line.text, { standsOut: layout.indentedBody && !line.indented });
    if (heading === undefined || repeatsOpenChapter(heading, open)) {
      if (heading !== undefined) repeated.set(heading.raw, (repeated.get(heading.raw) ?? 0) + 1);
      open = { ...open, lines: [...open.lines, line.text] };
    } else if (heading.kind === 'volume') {
      close();
      volumes.push(buildVolume(heading, volumes.length));
      open = { kind: 'front_matter', volumeIndex: volumes.length - 1, lines: [] };
    } else {
      close();
      open = openChapter(heading, volumes.length === 0 ? undefined : volumes.length - 1);
    }
  }
  close();
  return { volumes, chapters, warnings: repeatWarnings(repeated) };
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

function openChapter(heading: Heading, volumeIndex: number | undefined): OpenChapter {
  const kind: ChapterKind = heading.kind === 'volume' ? 'chapter' : heading.kind;
  return volumeIndex === undefined ? { kind, heading, lines: [] } : { kind, heading, volumeIndex, lines: [] };
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
