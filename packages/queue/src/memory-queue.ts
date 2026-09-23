import { randomUUID } from 'node:crypto';
import {
  BOOK_BUSY_RETRY_MS,
  executeParsePlan,
  type ParseChapterEvent,
  type ParseEditionResult,
  type ParsePlan,
  planEditionParse,
} from '@novelstruct/pipeline';
import type { JobDto, JobStatusDto } from './contracts.js';
import { countEvents, errorMessage, failureMessage, finalStatus, nextChapterIndex, toEventDto } from './status.js';
import { DEFAULT_KEEP_FINISHED, type JobQueue, type ParseJobOptions, type QueueDeps } from './types.js';

interface JobRecord {
  readonly view: JobDto;
  readonly plan: ParsePlan;
}

const FINISHED: ReadonlySet<JobStatusDto> = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * In-process FIFO that runs parse jobs one at a time against the shared database handle.
 * State lives only in memory and is lost on restart; the per-chapter `parse_runs` rows and the
 * parse results themselves are in the database regardless. Used when `REDIS_URL` is unset.
 */
export class MemoryJobQueue implements JobQueue {
  readonly kind = 'memory';
  private readonly jobs = new Map<string, JobRecord>();
  private readonly cancelRequested = new Set<string>();
  private pending: readonly string[] = [];
  private running = false;
  private closed = false;

  constructor(private readonly deps: QueueDeps) {}

  async enqueue(editionId: string, options: ParseJobOptions): Promise<JobDto> {
    if (this.closed) throw new Error('队列已关闭');
    const plan = await planEditionParse(this.deps.db, {
      editionId,
      from: options.from,
      ...(options.to === null ? {} : { to: options.to }),
      attributor: options.attributor,
      force: options.force,
      allKinds: options.allKinds ?? false,
      maxAttempts: options.maxAttempts,
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

  async list(): Promise<readonly JobDto[]> {
    return this.snapshot();
  }

  async get(id: string): Promise<JobDto | undefined> {
    return this.jobs.get(id)?.view;
  }

  async cancel(id: string): Promise<JobDto | undefined> {
    const record = this.jobs.get(id);
    if (record === undefined) return undefined;
    if (record.view.status === 'queued') {
      this.pending = this.pending.filter((jobId) => jobId !== id);
      return this.update(id, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
    if (record.view.status === 'running') this.cancelRequested.add(id);
    return this.jobs.get(id)?.view;
  }

  async isBusy(): Promise<boolean> {
    return this.running || this.pending.length > 0;
  }

  /** Drops queued jobs; a running job stops after its current chapter. Resolves once idle. */
  async close(): Promise<void> {
    this.closed = true;
    for (const id of this.pending) {
      this.update(id, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
    this.pending = [];
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  private snapshot(): JobDto[] {
    return [...this.jobs.values()].map((r) => r.view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      const result = await this.runUntilUnblocked(id, record.plan);
      const view = this.jobs.get(id)?.view;
      const counts = countEvents(view?.events ?? [], result.stopped);
      const cancelled = result.stopped;
      this.update(id, {
        status: finalStatus(counts, cancelled),
        finishedAt: new Date().toISOString(),
        result: counts,
        error: failureMessage(counts),
      });
    } catch (error) {
      this.deps.logger.error(`解析任务 ${id} 意外失败`, error);
      this.update(id, { status: 'failed', finishedAt: new Date().toISOString(), error: errorMessage(error) });
    } finally {
      this.cancelRequested.delete(id);
      this.prune();
    }
  }

  /**
   * Executes the plan, and when another process holds the book, waits and resumes from the last
   * recorded chapter. Only reachable with a shared PostgreSQL and more than one process; on
   * PGlite the lock is always free.
   */
  private async runUntilUnblocked(id: string, plan: ParsePlan): Promise<ParseEditionResult> {
    const retryMs = this.deps.bookBusyRetryMs ?? BOOK_BUSY_RETRY_MS;
    for (;;) {
      const events = this.jobs.get(id)?.view.events ?? [];
      const from = nextChapterIndex(events, plan.chapters[0]?.index ?? 0);
      const remaining = { ...plan, chapters: plan.chapters.filter((c) => c.index >= from) };
      if (remaining.chapters.length === 0) return { total: 0, succeeded: 0, failed: 0, skipped: 0, stopped: false };
      const result = await executeParsePlan(this.deps.db, remaining, {
        onEvent: (event) => this.append(id, event),
        shouldStop: async () => {
          // PGlite resolves queries on the microtask queue, so a heuristic parse would never let
          // timers or HTTP handlers run; yield once per chapter so `cancel` and `get` stay live.
          await new Promise((resolve) => setImmediate(resolve));
          return this.closed || this.cancelRequested.has(id);
        },
      });
      if (result.blockedBy === undefined || this.closed || this.cancelRequested.has(id)) return result;
      this.deps.logger.info(
        `任务 ${id} 等待：这本书正在被 ${result.blockedBy} 解析，${Math.round(retryMs / 1000)} 秒后重试`,
      );
      await this.waitUnless(retryMs, () => this.closed || this.cancelRequested.has(id));
    }
  }

  private async waitUnless(ms: number, done: () => boolean): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !done()) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
    }
  }

  private append(id: string, event: ParseChapterEvent): void {
    const record = this.jobs.get(id);
    if (record === undefined) return;
    this.update(id, { events: [...record.view.events, toEventDto(event)] });
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
    this.snapshot()
      .filter((j) => FINISHED.has(j.status))
      .slice(keep)
      .forEach((j) => this.jobs.delete(j.id));
  }
}
