import { getChapterById, getEdition, listChapterSegments, listVoiceProfiles, type Db } from '@novelstruct/db';
import type { ChapterIR } from '@novelstruct/core';

export interface TtsTask {
  readonly id: string;
  readonly chapterId: string;
  readonly segmentIndex: number;
  readonly sceneIndex: number;
  readonly kind: 'narration' | 'dialogue' | 'thought';
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly speakerEntityId: string | null;
  readonly speakerSurface: string | null;
  readonly voice: {
    readonly provider: string;
    readonly voiceId: string;
    readonly params: Record<string, string | number | boolean>;
  } | null;
  readonly emotion: string | null;
}

export interface TtsTaskOptions {
  readonly narratorVoice?: { provider: string; voiceId: string };
  readonly unknownSpeakerVoice?: { provider: string; voiceId: string };
}

/** Each IR segment becomes exactly one task. Offsets always reference the original normalized text. */
export function tasksFromIR(
  ir: ChapterIR,
  text: string,
  voices: ReadonlyMap<string, TtsTask['voice']>,
  options: TtsTaskOptions = {},
): TtsTask[] {
  if (ir.charCount !== text.length) throw new Error('IR 长度与章节原文不匹配');
  const sceneIndex = new Map(ir.scenes.map((s) => [s.id, s.index] as const));
  return [...ir.segments]
    .sort((a, b) => a.index - b.index)
    .map((segment) => {
      if (segment.charStart < 0 || segment.charEnd > text.length || !sceneIndex.has(segment.sceneId))
        throw new Error('IR 分段或场景偏移无效');
      const selected =
        segment.kind === 'narration'
          ? (options.narratorVoice ?? null)
          : ((segment.speaker?.entityId ? voices.get(segment.speaker.entityId) : null) ??
            options.unknownSpeakerVoice ??
            null);
      return {
        id: `${ir.chapterId}:${segment.index}`,
        chapterId: ir.chapterId,
        segmentIndex: segment.index,
        sceneIndex: sceneIndex.get(segment.sceneId)!,
        kind: segment.kind,
        text: text.slice(segment.charStart, segment.charEnd),
        charStart: segment.charStart,
        charEnd: segment.charEnd,
        speakerEntityId: segment.speaker?.entityId ?? null,
        speakerSurface: segment.speaker?.surface ?? null,
        voice: selected ? { ...selected, params: 'params' in selected ? selected.params : {} } : null,
        emotion: segment.emotion?.type ?? null,
      };
    });
}

/** Reconstructs task input from persisted structure results; no TTS provider is invoked. */
export async function buildChapterTtsTasks(
  db: Db,
  chapterId: string,
  bookId: string,
  options: TtsTaskOptions = {},
): Promise<TtsTask[]> {
  const chapter = await getChapterById(db, chapterId);
  if (!chapter) throw new Error(`章节 ${chapterId} 不存在`);
  const edition = await getEdition(db, chapter.editionId);
  if (edition?.book.id !== bookId) throw new Error('章节不属于指定书籍');
  const [segments, profiles] = await Promise.all([listChapterSegments(db, chapterId), listVoiceProfiles(db, bookId)]);
  if (!segments.length) return [];
  const voices = new Map(
    profiles.map(
      (p) =>
        [
          p.entityId,
          {
            provider: p.provider,
            voiceId: p.voiceId,
            params: p.params ? (JSON.parse(p.params) as Record<string, string | number | boolean>) : {},
          },
        ] as const,
    ),
  );
  return segments.map((segment) => ({
    id: `${chapterId}:${segment.index}`,
    chapterId,
    segmentIndex: segment.index,
    sceneIndex: segment.sceneIndex,
    kind: segment.kind,
    text: segment.text,
    charStart: segment.charStart,
    charEnd: segment.charEnd,
    speakerEntityId: segment.speakerEntityId,
    speakerSurface: segment.speakerSurface,
    voice:
      segment.kind === 'narration'
        ? options.narratorVoice
          ? { ...options.narratorVoice, params: {} }
          : null
        : segment.speakerEntityId && voices.has(segment.speakerEntityId)
          ? voices.get(segment.speakerEntityId)!
          : options.unknownSpeakerVoice
            ? { ...options.unknownSpeakerVoice, params: {} }
            : null,
    emotion: segment.emotionType,
  }));
}
