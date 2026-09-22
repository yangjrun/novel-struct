import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { bookEditions, books, parseRuns } from '../schema/index.js';

/** Token totals of one edition under one attributor and model, across every run ever recorded. */
export interface UsageRow {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly editionId: string;
  readonly editionLabel: string;
  readonly attributor: string;
  readonly model: string | null;
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Distinct chapters that have at least one run in this group. */
  readonly chapters: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly lastRunAt: Date | null;
}

export interface UsageFilter {
  readonly editionId?: string;
}

/**
 * Sums `parse_runs` token counts per edition, attributor and model. Failed and interrupted runs
 * are included: their tokens were spent too. Heuristic runs appear with zero tokens and no model.
 */
export async function summarizeUsage(db: Db, filter: UsageFilter = {}): Promise<UsageRow[]> {
  const rows = await db
    .select({
      bookId: books.id,
      bookTitle: books.title,
      editionId: bookEditions.id,
      editionLabel: bookEditions.label,
      attributor: parseRuns.attributor,
      model: parseRuns.model,
      runs: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`sum(case when ${parseRuns.status} = 'succeeded' then 1 else 0 end)`.mapWith(Number),
      failed: sql<number>`sum(case when ${parseRuns.status} = 'failed' then 1 else 0 end)`.mapWith(Number),
      chapters: sql<number>`count(distinct ${parseRuns.chapterId})`.mapWith(Number),
      inputTokens: sql<number>`coalesce(sum(${parseRuns.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${parseRuns.outputTokens}), 0)`.mapWith(Number),
      lastRunAt: sql<Date | null>`max(${parseRuns.startedAt})`.mapWith(parseRuns.startedAt),
    })
    .from(parseRuns)
    .innerJoin(bookEditions, eq(bookEditions.id, parseRuns.editionId))
    .innerJoin(books, eq(books.id, bookEditions.bookId))
    .where(filter.editionId === undefined ? undefined : eq(parseRuns.editionId, filter.editionId))
    .groupBy(
      books.id,
      books.title,
      books.createdAt,
      bookEditions.id,
      bookEditions.label,
      bookEditions.createdAt,
      parseRuns.attributor,
      parseRuns.model,
    )
    .orderBy(books.createdAt, bookEditions.createdAt, parseRuns.attributor, parseRuns.model);
  return rows;
}
