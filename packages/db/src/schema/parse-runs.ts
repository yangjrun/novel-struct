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
    /** 1 for the first run of a chapter with this pass, attributor, prompt and model; one more per run. */
    attempt: integer('attempt').notNull().default(1),
    /** Process that started the run, as host:pid, so a stale run can be attributed. */
    workerId: text('worker_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    /** Refreshed while the run is in progress; a running row whose heartbeat stops is treated as interrupted. */
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('parse_runs_chapter_status_idx').on(t.chapterId, t.status)],
);
