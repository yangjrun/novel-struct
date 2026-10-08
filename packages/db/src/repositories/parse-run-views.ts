import { desc, eq } from 'drizzle-orm';
import type { ParsePass, ParseRunStatus } from '@novelstruct/core';
import type { Db } from '../client.js';
import { parseRuns } from '../schema/index.js';

export interface ParseRunView {
  readonly id: string;
  readonly chapterId: string;
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model: string | null;
  readonly status: ParseRunStatus;
  readonly attempt: number;
  readonly workerId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
  readonly startedAt: Date;
  readonly heartbeatAt: Date | null;
  readonly finishedAt: Date | null;
}

const parseRunSelection = {
  id: parseRuns.id,
  chapterId: parseRuns.chapterId,
  pass: parseRuns.pass,
  attributor: parseRuns.attributor,
  promptVersion: parseRuns.promptVersion,
  model: parseRuns.model,
  status: parseRuns.status,
  attempt: parseRuns.attempt,
  workerId: parseRuns.workerId,
  inputTokens: parseRuns.inputTokens,
  outputTokens: parseRuns.outputTokens,
  error: parseRuns.error,
  startedAt: parseRuns.startedAt,
  heartbeatAt: parseRuns.heartbeatAt,
  finishedAt: parseRuns.finishedAt,
} as const;

/** Every parse run of an edition, newest first. */
export async function listEditionParseRuns(db: Db, editionId: string): Promise<ParseRunView[]> {
  return db
    .select(parseRunSelection)
    .from(parseRuns)
    .where(eq(parseRuns.editionId, editionId))
    .orderBy(desc(parseRuns.startedAt));
}

/**
 * One latest run per chapter across all passes and statuses; unparsed chapters have no row.
 * Equal start times use descending id as a stable tie-breaker, not as creation-time ordering.
 */
export async function listLatestEditionParseRuns(db: Db, editionId: string): Promise<ParseRunView[]> {
  return db
    .selectDistinctOn([parseRuns.chapterId], parseRunSelection)
    .from(parseRuns)
    .where(eq(parseRuns.editionId, editionId))
    .orderBy(parseRuns.chapterId, desc(parseRuns.startedAt), desc(parseRuns.id));
}

/** The most recent run per chapter, so a chapter list can show its current parse state in one pass. */
export function latestRunByChapter(runs: readonly ParseRunView[]): ReadonlyMap<string, ParseRunView> {
  const latest = new Map<string, ParseRunView>();
  for (const run of runs) {
    const current = latest.get(run.chapterId);
    if (current === undefined || run.startedAt > current.startedAt) latest.set(run.chapterId, run);
  }
  return latest;
}
