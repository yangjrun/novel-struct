import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { parsePassEnum, parseRunStatusEnum } from './enums.js';
import { bookEditions, chapters } from './hierarchy.js';

export const parseRuns = pgTable(
  'parse_runs',
  {
    id: text('id').primaryKey(),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    pass: parsePassEnum('pass').notNull(),
    attributor: text('attributor').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model'),
    status: parseRunStatusEnum('status').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('parse_runs_chapter_status_idx').on(t.chapterId, t.status)],
);
