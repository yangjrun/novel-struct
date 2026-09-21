import { index, integer, pgTable, real, text, unique } from 'drizzle-orm/pg-core';
import { entities, sourceRefs } from './entities.js';
import { segmentKindEnum } from './enums.js';
import { bookEditions, chapters } from './hierarchy.js';
import { parseRuns } from './parse-runs.js';

export const scenes = pgTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    index: integer('index').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    location: text('location'),
    timeHint: text('time_hint'),
    summary: text('summary'),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
  },
  (t) => [unique('scenes_chapter_index').on(t.chapterId, t.index)],
);

/** Ordered, gap-free segmentation of a chapter: narration or one entity's speech. */
export const segments = pgTable(
  'segments',
  {
    id: text('id').primaryKey(),
    sceneId: text('scene_id')
      .notNull()
      .references(() => scenes.id),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    index: integer('index').notNull(),
    kind: segmentKindEnum('kind').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    text: text('text').notNull(),
    speakerEntityId: text('speaker_entity_id').references(() => entities.id),
    speakerSurface: text('speaker_surface'),
    speakerConfidence: real('speaker_confidence'),
    emotionType: text('emotion_type'),
    emotionIntensity: real('emotion_intensity'),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
  },
  (t) => [
    unique('segments_chapter_index').on(t.chapterId, t.index),
    index('segments_speaker_entity_idx').on(t.speakerEntityId),
  ],
);

export const entityMentions = pgTable(
  'entity_mentions',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    sceneId: text('scene_id').references(() => scenes.id),
    sourceRefId: text('source_ref_id')
      .notNull()
      .references(() => sourceRefs.id),
    surface: text('surface').notNull(),
    confidence: real('confidence').notNull(),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
  },
  (t) => [index('entity_mentions_chapter_idx').on(t.chapterId), index('entity_mentions_entity_idx').on(t.entityId)],
);
