import type { Db } from '@novelstruct/db';
import type { AttributorName, LlmEnv } from '@novelstruct/pipeline';
import type { JobDto } from './contracts.js';

export interface ParseJobOptions {
  readonly from: number;
  readonly to: number | null;
  readonly attributor: AttributorName;
  readonly force: boolean;
  /** Chapters with this many failed runs of the same key are skipped unless `force`. */
  readonly maxAttempts: number;
}

/** Minimal logging surface; the API's `Logger` satisfies it. */
export interface QueueLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

/** What every backend needs to plan and run parse jobs. */
export interface QueueDeps {
  readonly db: Db;
  readonly llm: LlmEnv | undefined;
  readonly logger: QueueLogger;
  /** Finished jobs kept beyond this count are dropped, oldest first. */
  readonly keepFinished?: number;
}

/**
 * The parse-job queue as the API sees it. Two backends implement it: an in-process FIFO for
 * zero-install development, and BullMQ on Redis for persistent jobs and separate workers.
 * Every job is planned (edition exists, range is non-empty, attributor configured) before it is
 * accepted, so a request that is bound to fail is rejected at `enqueue` instead.
 */
export interface JobQueue {
  readonly kind: 'memory' | 'bullmq';
  enqueue(editionId: string, options: ParseJobOptions): Promise<JobDto>;
  /** Newest first. */
  list(): Promise<readonly JobDto[]>;
  get(id: string): Promise<JobDto | undefined>;
  /** Queued jobs are cancelled immediately; a running job stops before its next chapter. */
  cancel(id: string): Promise<JobDto | undefined>;
  /** True while a job is running or waiting; the server uses it to describe shutdown. */
  isBusy(): Promise<boolean>;
  /** Stops accepting work and, where a worker runs in this process, lets it finish the current chapter. */
  close(): Promise<void>;
}

export const DEFAULT_KEEP_FINISHED = 50;
