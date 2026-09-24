import { index, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { chapters } from './hierarchy.js';

/** Independent, read-only-to-the-facts assessments. Never used to change an IR or a fact. */
export const shadowReviews = pgTable(
  'shadow_reviews',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    pass: text('pass').notNull(),
    itemKey: text('item_key').notNull(),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    source: text('source'),
    claim: text('claim'),
    label: text('label'),
    confidence: real('confidence'),
    model: text('model').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shadow_reviews_chapter_pass_idx').on(t.chapterId, t.pass)],
);
