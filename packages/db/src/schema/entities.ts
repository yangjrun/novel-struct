import { type AnyPgColumn, index, integer, pgTable, real, text, unique } from 'drizzle-orm/pg-core';
import { createdAt } from './columns.js';
import { entityStatusEnum, entityTypeEnum } from './enums.js';
import { bookEditions, books, chapters } from './hierarchy.js';

export const entities = pgTable(
  'entities',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    type: entityTypeEnum('type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    description: text('description'),
    confidence: real('confidence').notNull(),
    status: entityStatusEnum('status').notNull().default('active'),
    mergedIntoId: text('merged_into_id').references((): AnyPgColumn => entities.id),
    firstChapterId: text('first_chapter_id').references(() => chapters.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('entities_book_type_name').on(t.bookId, t.type, t.canonicalName),
    index('entities_book_status_idx').on(t.bookId, t.status),
  ],
);

/** Evidence: a span of a normalized chapter plus a copy of the text it covers. */
export const sourceRefs = pgTable(
  'source_refs',
  {
    id: text('id').primaryKey(),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    quote: text('quote').notNull(),
    weknoraChunkId: text('weknora_chunk_id'),
  },
  (t) => [index('source_refs_chapter_idx').on(t.chapterId)],
);

export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id),
    alias: text('alias').notNull(),
    validFromChapterId: text('valid_from_chapter_id').references(() => chapters.id),
    validToChapterId: text('valid_to_chapter_id').references(() => chapters.id),
    sourceRefId: text('source_ref_id').references(() => sourceRefs.id),
  },
  (t) => [unique('entity_aliases_entity_alias').on(t.entityId, t.alias)],
);
