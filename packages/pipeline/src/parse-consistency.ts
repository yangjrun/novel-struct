import { randomUUID } from 'node:crypto';
import {
  acquireBookLock,
  finishParseRun,
  getEdition,
  heartbeatParseRun,
  inspectChapterRuns,
  listChapterSummaries,
  markRunInterrupted,
  releaseBookLock,
  renewBookLock,
  startParseRun,
  type Db,
} from '@novelstruct/db';
import type { LlmClient } from '@novelstruct/parser';
import { CONSISTENCY_PROMPT_VERSION, runConsistencyPass } from './consistency-pass.js';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';
import { defaultWorkerId, HEARTBEAT_INTERVAL_MS, STALE_RUN_AFTER_MS } from './parse-edition.js';
import { createJevJudge, type ShadowJudge } from './shadow-review.js';
import type { ShadowEnv } from './env.js';

export interface ParseConsistencyOptions {
  readonly editionId: string;
  readonly from?: number;
  readonly to?: number;
  readonly llm: LlmEnv;
  readonly client?: LlmClient;
  readonly shadow?: ShadowEnv;
  readonly shadowJudge?: ShadowJudge;
  readonly budget?: number;
  readonly allKinds?: boolean;
  readonly onEvent?: (event: {
    chapterIndex: number;
    status: 'succeeded' | 'skipped' | 'failed';
    message: string;
  }) => void | Promise<void>;
  /** Stop before the next chapter, e.g. during a graceful shutdown. */
  readonly shouldStop?: () => boolean | Promise<boolean>;
}

/** One book lock covers the ordered consistency run; a failed chapter stops later chapters. */
export async function parseEditionConsistency(
  db: Db,
  options: ParseConsistencyOptions,
): Promise<{ succeeded: number; skipped: number; failed: number }> {
  if (
    !Number.isInteger(options.from ?? 0) ||
    (options.from ?? 0) < 0 ||
    (options.to !== undefined && (!Number.isInteger(options.to) || options.to < (options.from ?? 0)))
  )
    throw new PipelineError('invalid_input', '章节范围无效');
  if (options.budget !== undefined && (!Number.isInteger(options.budget) || options.budget <= 0))
    throw new PipelineError('invalid_input', '上下文预算必须是正整数');
  const edition = await getEdition(db, options.editionId);
  if (!edition) throw new PipelineError('not_found', '版本不存在');
  if (!options.llm.apiKey || !options.llm.model)
    throw new PipelineError('not_configured', '一致性遍需要 LLM_API_KEY 和 LLM_MODEL');
  const selected = (await listChapterSummaries(db, options.editionId)).filter(
    (chapter) => chapter.index >= (options.from ?? 0) && (options.to === undefined || chapter.index <= options.to),
  );
  if (!selected.length) throw new PipelineError('invalid_input', '范围内没有章节');
  const workerId = defaultWorkerId();
  const owner = `${workerId}#${randomUUID()}`;
  const lock = await acquireBookLock(db, {
    bookId: edition.book.id,
    owner,
    workerId,
    staleAfterMs: STALE_RUN_AFTER_MS,
  });
  if (!lock.acquired) throw new PipelineError('conflict', `书正在被 ${lock.heldBy.workerId} 解析`);
  let lockLost = false;
  const renewal = setInterval(() => {
    void renewBookLock(db, edition.book.id, owner)
      .then((ok) => {
        if (!ok) lockLost = true;
      })
      .catch(() => {
        lockLost = true;
      });
  }, HEARTBEAT_INTERVAL_MS);
  renewal.unref();
  let succeeded = 0,
    skipped = 0,
    failed = 0;
  try {
    for (const chapter of selected) {
      if (await options.shouldStop?.()) break;
      if (lockLost) throw new PipelineError('conflict', '书锁已被另一进程接管');
      if (!options.allKinds && (chapter.kind === 'note' || chapter.kind === 'front_matter')) {
        skipped += 1;
        await options.onEvent?.({
          chapterIndex: chapter.index,
          status: 'skipped',
          message: '非正文（作者留言或前言）',
        });
        continue;
      }
      const key = {
        pass: 'consistency' as const,
        attributor: 'llm',
        promptVersion: CONSISTENCY_PROMPT_VERSION,
        model: options.llm.model,
      };
      const state = await inspectChapterRuns(db, chapter.id, key);
      if (state.running) {
        const silentMs = Date.now() - state.running.heartbeatAt.getTime();
        if (silentMs < STALE_RUN_AFTER_MS) throw new PipelineError('conflict', `章节 ${chapter.index} 正在解析`);
        await markRunInterrupted(db, state.running.id, '一致性遍进程心跳中断');
      }
      if (state.succeeded) {
        skipped += 1;
        await options.onEvent?.({ chapterIndex: chapter.index, status: 'skipped', message: '已有成功的一致性遍' });
        continue;
      }
      if (state.failedAttempts >= 3)
        throw new PipelineError('conflict', `章节 ${chapter.index} 已失败 3 次，须修正原文或解析器后再运行`);
      const runId = await startParseRun(db, {
        ...key,
        editionId: options.editionId,
        chapterId: chapter.id,
        attempt: state.attempts + 1,
        workerId,
      });
      const heartbeat = setInterval(() => {
        void heartbeatParseRun(db, runId).catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      try {
        const result = await runConsistencyPass(db, {
          chapterId: chapter.id,
          llm: options.llm,
          parseRunId: runId,
          ...(options.client ? { client: options.client } : {}),
          ...(options.shadowJudge
            ? { shadowJudge: options.shadowJudge }
            : options.shadow
              ? { shadowJudge: createJevJudge(options.shadow) }
              : {}),
          ...(options.budget ? { budget: options.budget } : {}),
          onUsage: (value) => {
            usage = value;
          },
        });
        succeeded += 1;
        await options.onEvent?.({
          chapterIndex: chapter.index,
          status: 'succeeded',
          message: `${result.facts} 条事实${result.shadowError ? `；Jev 影子复核失败：${result.shadowError}` : ''}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The fact transaction also marks the run succeeded. Once committed, a later
        // notification failure must not turn a successful run into a failed one.
        const current = await inspectChapterRuns(db, chapter.id, key);
        if (current.succeeded) throw error;
        await finishParseRun(db, runId, { status: 'failed', error: message, ...(usage ?? {}) });
        failed += 1;
        await options.onEvent?.({ chapterIndex: chapter.index, status: 'failed', message });
        break;
      } finally {
        clearInterval(heartbeat);
      }
    }
  } finally {
    clearInterval(renewal);
    await releaseBookLock(db, edition.book.id, owner);
  }
  return { succeeded, skipped, failed };
}
