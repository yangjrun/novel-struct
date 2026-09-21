import type { ChapterKind } from '@novelstruct/core';
import {
  type ChapterSummary,
  commitChapterIR,
  type CommitSummary,
  type Db,
  type EditionWithBook,
  finishParseRun,
  getChapterById,
  getEdition,
  hasSucceededRun,
  listChapterSummaries,
  listKnownEntities,
  type ParseRunKey,
  startParseRun,
} from '@novelstruct/db';
import { runStructurePass } from '@novelstruct/parser';
import { type AttributorChoice, type AttributorName, chooseAttributor } from './attributors.js';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';

export interface ParseEditionOptions {
  readonly editionId: string;
  /** First chapter index, inclusive. Defaults to 0. */
  readonly from?: number;
  /** Last chapter index, inclusive. Defaults to the last chapter. */
  readonly to?: number;
  readonly attributor?: AttributorName;
  /** Re-run chapters that already have a matching successful run. */
  readonly force?: boolean;
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
    }
  | { readonly type: 'failed'; readonly chapter: ChapterRef; readonly error: string };

export interface ParseEditionHooks {
  readonly onEvent?: (event: ParseChapterEvent) => void;
  /** Checked before each chapter; returning true stops the run early. */
  readonly shouldStop?: () => boolean;
}

export interface ParseEditionResult {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  /** True when `shouldStop` ended the run before every chapter was visited. */
  readonly stopped: boolean;
}

export interface ParsePlan {
  readonly edition: EditionWithBook;
  readonly chapters: readonly ChapterSummary[];
  readonly choice: AttributorChoice;
  readonly runKey: ParseRunKey;
  readonly force: boolean;
}

/** Validates the options against the database and builds the attributor, without parsing anything. */
export async function planEditionParse(db: Db, options: ParseEditionOptions): Promise<ParsePlan> {
  const from = options.from ?? 0;
  if (options.to !== undefined && options.to < from) {
    throw new PipelineError('invalid_input', `结束章节 ${options.to} 不能小于起始章节 ${from}`);
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
    runKey: {
      pass: 'structure',
      attributor: choice.attributor.name,
      promptVersion: choice.attributor.promptVersion,
      ...(choice.model === undefined ? {} : { model: choice.model }),
    },
  };
}

/** Runs the structure pass chapter by chapter, recording a parse run per chapter. Never throws per chapter. */
export async function executeParsePlan(
  db: Db,
  plan: ParsePlan,
  hooks: ParseEditionHooks = {},
): Promise<ParseEditionResult> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let visited = 0;

  for (const summary of plan.chapters) {
    if (hooks.shouldStop?.() === true) break;
    visited += 1;
    const event = await parseOneChapter(db, plan, summary);
    hooks.onEvent?.(event);
    if (event.type === 'succeeded') succeeded += 1;
    else if (event.type === 'failed') failed += 1;
    else skipped += 1;
  }

  return { total: plan.chapters.length, succeeded, failed, skipped, stopped: visited < plan.chapters.length };
}

/** Convenience wrapper: plan, then execute. */
export async function parseEdition(
  db: Db,
  options: ParseEditionOptions,
  hooks: ParseEditionHooks = {},
): Promise<ParseEditionResult> {
  return executeParsePlan(db, await planEditionParse(db, options), hooks);
}

async function parseOneChapter(db: Db, plan: ParsePlan, summary: ChapterSummary): Promise<ParseChapterEvent> {
  const chapter: ChapterRef = { id: summary.id, index: summary.index, kind: summary.kind, title: summary.title };
  if (!plan.force && (await hasSucceededRun(db, summary.id, plan.runKey))) {
    return { type: 'skipped', chapter, reason: '已有相同归属器与提示词版本的成功记录' };
  }
  const row = await getChapterById(db, summary.id);
  if (row === undefined) return { type: 'failed', chapter, error: '章节已不存在' };

  const { edition, book } = plan.edition;
  const runId = await startParseRun(db, { editionId: edition.id, chapterId: row.id, ...plan.runKey });
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
    await finishParseRun(db, runId, {
      status: 'succeeded',
      ...(result.usage === undefined
        ? {}
        : { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }),
    });
    const unresolved = result.ir.segments.filter(
      (s) => s.kind !== 'narration' && s.speaker?.entityId === undefined,
    ).length;
    return { type: 'succeeded', chapter, summary: summaryOut, unresolved, warnings: result.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishParseRun(db, runId, { status: 'failed', error: message });
    return { type: 'failed', chapter, error: message };
  }
}
