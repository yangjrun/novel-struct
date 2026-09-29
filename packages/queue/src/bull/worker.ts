import { DelayedError, Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { BOOK_BUSY_RETRY_MS, executeParsePlan, planEditionParse } from '@novelstruct/pipeline';
import type { JobEventDto } from '../contracts.js';
import { DEFAULT_QUEUE_CONCURRENCY } from '../env.js';
import { countEvents, nextChapterIndex, toEventDto } from '../status.js';
import type { QueueDeps } from '../types.js';
import {
  PARSE_QUEUE,
  type ParseJob,
  type ParseJobData,
  ParseJobDataSchema,
  type ParseJobName,
  type ParseJobReturn,
  readEvents,
} from './job-data.js';

export interface ParseWorkerOptions {
  readonly deps: QueueDeps;
  readonly connection: IORedis;
  readonly prefix: string;
  /** Jobs processed at once by this worker; each holds its book's lock, so books never interleave. */
  readonly concurrency?: number;
}

/**
 * Lock renewal period for an active job. Chapters parsed by an LLM take minutes, and the worker
 * renews the lock on a timer while it waits, so this only bounds how fast a crashed worker's
 * job is noticed and handed to another worker.
 */
const LOCK_DURATION_MS = 60_000;

/**
 * Runs parse jobs from Redis. Every job holds its book's lock in the database while it runs, so
 * several workers, or several jobs in one worker, can parse different books at the same time;
 * a job whose book is busy is parked and retried after `bookBusyRetryMs`.
 *
 * Progress is written after every chapter; a job that is cancelled, resumed after a shutdown,
 * parked or re-queued after a crash continues from the chapter after its last recorded event.
 */
export class ParseWorker {
  private readonly worker: Worker<ParseJobData, ParseJobReturn, ParseJobName>;
  private readonly queue: Queue<ParseJobData, ParseJobReturn, ParseJobName>;
  private stopping = false;

  constructor(private readonly options: ParseWorkerOptions) {
    const { connection, prefix } = options;
    this.queue = new Queue(PARSE_QUEUE, { connection, prefix });
    this.worker = new Worker(PARSE_QUEUE, (job, token) => this.process(job, token), {
      connection,
      prefix,
      concurrency: options.concurrency ?? DEFAULT_QUEUE_CONCURRENCY,
      lockDuration: LOCK_DURATION_MS,
    });
    this.worker.on('failed', (job, error) => {
      options.deps.logger.error(`解析任务 ${job?.id ?? '?'} 失败`, error);
    });
    this.worker.on('error', (error) => options.deps.logger.error('队列 worker 出错', error));
  }

  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady();
  }

  /** Finishes the current chapter, parks the interrupted job for the next worker, then disconnects. */
  async close(): Promise<void> {
    this.stopping = true;
    await this.worker.close();
    await this.queue.close();
  }

  private async process(job: ParseJob, token: string | undefined): Promise<ParseJobReturn> {
    const { db, llm, shadow, logger } = this.options.deps;
    const data = ParseJobDataSchema.parse(job.data);
    let events: readonly JobEventDto[] = readEvents(job.progress);
    if (data.cancelRequestedAt !== null) return { ...countEvents(events, true), cancelled: true };
    if (events.length >= data.total) return { ...countEvents(events, false), cancelled: false };

    const from = nextChapterIndex(events, data.options.from);
    const plan = await planEditionParse(db, {
      ...(this.options.deps.retrieval ? { retrieval: this.options.deps.retrieval } : {}),
      editionId: data.editionId,
      from,
      ...(data.options.to === null ? {} : { to: data.options.to }),
      attributor: data.options.attributor,
      force: data.options.force,
      allKinds: data.options.allKinds,
      maxAttempts: data.options.maxAttempts,
      ...(llm === undefined ? {} : { llm }),
      ...(shadow === undefined ? {} : { shadow }),
    });
    if (events.length > 0) logger.info(`任务 ${job.id ?? '?'} 从第 ${from} 章继续`);

    let cancelled = false;
    const result = await executeParsePlan(db, plan, {
      onEvent: async (event) => {
        events = [...events, toEventDto(event)];
        await job.updateProgress({ events });
      },
      shouldStop: async () => {
        if (this.stopping) return true;
        cancelled = await this.isCancelRequested(job.id);
        return cancelled;
      },
    });

    if (result.blockedBy !== undefined && !cancelled) {
      const retryMs = this.options.deps.bookBusyRetryMs ?? BOOK_BUSY_RETRY_MS;
      logger.info(
        `任务 ${job.id ?? '?'} 等待：这本书正在被 ${result.blockedBy} 解析，${Math.round(retryMs / 1000)} 秒后重试`,
      );
      await job.moveToDelayed(Date.now() + retryMs, token);
      throw new DelayedError();
    }
    if (result.stopped && !cancelled && this.stopping) {
      logger.info(`任务 ${job.id ?? '?'} 因关闭暂停，已处理 ${events.length}/${data.total} 章，下次启动继续`);
      await job.moveToDelayed(Date.now(), token);
      throw new DelayedError();
    }
    return { ...countEvents(events, result.stopped), cancelled };
  }

  private async isCancelRequested(jobId: string | undefined): Promise<boolean> {
    if (jobId === undefined) return false;
    const fresh = await Job.fromId(this.queue, jobId);
    if (fresh === undefined) return true;
    return ParseJobDataSchema.parse(fresh.data).cancelRequestedAt !== null;
  }
}
