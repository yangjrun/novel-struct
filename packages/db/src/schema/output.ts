import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { books } from './hierarchy.js';
import { entities } from './entities.js';

/** Voice selection is book-scoped; resolved character IDs map to one provider voice. */
export const voiceProfiles = pgTable(
  'voice_profiles',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => entities.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    provider: text('provider').notNull(),
    voiceId: text('voice_id').notNull(),
    params: text('params'), // JSON provider-specific options, never interpreted by the IR
  },
  (t) => [index('voice_profiles_book_idx').on(t.bookId)],
);
