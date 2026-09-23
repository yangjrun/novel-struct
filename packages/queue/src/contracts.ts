/**
 * Wire types for parse jobs, shared by the queue, the API and the web client. Pure types only:
 * the browser bundle imports this file, so nothing here may pull in node, Redis or database code.
 */
import type { ChapterKind } from '@novelstruct/core';

export type AttributorNameDto = 'heuristic' | 'llm';

export type JobStatusDto = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobChapterRefDto {
  readonly id: string;
  readonly index: number;
  readonly kind: ChapterKind;
  readonly title: string | null;
}

export type JobEventDto =
  | { readonly type: 'skipped'; readonly chapter: JobChapterRefDto; readonly reason: string }
  | {
      readonly type: 'succeeded';
      readonly chapter: JobChapterRefDto;
      readonly summary: {
        readonly scenes: number;
        readonly segments: number;
        readonly newEntities: number;
        readonly mentions: number;
      };
      readonly unresolved: number;
      readonly warnings: readonly string[];
      /** Token usage the attributor reported; absent for the heuristic attributor. */
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly type: 'failed'; readonly chapter: JobChapterRefDto; readonly error: string };

export interface JobOptionsDto {
  readonly from: number;
  readonly to: number | null;
  readonly attributor: AttributorNameDto;
  readonly force: boolean;
  /** Explicitly include notes and front matter. Older queued jobs default to false. */
  readonly allKinds?: boolean;
  /** Chapters that failed this many times with the same attributor and prompt are skipped unless `force`. */
  readonly maxAttempts: number;
}

export interface JobResultDto {
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly stopped: boolean;
}

export interface JobDto {
  readonly id: string;
  readonly editionId: string;
  readonly status: JobStatusDto;
  readonly options: JobOptionsDto;
  readonly total: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly events: readonly JobEventDto[];
  readonly result: JobResultDto | null;
  readonly error: string | null;
}
