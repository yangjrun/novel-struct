import type { Command } from 'commander';
import { UNKNOWN_SPEAKER_SURFACE } from '@novelstruct/core';
import { getChapterByIndex, listChapterSegments, type SegmentView } from '@novelstruct/db';
import {
  colourEnabled,
  colourSpeaker,
  colourThought,
  colourUnknown,
  createSpeakerPalette,
  dim,
  type SpeakerPalette,
} from '../colour.js';
import { fail, parseIndex, withDatabase } from '../context.js';
import { print } from '../output.js';

interface ShowOptions {
  readonly color?: boolean;
}

const NARRATION_INDENT = '  ';

export function registerShow(program: Command): void {
  program
    .command('show <editionId> <chapterIndex>')
    .description('按分段顺序显示某章的说话人和文本，终端里每个角色一种颜色')
    .option('--no-color', '关闭颜色')
    .action(async (editionId: string, chapterIndex: string, options: ShowOptions) => {
      const index = parseIndex(chapterIndex);
      const colour = options.color !== false && colourEnabled();
      await withDatabase(async (db) => {
        const chapter = await getChapterByIndex(db, editionId, index);
        if (chapter === undefined) fail(`版本 ${editionId} 没有 index 为 ${index} 的章节`);
        const segments = await listChapterSegments(db, chapter.id);
        print(`${chapter.headingRaw ?? chapter.title ?? chapter.kind}  (${chapter.charCount} 字)`);
        if (segments.length === 0) {
          print('该章尚未解析，先运行 parse。');
          return;
        }
        formatSegments(segments, { colour }).forEach((line) => print(line));
      });
    });
}

export interface FormatOptions {
  readonly colour: boolean;
}

/** One display line per narration paragraph or spoken segment, with scene banners. Pure, for testing. */
export function formatSegments(segments: readonly SegmentView[], options: FormatOptions = { colour: false }): string[] {
  const palette = createSpeakerPalette();
  return segments.flatMap((segment, i) => {
    const previous = segments[i - 1];
    const banner = previous?.sceneIndex === segment.sceneIndex ? [] : [sceneBanner(segment, options)];
    return [...banner, ...formatSegment(segment, options, palette)];
  });
}

function sceneBanner(segment: SegmentView, options: FormatOptions): string {
  const text = `\n── 场景 ${segment.sceneIndex}${segment.sceneLocation ? `  ${segment.sceneLocation}` : ''} ──`;
  return options.colour ? dim(text) : text;
}

function formatSegment(segment: SegmentView, options: FormatOptions, palette: SpeakerPalette): string[] {
  if (segment.kind === 'narration') {
    return segment.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `${NARRATION_INDENT}${line}`);
  }
  const label = speakerLabel(segment);
  const text = segment.text.trim();
  if (!options.colour) return [`${label}：${text}`];
  const name = speakerName(segment);
  const painted =
    name === undefined
      ? colourUnknown(label)
      : segment.kind === 'thought'
        ? colourThought(label)
        : colourSpeaker(label, name, palette);
  return [`${painted}：${text}`];
}

/** The identity a colour is keyed on: the resolved entity name, else the surface, else nothing. */
function speakerName(segment: SegmentView): string | undefined {
  const name = segment.speakerName ?? segment.speakerSurface ?? undefined;
  return name === undefined || name === UNKNOWN_SPEAKER_SURFACE ? undefined : name;
}

function speakerLabel(segment: SegmentView): string {
  const name = speakerName(segment) ?? '?';
  const confidence = segment.speakerConfidence === null ? '' : ` (${segment.speakerConfidence.toFixed(1)})`;
  const emotion = segment.emotionType === null ? '' : ` [${segment.emotionType}]`;
  const kind = segment.kind === 'thought' ? ' 心声' : '';
  return `${name}${confidence}${emotion}${kind}`;
}
