import type { ParseChapterEvent } from '@novelstruct/pipeline';
import type { JobEventDto, JobResultDto, JobStatusDto } from './contracts.js';

/** The pipeline event already has the DTO's shape; this pins the conversion in one place. */
export function toEventDto(event: ParseChapterEvent): JobEventDto {
  return event;
}

/** Totals derived from the events seen so far, so a resumed job counts what it did before too. */
export function countEvents(events: readonly JobEventDto[], stopped: boolean): JobResultDto {
  return {
    succeeded: events.filter((e) => e.type === 'succeeded').length,
    failed: events.filter((e) => e.type === 'failed').length,
    skipped: events.filter((e) => e.type === 'skipped').length,
    stopped,
  };
}

export function finalStatus(result: JobResultDto, cancelled: boolean): JobStatusDto {
  if (cancelled) return 'cancelled';
  return result.failed > 0 ? 'failed' : 'succeeded';
}

export function failureMessage(result: JobResultDto): string | null {
  return result.failed > 0 ? `${result.failed} 章解析失败` : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where a resumed job continues: the chapter after the last one it recorded, else its own start. */
export function nextChapterIndex(events: readonly JobEventDto[], from: number): number {
  const last = events[events.length - 1];
  return last === undefined ? from : last.chapter.index + 1;
}
