import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { planEditionParse } from '@novelstruct/pipeline';
import type { JobDto } from '../contracts.js';
import { DEFAULT_KEEP_FINISHED, type JobQueue, type ParseJobOptions, type QueueDeps } from '../types.js';
import { createRedisConnection } from './connection.js';
import {
  PARSE_QUEUE,
  type ParseJob,
  type ParseJobData,
  ParseJobDataSchema,
  type ParseJobName,
  type ParseJobReturn,
  toJobDto,
} from './job-data.js';
import { ParseWorker } from './worker.js';

export interface BullQueueOptions extends QueueDeps {
  readonly redisUrl: string;
  readonly prefix: string;
  /** Also run a worker in this process. Turn off when dedicated `pnpm worker` processes exist. */
  readonly inlineWorker: boolean;
}

/** States whose jobs still wait for a worker. */
const PENDING_STATES = ['waiting', 'delayed', 'prioritized', 'waiting-children'] as const;
const FINAL_STATES: ReadonlySet<string> = new Set(['completed', 'failed']);

/**
 * Parse jobs on BullMQ. Jobs, their per-chapter progress and their results live in Redis, so they
 * survive API restarts and can be processed by a worker in another process. Cancellation is a
 * flag on the job data that the worker reads between chapters.
 */
export class BullJobQueue implements JobQueue {
  readonly kind = 'bullmq';
  private readonly connection: IORedis;
  private readonly queue: Queue<ParseJobData, ParseJobReturn, ParseJobName>;
  private readonly worker: ParseWorker | undefined;

  constructor(private readonly options: BullQueueOptions) {
    this.connection = createRedisConnection(options.redisUrl);
    this.queue = new Queue(PARSE_QUEUE, { connection: this.connection, prefix: options.prefix });
    this.worker = options.inlineWorker
      ? new ParseWorker({ deps: options, connection: this.connection, prefix: options.prefix })
      : undefined;
  }

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady();
    await this.worker?.waitUntilReady();
  }

  async enqueue(editionId: string, options: ParseJobOptions): Promise<JobDto> {
    const plan = await planEditionParse(this.options.db, {
      editionId,
      from: options.from,
      ...(options.to === null ? {} : { to: options.to }),
      attributor: options.attributor,
      force: options.force,
      maxAttempts: options.maxAttempts,
      ...(this.options.llm === undefined ? {} : { llm: this.options.llm }),
    });
    const data: ParseJobData = { editionId, options, total: plan.chapters.length, cancelRequestedAt: null };
    const keep = this.options.keepFinished ?? DEFAULT_KEEP_FINISHED;
    const job = await this.queue.add('parse', data, {
      jobId: `job_${randomUUID()}`,
      attempts: 1,
      removeOnComplete: { count: keep },
      removeOnFail: { count: keep },
    });
    return toJobDto(job, 'waiting');
  }

  async list(): Promise<readonly JobDto[]> {
    const groups = await Promise.all([
      this.withState('active', this.queue.getActive()),
      this.withState('waiting', this.queue.getWaiting()),
      this.withState('delayed', this.queue.getDelayed()),
      this.withState('prioritized', this.queue.getPrioritized()),
      this.withState('completed', this.queue.getCompleted()),
      this.withState('failed', this.queue.getFailed()),
    ]);
    return groups.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<JobDto | undefined> {
    const job = await this.queue.getJob(id);
    if (job === undefined) return undefined;
    const state = await job.getState();
    // The hash and the state are two round-trips; a job that finished between them has a final
    // state but no return value yet. Re-read the hash so the DTO carries the result.
    if (FINAL_STATES.has(state) && job.finishedOn === undefined) {
      const finished = await this.queue.getJob(id);
      return finished === undefined ? undefined : toJobDto(finished, state);
    }
    return toJobDto(job, state);
  }

  async cancel(id: string): Promise<JobDto | undefined> {
    const job = await this.queue.getJob(id);
    if (job === undefined) return undefined;
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return toJobDto(job, state);
    const data = ParseJobDataSchema.parse(job.data);
    if (data.cancelRequestedAt === null) {
      await job.updateData({ ...data, cancelRequestedAt: new Date().toISOString() });
    }
    return this.get(id);
  }

  async isBusy(): Promise<boolean> {
    const jobs = await this.queue.getJobs(['active', ...PENDING_STATES]);
    return jobs.some((job) => ParseJobDataSchema.parse(job.data).cancelRequestedAt === null);
  }

  /** Stops the inline worker after its current chapter and closes the Redis connection. */
  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }

  private async withState(state: string, jobs: Promise<ParseJob[]>): Promise<JobDto[]> {
    return (await jobs).map((job) => toJobDto(job, state));
  }
}
