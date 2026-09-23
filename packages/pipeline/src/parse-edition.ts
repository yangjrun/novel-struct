import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { ChapterKind } from '@novelstruct/core';
import {
  acquireBookLock,
  type ChapterSummary,
  commitChapterIR,
  type CommitSummary,
  type Db,
  type EditionWithBook,
  finishParseRun,
  getChapterById,
  getEdition,
  heartbeatParseRun,
  inspectChapterRuns,
  listChapterSummaries,
  listKnownEntities,
  markRunInterrupted,
  type ParseRunKey,
  releaseBookLock,
  renewBookLock,
  type RunningRun,
  startParseRun,
} from '@novelstruct/db';
import { runStructurePass } from '@novelstruct/parser';
import { type AttributorChoice, type AttributorName, chooseAttributor } from './attributors.js';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';

/** Failed runs with the same key after which a chapter is skipped until `force`. */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** How often a running chapter refreshes its heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A running run silent for longer than this is treated as interrupted and may be taken over. */
export const STALE_RUN_AFTER_MS = 60_000;
/** How long a queue waits before retrying a job whose book another process is parsing. */
export const BOOK_BUSY_RETRY_MS = 30_000;

export interface ParseEditionOptions {
  readonly editionId: string;
  /** First chapter index, inclusive. Defaults to 0. */
  readonly from?: number;
  /** Last chapter index, inclusive. Defaults to the last chapter. */
  readonly to?: number;
  readonly attributor?: AttributorName;
  /** Re-run chapters that already have a matching successful run, or that hit the attempt limit. */
  readonly force?: boolean;
  /** Parse author notes and front matter too. By default they are skipped as non-story content. */
  readonly allKinds?: boolean;
  /** Skip a chapter once this many runs with the same key have failed. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Recorded on every run this process starts. Defaults to host:pid. */
  readonly workerId?: string;
  /** Required when `attributor` is `llm`. */
  readonly llm?: LlmEnv;
}

export interface ChapterRef {
  readonly id: string;
  readonly index: number;
  readonly kind: ChapterKind;
  readonly title: string | null;
}

export type ParseChapterEvent =
  | { readonly type: 'skipped'; readonly chapter: ChapterRef; readonly reason: string }
  | {
      readonly type: 'succeeded';
      readonly chapter: ChapterRef;
      readonly summary: CommitSummary;
      readonly unresolved: number;
      readonly warnings: readonly string[];
      /** Present when the attributor reported token usage (the LLM attributor does). */
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly type: 'failed'; readonly chapter: ChapterRef; readonly error: string };

export interface ParseEditionHooks {
  /** Called after each chapter; awaited, so a queue can persist progress before the next chapter starts. */
  readonly onEvent?: (event: ParseChapterEvent) => void | Promise<void>;
  /** Checked before each chapter; returning true stops the run early. */
  readonly shouldStop?: () => boolean | Promise<boolean>;
}

export interface ParseEditionResult {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  /** True when `shouldStop` ended the run before every chapter was visited. */
  readonly stopped: boolean;
  /**
   * Set when another live process holds the book's lock: nothing further was parsed and the caller
   * should retry later. The value names the holder (host:pid).
   */
  readonly blockedBy?: string;
}

export interface ParsePlan {
  readonly edition: EditionWithBook;
  readonly chapters: readonly ChapterSummary[];
  readonly choice: AttributorChoice;
  readonly runKey: ParseRunKey;
  readonly force: boolean;
  readonly allKinds: boolean;
  readonly maxAttempts: number;
  readonly workerId: string;
}

/** Identity recorded on parse runs so a stale run can be attributed to a process. */
export function defaultWorkerId(): string {
  return `${os.hostname()}:${process.pid}`;
}

/** Validates the options against the database and builds the attributor, without parsing anything. */
export async function planEditionParse(db: Db, options: ParseEditionOptions): Promise<ParsePlan> {
  const from = options.from ?? 0;
  if (
    !Number.isInteger(from) ||
    from < 0 ||
    (options.to !== undefined && (!Number.isInteger(options.to) || options.to < 0))
  ) {
    throw new PipelineError('invalid_input', '章节范围必须是非负整数');
  }
  if (options.to !== undefined && options.to < from) {
    throw new PipelineError('invalid_input', `结束章节 ${options.to} 不能小于起始章节 ${from}`);
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new PipelineError('invalid_input', `失败次数上限必须是正整数，收到 ${maxAttempts}`);
  }
  const choice = chooseAttributor(options.attributor ?? 'heuristic', options.llm);
  const edition = await getEdition(db, options.editionId);
  if (edition === undefined) throw new PipelineError('not_found', `版本 ${options.editionId} 不存在`);

  const chapters = (await listChapterSummaries(db, options.editionId)).filter(
    (c) => c.index >= from && (options.to === undefined || c.index <= options.to),
  );
  if (chapters.length === 0) throw new PipelineError('invalid_input', '指定范围内没有章节');

  return {
    edition,
    chapters,
    choice,
    force: options.force ?? false,
    allKinds: options.allKinds ?? false,
    maxAttempts,
    workerId: options.workerId ?? defaultWorkerId(),
    runKey: {
      pass: 'structure',
      attributor: choice.attributor.name,
      promptVersion: choice.attributor.promptVersion,
      ...(choice.model === undefined ? {} : { model: choice.model }),
    },
  };
}

/**
 * Runs the structure pass chapter by chapter, recording a parse run per chapter. Never throws per
 * chapter. Holds the book's lock for the whole run: two processes parsing chapters of one book
 * would create duplicate entities, so the second one is refused with `blockedBy` and should retry.
 */
