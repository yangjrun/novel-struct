import { type ChapterKind, type EntityType, type SegmentKind, UNKNOWN_SPEAKER_SURFACE } from '@novelstruct/core';
import type { DialogueStateCounts, ReportChapter, ReportCharacter, ReportData } from './types.js';

export interface AggregateInput {
  readonly bookTitle: string;
  readonly author: string | null;
  readonly editionId: string;
  readonly editionLabel: string;
  readonly generatedAt: string;
  readonly chapters: readonly {
    readonly id: string;
    readonly index: number;
    readonly kind: ChapterKind;
    readonly number: number | null;
    readonly title: string | null;
    readonly charCount: number;
  }[];
  readonly segments: readonly {
    readonly chapterId: string;
    readonly kind: SegmentKind;
    readonly charStart: number;
    readonly charEnd: number;
    readonly speakerEntityId: string | null;
    readonly speakerSurface: string | null;
  }[];
  readonly mentions: readonly { readonly chapterId: string; readonly entityId: string; readonly count: number }[];
  readonly entities: readonly { readonly id: string; readonly type: EntityType; readonly canonicalName: string }[];
}

const KIND_LABEL: Readonly<Record<ChapterKind, string>> = {
  chapter: '正文',
  prologue: '楔子',
  extra: '番外',
  front_matter: '前言',
  note: '作者的话',
};

/** Pure aggregation of fact-layer rows into the report model. */
export function aggregateReport(input: AggregateInput): ReportData {
  const segmentsByChapter = groupBy(input.segments, (s) => s.chapterId);
  const mentionsByChapter = groupBy(input.mentions, (m) => m.chapterId);

  const chapters = [...input.chapters]
    .sort((a, b) => a.index - b.index)
    .map((c) => buildChapter(c, segmentsByChapter.get(c.id) ?? [], mentionsByChapter.get(c.id) ?? []));

  const characters = input.entities
    .filter((e) => e.type === 'character')
    .map((e): ReportCharacter => ({
      id: e.id,
      name: e.canonicalName,
      dialogueCount: sum(chapters.map((c) => c.dialogueBySpeaker[e.id] ?? 0)),
      mentionCount: sum(chapters.map((c) => c.mentionsByEntity[e.id] ?? 0)),
    }));

  return {
    bookTitle: input.bookTitle,
    author: input.author,
    editionId: input.editionId,
    editionLabel: input.editionLabel,
    generatedAt: input.generatedAt,
    chapters,
    characters,
  };
}

function buildChapter(
  chapter: AggregateInput['chapters'][number],
  segments: AggregateInput['segments'],
  mentions: AggregateInput['mentions'],
): ReportChapter {
  const spoken = segments.filter((s) => s.kind !== 'narration');
  const states = spoken.map((s) => speakerState(s.speakerEntityId, s.speakerSurface));
  const dialogue: DialogueStateCounts = {
    resolved: states.filter((s) => s === 'resolved').length,
    surfaceOnly: states.filter((s) => s === 'surfaceOnly').length,
    unknown: states.filter((s) => s === 'unknown').length,
  };

  return {
    id: chapter.id,
    index: chapter.index,
    title: chapter.title ?? (chapter.number === null ? KIND_LABEL[chapter.kind] : `第${chapter.number}章`),
    kind: chapter.kind,
    charCount: chapter.charCount,
    parsed: segments.length > 0,
    narrationChars: sum(segments.filter((s) => s.kind === 'narration').map((s) => s.charEnd - s.charStart)),
    spokenChars: sum(spoken.map((s) => s.charEnd - s.charStart)),
    dialogue,
    dialogueBySpeaker: countBy(spoken.flatMap((s) => (s.speakerEntityId === null ? [] : [s.speakerEntityId]))),
    mentionsByEntity: mentions.reduce<Record<string, number>>(
      (acc, m) => ({ ...acc, [m.entityId]: (acc[m.entityId] ?? 0) + m.count }),
      {},
    ),
  };
}

function speakerState(entityId: string | null, surface: string | null): keyof DialogueStateCounts {
  if (entityId !== null) return 'resolved';
  if (surface !== null && surface !== UNKNOWN_SPEAKER_SURFACE) return 'surfaceOnly';
  return 'unknown';
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(key(item));
    if (bucket === undefined) map.set(key(item), [item]);
    else bucket.push(item);
  }
  return map;
}

function countBy(keys: readonly string[]): Readonly<Record<string, number>> {
  return keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
