import { CHAPTER_KINDS } from '@novelstruct/core';
import { ATTRIBUTOR_NAMES } from '@novelstruct/pipeline';
import type { Job } from 'bullmq';
import { z } from 'zod';
import type { JobDto, JobEventDto } from '../contracts.js';
import { countEvents, failureMessage, finalStatus } from '../status.js';

/** BullMQ queue name; the deployment prefix comes from `QUEUE_PREFIX`. */
export const PARSE_QUEUE = 'parse';
export type ParseJobName = 'parse';

const ChapterRefSchema = z.object({
  id: z.string(),
  index: z.number().int().min(0),
  kind: z.enum(CHAPTER_KINDS),
  title: z.string().nullable(),
});

const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('skipped'), chapter: ChapterRefSchema, reason: z.string() }),
  z.object({
    type: z.literal('succeeded'),
    chapter: ChapterRefSchema,
    summary: z.object({
      scenes: z.number().int(),
      segments: z.number().int(),
      newEntities: z.number().int(),
      mentions: z.number().int(),
    }),
    unresolved: z.number().int(),
    warnings: z.array(z.string()),
  }),
  z.object({ type: z.literal('failed'), chapter: ChapterRefSchema, error: z.string() }),
]);

/** What the API stores when it enqueues; the worker re-plans from it. */
export const ParseJobDataSchema = z.object({
  editionId: z.string(),
  options: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0).nullable(),
    attributor: z.enum(ATTRIBUTOR_NAMES),
    force: z.boolean(),
  }),
  total: z.number().int().min(0),
  /** Set by `cancel`; the worker checks it before every chapter. */
  cancelRequestedAt: z.string().nullable(),
});
export type ParseJobData = z.output<typeof ParseJobDataSchema>;

/** Stored as BullMQ progress after every chapter, so a resumed job continues after the last event. */
export const ParseJobProgressSchema = z.object({ events: z.array(EventSchema) });
export type ParseJobProgress = z.output<typeof ParseJobProgressSchema>;

export const ParseJobReturnSchema = z.object({
  succeeded: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  stopped: z.boolean(),
  cancelled: z.boolean(),
});
export type ParseJobReturn = z.output<typeof ParseJobReturnSchema>;

export type ParseJob = Job<ParseJobData, ParseJobReturn, ParseJobName>;

/** Events recorded so far; an unset or malformed progress counts as none. */
export function readEvents(progress: unknown): readonly JobEventDto[] {
  const parsed = ParseJobProgressSchema.safeParse(progress);
  return parsed.success ? parsed.data.events : [];
}

/**
 * Projects a BullMQ job plus its state onto the wire DTO. Cancellation is a flag in the job data:
 * a waiting job with the flag reads as cancelled right away, an active one keeps reading as
 * running until the worker stops at the next chapter boundary.
 */
export function toJobDto(job: ParseJob, state: string): JobDto {
  const data = ParseJobDataSchema.parse(job.data);
  const events = readEvents(job.progress);
  const base = {
    id: job.id ?? '',
    editionId: data.editionId,
    options: data.options,
    total: data.total,
    createdAt: iso(job.timestamp),
    startedAt: job.processedOn === undefined ? null : iso(job.processedOn),
    finishedAt: job.finishedOn === undefined ? null : iso(job.finishedOn),
    events,
  };
  switch (state) {
    case 'active':
      return { ...base, status: 'running', result: null, error: null };
    case 'completed': {
      const returned = ParseJobReturnSchema.safeParse(job.returnvalue);
      if (!returned.success) return { ...base, status: 'failed', result: null, error: '任务返回值无法识别' };
      const { cancelled, ...result } = returned.data;
      return { ...base, status: finalStatus(result, cancelled), result, error: failureMessage(result) };
    }
    case 'failed':
      return { ...base, status: 'failed', result: null, error: job.failedReason || '任务失败' };
    default:
      if (data.cancelRequestedAt !== null) {
        return {
          ...base,
          status: 'cancelled',
          finishedAt: data.cancelRequestedAt,
          result: countEvents(events, true),
          error: null,
        };
      }
      return { ...base, status: 'queued', result: null, error: null };
  }
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
