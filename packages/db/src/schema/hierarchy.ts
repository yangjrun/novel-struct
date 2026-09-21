import { boolean, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt } from './columns.js';
import { chapterKindEnum } from './enums.js';

export const libraries = pgTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const universes = pgTable('universes', {
  id: text('id').primaryKey(),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
});

export const series = pgTable('series', {
  id: text('id').primaryKey(),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id),
  universeId: text('universe_id').references(() => universes.id),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const books = pgTable('books', {
  id: text('id').primaryKey(),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id),
  universeId: text('universe_id').references(() => universes.id),
  seriesId: text('series_id').references(() => series.id),
  seriesIndex: integer('series_index'),
  title: text('title').notNull(),
  author: text('author'),
  createdAt: createdAt(),
});

export const bookEditions = pgTable('book_editions', {
  id: text('id').primaryKey(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id),
  label: text('label').notNull(),
  sourceFormat: text('source_format').notNull(),
  sourceFilename: text('source_filename'),
  sourceHash: text('source_hash').notNull(),
  sourceEncoding: text('source_encoding').notNull(),
  normalizerVersion: text('normalizer_version').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});

export const volumes = pgTable(
  'volumes',
  {
    id: text('id').primaryKey(),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    index: integer('index').notNull(),
    number: integer('number'),
    title: text('title'),
    headingRaw: text('heading_raw').notNull(),
  },
  (t) => [unique('volumes_edition_index').on(t.editionId, t.index)],
);

export const chapters = pgTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    volumeId: text('volume_id').references(() => volumes.id),
    index: integer('index').notNull(),
    kind: chapterKindEnum('kind').notNull(),
    number: integer('number'),
    headingRaw: text('heading_raw'),
    title: text('title'),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('chapters_edition_index').on(t.editionId, t.index)],
);
