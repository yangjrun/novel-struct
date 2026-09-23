import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { books, bookEditions, chapters } from './hierarchy.js';
import { entities } from './entities.js';

/** Derived snapshot: drop all rows and rebuild solely from the current fact layer. */
export const memoryItems = pgTable(
  'memory_items',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    room: text('room').notNull(),
    entityId: text('entity_id').references(() => entities.id),
    content: text('content').notNull(),
    validFromChapterId: text('valid_from_chapter_id')
      .notNull()
      .references(() => chapters.id),
    validToChapterId: text('valid_to_chapter_id').references(() => chapters.id),
    sourceFactTable: text('source_fact_table').notNull(),
    sourceFactId: text('source_fact_id').notNull(),
  },
  (t) => [index('memory_items_book_room_idx').on(t.bookId, t.editionId, t.room)],
);
