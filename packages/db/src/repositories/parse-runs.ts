import { and, desc, eq, sql } from 'drizzle-orm';
import { newId, type ParsePass } from '@novelstruct/core';
import type { Db } from '../client.js';
import { parseRuns } from '../schema/index.js';

/** What makes two runs comparable: same pass, attributor, prompt and model. */
export interface ParseRunKey {
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model?: string;
}

export interface StartParseRunInput extends ParseRunKey {
  readonly editionId: string;
  readonly chapterId: string;
  /** 1 for the first run of this chapter and key, then one more per run. */
  readonly attempt: number;
  /** Process identity, e.g. host:pid, recorded so a stale run can be attributed. */
  readonly workerId?: string;
}

export interface FinishParseRunInput {
  readonly status: 'succeeded' | 'failed';
  readonly error?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** A run still marked running, whoever started it and whatever its key. */
export interface RunningRun {
  readonly id: string;
  readonly workerId: string | null;
  readonly attributor: string;
  readonly startedAt: Date;
  /** Last liveness signal; rows from before heartbeats existed report their start time. */
  readonly heartbeatAt: Date;
}

export interface ChapterRunState {
  /** A successful run with this key exists, so the chapter's facts are current for it. */
  readonly succeeded: boolean;
  /** Runs with this key that ended in `failed`. Interrupted runs are not the chapter's fault and do not count. */
  readonly failedAttempts: number;
  /** All earlier runs with this key, whatever their outcome; the next run is attempt + 1. */
  readonly attempts: number;
  /** A run of the same pass that is still marked running, if any. The caller decides whether it is stale. */
  readonly running: RunningRun | undefined;
}

const INTERRUPTED_BY_SWEEP = '进程中断：心跳停止';

/** Everything a parser needs to decide whether, and as which attempt, to run a chapter. */
export async function inspectChapterRuns(db: Db, chapterId: string, key: ParseRunKey): Promise<ChapterRunState> {
  const rows = await db
    .select({
      id: parseRuns.id,
      status: parseRuns.status,
      attributor: parseRuns.attributor,
      promptVersion: parseRuns.promptVersion,
      model: parseRuns.model,
      workerId: parseRuns.workerId,
      startedAt: parseRuns.startedAt,
      heartbeatAt: parseRuns.heartbeatAt,
    })
    .from(parseRuns)
    .where(and(eq(parseRuns.chapterId, chapterId), eq(parseRuns.pass, key.pass)))
    .orderBy(desc(parseRuns.startedAt));

  const sameKey = rows.filter(
    (r) =>
      r.attributor === key.attributor && r.promptVersion === key.promptVersion && (r.model ?? undefined) === key.model,
  );
  const running = rows.find((r) => r.status === 'running');
  return {
    succeeded: sameKey.some((r) => r.status === 'succeeded'),
    failedAttempts: sameKey.filter((r) => r.status === 'failed').length,
    attempts: sameKey.length,
    running:
      running === undefined
        ? undefined
        : {
            id: running.id,
            workerId: running.workerId,
            attributor: running.attributor,
            startedAt: running.startedAt,
            heartbeatAt: running.heartbeatAt ?? running.startedAt,
          },
  };
}

export async function startParseRun(db: Db, input: StartParseRunInput): Promise<string> {
  const id = newId('parseRun');
  const now = new Date();
  await db.insert(parseRuns).values({
    id,
    editionId: input.editionId,
    chapterId: input.chapterId,
    pass: input.pass,
    attributor: input.attributor,
    promptVersion: input.promptVersion,
    model: input.model ?? null,
    status: 'running',
    attempt: input.attempt,
    workerId: input.workerId ?? null,
    startedAt: now,
    heartbeatAt: now,
  });
  return id;
}

/**
 * Refreshes the liveness signal of a running run. A no-op once the run has finished or been
 * interrupted. `at` exists so tests can age a heartbeat; production callers leave it out.
 */
export async function heartbeatParseRun(db: Db, runId: string, at = new Date()): Promise<void> {
  await db
    .update(parseRuns)
    .set({ heartbeatAt: at })
    .where(and(eq(parseRuns.id, runId), eq(parseRuns.status, 'running')));
}

export async function finishParseRun(db: Db, runId: string, input: FinishParseRunInput): Promise<void> {
  await db
    .update(parseRuns)
    .set({
      status: input.status,
      error: input.error ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      finishedAt: new Date(),
    })
    .where(eq(parseRuns.id, runId));
}

/** Marks a running run as interrupted. Returns false when it had already finished. */
export async function markRunInterrupted(db: Db, runId: string, reason: string): Promise<boolean> {
  const rows = await db
    .update(parseRuns)
    .set({ status: 'interrupted', error: reason, finishedAt: new Date() })
    .where(and(eq(parseRuns.id, runId), eq(parseRuns.status, 'running')))
    .returning({ id: parseRuns.id });
  return rows.length > 0;
}

/**
 * Marks every running run whose heartbeat is older than `staleAfterMs` as interrupted and returns
 * how many. With 0 every running run is swept, which is right when no other process can hold
 * the database (PGlite). Returns the ids so callers can log them.
 */
export async function sweepStaleRuns(db: Db, staleAfterMs: number, now = new Date()): Promise<readonly string[]> {
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  const rows = await db
    .update(parseRuns)
    .set({ status: 'interrupted', error: INTERRUPTED_BY_SWEEP, finishedAt: now })
    .where(
      and(
        eq(parseRuns.status, 'running'),
        sql`coalesce(${parseRuns.heartbeatAt}, ${parseRuns.startedAt}) < ${cutoff}::timestamptz`,
      ),
    )
    .returning({ id: parseRuns.id });
  return rows.map((r) => r.id);
}
