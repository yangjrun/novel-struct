import { randomUUID } from 'node:crypto';
import type { Db } from '@novelstruct/db';
import {
  type AttributorName,
  executeParsePlan,
  type LlmEnv,
  type ParseChapterEvent,
  type ParseEditionResult,
  type ParsePlan,
  planEditionParse,
} from '@novelstruct/pipeline';
import type { JobDto, JobStatusDto } from '../contracts.js';
import type { Logger } from '../log.js';

export interface ParseJobOptions {
  readonly from: number;
  readonly to: number | null;
  readonly attributor: AttributorName;
  readonly force: boolean;
}

interface JobRecord {
  readonly view: JobDto;
  readonly plan: ParsePlan;
}

export interface JobManagerDeps {
  readonly db: Db;
  readonly llm: LlmEnv | undefined;
  readonly logger: Logger;
  /** Finished jobs kept in memory beyond this count are dropped, oldest first. */
  readonly keepFinished?: number;
}

const DEFAULT_KEEP_FINISHED = 50;
const FINISHED: ReadonlySet<JobStatusDto> = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * In-process queue that runs parse jobs one at a time against the shared database handle.
 * State lives only in memory; M2 replaces this with BullMQ. Every job is planned (edition
 * exists, range is non-empty, attributor is configured) before it is accepted.
 */
export class JobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly cancelRequested = new Set<string>();
  private pending: string[] = [];
  private running = false;

  constructor(private readonly deps: JobManagerDeps) {}

  async enqueue(editionId: string, options: ParseJobOptions): Promise<JobDto> {
    const plan = await planEditionParse(this.deps.db, {
      editionId,
      from: options.from,
      ...(options.to === null ? {} : { to: options.to }),
      attributor: options.attributor,
      force: options.force,
      ...(this.deps.llm === undefined ? {} : { llm: this.deps.llm }),
    });
    const view: JobDto = {
      id: `job_${randomUUID()}`,
      editionId,
      status: 'queued',
      options,
      total: plan.chapters.length,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      events: [],
      result: null,
      error: null,
    };
    this.jobs.set(view.id, { view, plan });
    this.pending = [...this.pending, view.id];
    this.prune();
    void this.pump();
    return view;
  }

  list(): JobDto[] {
    return [...this.jobs.values()].map((r) => r.view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): JobDto | undefined {
    return this.jobs.get(id)?.view;
  }

  /** Queued jobs are dropped immediately; a running job stops before its next chapter. */
  cancel(id: string): JobDto | undefined {
    const record = this.jobs.get(id);
    if (record === undefined) return undefined;
    if (record.view.status === 'queued') {
      this.pending = this.pending.filter((jobId) => jobId !== id);
      return this.update(id, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
    if (record.view.status === 'running') this.cancelRequested.add(id);
    return this.jobs.get(id)?.view;
  }

  /** True while a job is running or queued; the server uses it to refuse shutdown mid-write. */
  isBusy(): boolean {
    return this.running || this.pending.length > 0;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const [next, ...rest] = this.pending;
    if (next === undefined) return;
    this.pending = rest;
    this.running = true;
    try {
      await this.run(next);
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  private async run(id: string): Promise<void> {
    const record = this.jobs.get(id);
    if (record === undefined) return;
    this.update(id, { status: 'running', startedAt: new Date().toISOString() });
    try {
      const result = await executeParsePlan(this.deps.db, record.plan, {
        onEvent: (event) => this.append(id, event),
        shouldStop: () => this.cancelRequested.has(id),
      });
      this.finish(id, result);
    } catch (error) {
      this.deps.logger.error(`解析任务 ${id} 意外失败`, error);
      this.update(id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.cancelRequested.delete(id);
    }
  }

  private finish(id: string, result: ParseEditionResult): void {
    const cancelled = this.cancelRequested.has(id) && result.stopped;
    this.update(id, {
      status: cancelled ? 'cancelled' : result.failed > 0 ? 'failed' : 'succeeded',
      finishedAt: new Date().toISOString(),
      result: { succeeded: result.succeeded, failed: result.failed, skipped: result.skipped, stopped: result.stopped },
      error: result.failed > 0 ? `${result.failed} 章解析失败` : null,
    });
  }

  private append(id: string, event: ParseChapterEvent): void {
    const record = this.jobs.get(id);
    if (record === undefined) return;
    this.update(id, { events: [...record.view.events, event] });
  }

  private update(id: string, patch: Partial<JobDto>): JobDto | undefined {
    const record = this.jobs.get(id);
    if (record === undefined) return undefined;
    const view: JobDto = { ...record.view, ...patch };
    this.jobs.set(id, { ...record, view });
    return view;
  }

  private prune(): void {
    const keep = this.deps.keepFinished ?? DEFAULT_KEEP_FINISHED;
    const finished = this.list()
      .filter((j) => FINISHED.has(j.status))
      .slice(keep);
    finished.forEach((j) => this.jobs.delete(j.id));
  }
}
