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
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

/** Every parse run of an edition, newest first. */
export async function listEditionParseRuns(db: Db, editionId: string): Promise<ParseRunView[]> {
  return db
    .select({
      id: parseRuns.id,
      chapterId: parseRuns.chapterId,
      pass: parseRuns.pass,
      attributor: parseRuns.attributor,
      promptVersion: parseRuns.promptVersion,
      model: parseRuns.model,
      status: parseRuns.status,
      inputTokens: parseRuns.inputTokens,
      outputTokens: parseRuns.outputTokens,
      error: parseRuns.error,
      startedAt: parseRuns.startedAt,
      finishedAt: parseRuns.finishedAt,
    })
    .from(parseRuns)
    .where(eq(parseRuns.editionId, editionId))
    .orderBy(desc(parseRuns.startedAt));
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
