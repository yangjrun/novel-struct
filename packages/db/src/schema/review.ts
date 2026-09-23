import { index, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { books, bookEditions, chapters } from './hierarchy.js';
import { entities } from './entities.js';

/** Auditable entity identity decisions; split records retain the original identity too. */
export const entityMerges = pgTable('entity_merges', {
  id: text('id').primaryKey(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id),
  fromEntityId: text('from_entity_id')
    .notNull()
    .references(() => entities.id),
  intoEntityId: text('into_entity_id')
    .notNull()
    .references(() => entities.id),
  kind: text('kind').notNull(), // merge | split
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reviewItems = pgTable(
  'review_items',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id').references(() => bookEditions.id),
    chapterId: text('chapter_id').references(() => chapters.id),
    kind: text('kind').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    confidence: real('confidence').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('review_items_book_status_idx').on(t.bookId, t.status)],
);