export async function executeParsePlan(
  db: Db,
  plan: ParsePlan,
  hooks: ParseEditionHooks = {},
): Promise<ParseEditionResult> {
  const total = plan.chapters.length;
  const bookId = plan.edition.book.id;
  const owner = `${plan.workerId}#${randomUUID()}`;
  const lock = await acquireBookLock(db, {
    bookId,
    owner,
    workerId: plan.workerId,
    staleAfterMs: STALE_RUN_AFTER_MS,
  });
  if (!lock.acquired) {
    return { total, succeeded: 0, failed: 0, skipped: 0, stopped: true, blockedBy: lock.heldBy.workerId };
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let visited = 0;
  let lockLost = false;
  const renewal = setInterval(() => {
    renewBookLock(db, bookId, owner)
      .then((renewed) => {
        if (!renewed) lockLost = true;
      })
      .catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
  renewal.unref();

  try {
    for (const summary of plan.chapters) {
      if (lockLost || (await hooks.shouldStop?.()) === true) break;
      visited += 1;
      const event = await parseOneChapter(db, plan, summary);
      await hooks.onEvent?.(event);
      if (event.type === 'succeeded') succeeded += 1;
      else if (event.type === 'failed') failed += 1;
      else skipped += 1;
    }
  } finally {
    clearInterval(renewal);
    await releaseBookLock(db, bookId, owner).catch(() => undefined);
  }

  const stopped = visited < total;
  // A lost lock means a live process took the book over; report it like a refusal so the caller retries later.
  return lockLost
    ? { total, succeeded, failed, skipped, stopped, blockedBy: '接管了锁的进程' }
    : { total, succeeded, failed, skipped, stopped };
}

/** Convenience wrapper: plan, then execute. */
export async function parseEdition(
  db: Db,
  options: ParseEditionOptions,
  hooks: ParseEditionHooks = {},
): Promise<ParseEditionResult> {
  return executeParsePlan(db, await planEditionParse(db, options), hooks);
}

/**
 * Decides from the chapter's run history whether to parse it, then runs and records one attempt.
 * A run another live process holds is respected; a run whose heartbeat stopped is taken over.
 */
async function parseOneChapter(db: Db, plan: ParsePlan, summary: ChapterSummary): Promise<ParseChapterEvent> {
  const chapter: ChapterRef = { id: summary.id, index: summary.index, kind: summary.kind, title: summary.title };
  if (!plan.allKinds && (summary.kind === 'note' || summary.kind === 'front_matter')) {
    return { type: 'skipped', chapter, reason: '非正文（作者留言或前言）；指定 --all-kinds 可解析' };
  }
  const state = await inspectChapterRuns(db, summary.id, plan.runKey);
  if (state.running !== undefined) {
    const silentMs = Date.now() - state.running.heartbeatAt.getTime();
    if (silentMs < STALE_RUN_AFTER_MS) {
      return { type: 'skipped', chapter, reason: `正在被${describeWorker(state.running)}解析，跳过` };
    }
    await markRunInterrupted(db, state.running.id, `进程中断：心跳停止 ${Math.round(silentMs / 1000)} 秒`);
  }
  if (!plan.force) {
    if (state.succeeded) return { type: 'skipped', chapter, reason: '已有相同归属器与提示词版本的成功记录' };
    if (state.failedAttempts >= plan.maxAttempts) {
      return {
        type: 'skipped',
        chapter,
        reason: `已失败 ${state.failedAttempts} 次，达到上限 ${plan.maxAttempts}，需要 force 才会重跑`,
      };
    }
  }
  const row = await getChapterById(db, summary.id);
  if (row === undefined) return { type: 'failed', chapter, error: '章节已不存在' };

  const { edition, book } = plan.edition;
  const runId = await startParseRun(db, {
    editionId: edition.id,
    chapterId: row.id,
    ...plan.runKey,
    attempt: state.attempts + 1,
    workerId: plan.workerId,
  });
  const heartbeat = startHeartbeat(db, runId);
  try {
    const result = await runStructurePass({
      bookId: book.id,
      editionId: edition.id,
      chapterId: row.id,
      text: row.text,
      normalizerVersion: edition.normalizerVersion,
      knownEntities: await listKnownEntities(db, book.id),
      attributor: plan.choice.attributor,
      parseRunId: runId,
    });
    const summaryOut = await commitChapterIR(db, result.ir);
    const usage =
      result.usage === undefined
        ? undefined
        : { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
    await finishParseRun(db, runId, { status: 'succeeded', ...(usage === undefined ? {} : usage) });
    const unresolved = result.ir.segments.filter(
      (s) => s.kind !== 'narration' && s.speaker?.entityId === undefined,
    ).length;
    return {
      type: 'succeeded',
      chapter,
      summary: summaryOut,
      unresolved,
      warnings: result.warnings,
      ...(usage === undefined ? {} : { usage }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishParseRun(db, runId, { status: 'failed', error: message });
    return { type: 'failed', chapter, error: message };
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Keeps the run's heartbeat fresh while a slow attributor works. A failed heartbeat is not fatal:
 * the worst case is that another process treats this run as stale and takes the chapter over,
 * which the replace-on-commit semantics of `commitChapterIR` tolerate.
 */
function startHeartbeat(db: Db, runId: string): NodeJS.Timeout {
  const timer = setInterval(() => {
    heartbeatParseRun(db, runId).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return timer;
}

function describeWorker(run: RunningRun): string {
  const who = run.workerId === null ? '另一个进程' : `进程 ${run.workerId}`;
  return `${who}（${run.attributor}）`;
}
