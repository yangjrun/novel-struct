import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { books } from './hierarchy.js';

/**
 * One row per book that is being parsed right now. Entity resolution reads a book's known
 * entities before each chapter, so two processes parsing chapters of the same book would create
 * duplicate entities; the lock serialises them. Acquired with an atomic upsert, renewed by
 * heartbeat, and taken over once the heartbeat goes stale.
 */
export const bookLocks = pgTable('book_locks', {
  bookId: text('book_id')
    .primaryKey()
    .references(() => books.id),
  /** Unique per holder (one parse execution), so two jobs in one process still exclude each other. */
  owner: text('owner').notNull(),
  /** host:pid of the holder, for messages. */
  workerId: text('worker_id').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
});
