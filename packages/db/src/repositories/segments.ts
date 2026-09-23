import { asc, eq } from 'drizzle-orm';
import type { SegmentKind } from '@novelstruct/core';
import type { Db } from '../client.js';
import { entities, scenes, segments } from '../schema/index.js';

export interface SegmentView {
  readonly index: number;
  readonly kind: SegmentKind;
  readonly sceneIndex: number;
  readonly sceneLocation: string | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
  readonly speakerName: string | null;
  readonly speakerEntityId: string | null;
  readonly speakerSurface: string | null;
  readonly speakerConfidence: number | null;
  readonly emotionType: string | null;
}

export async function listChapterSegments(db: Db, chapterId: string): Promise<SegmentView[]> {
  return db
    .select({
      index: segments.index,
      kind: segments.kind,
      sceneIndex: scenes.index,
      sceneLocation: scenes.location,
      charStart: segments.charStart,
      charEnd: segments.charEnd,
      text: segments.text,
      speakerName: entities.canonicalName,
      speakerEntityId: segments.speakerEntityId,
      speakerSurface: segments.speakerSurface,
      speakerConfidence: segments.speakerConfidence,
      emotionType: segments.emotionType,
    })
    .from(segments)
    .innerJoin(scenes, eq(scenes.id, segments.sceneId))
    .leftJoin(entities, eq(entities.id, segments.speakerEntityId))
    .where(eq(segments.chapterId, chapterId))
    .orderBy(asc(segments.index));
}
