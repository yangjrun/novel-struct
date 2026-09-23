import { type AnyPgColumn, index, integer, pgTable, real, text } from 'drizzle-orm/pg-core';
import { entities, sourceRefs } from './entities.js';
import { bookEditions, books, chapters } from './hierarchy.js';
import { parseRuns } from './parse-runs.js';
import { scenes } from './structure.js';

/** Fact history is append-only: superseded rows retain their original evidence. */
export const relationships = pgTable(
  'relationships',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    subjectId: text('subject_id')
      .notNull()
      .references(() => entities.id),
    predicate: text('predicate').notNull(),
    objectId: text('object_id')
      .notNull()
      .references(() => entities.id),
    validFromChapterId: text('valid_from_chapter_id')
      .notNull()
      .references(() => chapters.id),
    validToChapterId: text('valid_to_chapter_id').references(() => chapters.id),
    storyTime: text('story_time'),
    confidence: real('confidence').notNull(),
    sourceRefId: text('source_ref_id')
      .notNull()
      .references(() => sourceRefs.id),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
    supersededBy: text('superseded_by').references((): AnyPgColumn => relationships.id),
  },
  (t) => [index('relationships_subject_active_idx').on(t.editionId, t.subjectId, t.validToChapterId)],
);

export const stateFacts = pgTable(
  'state_facts',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id),
    field: text('field').notNull(),
    value: text('value').notNull(),
    validFromChapterId: text('valid_from_chapter_id')
      .notNull()
      .references(() => chapters.id),
    validToChapterId: text('valid_to_chapter_id').references(() => chapters.id),
    storyTime: text('story_time'),
    confidence: real('confidence').notNull(),
    sourceRefId: text('source_ref_id')
      .notNull()
      .references(() => sourceRefs.id),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
    supersededBy: text('superseded_by').references((): AnyPgColumn => stateFacts.id),
  },
  (t) => [index('state_facts_entity_active_idx').on(t.editionId, t.entityId, t.validToChapterId)],
);

export const stateChanges = pgTable('state_changes', {
  id: text('id').primaryKey(),
  entityId: text('entity_id')
    .notNull()
    .references(() => entities.id),
  field: text('field').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value').notNull(),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => chapters.id),
  sceneId: text('scene_id').references(() => scenes.id),
  sourceRefId: text('source_ref_id')
    .notNull()
    .references(() => sourceRefs.id),
});

export const storyEvents = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    sceneId: text('scene_id').references(() => scenes.id),
    type: text('type').notNull(),
    actorId: text('actor_id').references(() => entities.id),
    targetId: text('target_id').references(() => entities.id),
    summary: text('summary').notNull(),
    storyTime: text('story_time'),
    sourceRefId: text('source_ref_id')
      .notNull()
      .references(() => sourceRefs.id),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
  },
  (t) => [index('events_chapter_idx').on(t.chapterId)],
);

export const foreshadows = pgTable(
  'foreshadows',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    plantedChapterId: text('planted_chapter_id')
      .notNull()
      .references(() => chapters.id),
    resolvedChapterId: text('resolved_chapter_id').references(() => chapters.id),
    summary: text('summary').notNull(),
    sourceRefId: text('source_ref_id')
      .notNull()
      .references(() => sourceRefs.id),
    parseRunId: text('parse_run_id').references(() => parseRuns.id),
  },
  (t) => [index('foreshadows_book_unresolved_idx').on(t.editionId, t.resolvedChapterId)],
);
