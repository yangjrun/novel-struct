/**
 * Wire types shared by the API and the web client. Pure types only: this file must stay
 * importable from the browser bundle, so nothing here may pull in node or database code.
 */
import type { ChapterKind, EntityType, ParsePass, ParseRunStatus, SegmentKind } from '@novelstruct/core';

export type { ChapterKind, EntityType, ParsePass, ParseRunStatus, SegmentKind };

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly error: null;
}

export interface ApiFailure {
  readonly success: false;
  readonly data: null;
  readonly error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ConfigDto {
  readonly database: 'pglite' | 'postgres';
  /** `memory` runs parse jobs inside the API process; `bullmq` keeps them in Redis. */
  readonly queue: 'memory' | 'bullmq';
  readonly llmConfigured: boolean;
  readonly llmModel: string | null;
  readonly attributors: readonly AttributorNameDto[];
  /** Null until LLM_PRICE_INPUT and LLM_PRICE_OUTPUT are set; costs are then estimated. */
  readonly pricing: UsagePricingDto | null;
}

export interface UsagePricingDto {
  /** Per million input tokens, in `currency`. */
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Display label only, e.g. USD or CNY. */
  readonly currency: string;
}

/** Token totals of one edition under one attributor and model. */
export interface UsageRowDto {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly editionId: string;
  readonly editionLabel: string;
  readonly attributor: string;
  readonly model: string | null;
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly chapters: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** ISO 8601 */
  readonly lastRunAt: string | null;
  /** At the configured prices; null without prices or for rows without a model. */
  readonly cost: number | null;
}

export interface UsageTotalDto {
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number | null;
}

export interface UsageReportDto {
  readonly pricing: UsagePricingDto | null;
  readonly rows: readonly UsageRowDto[];
  readonly total: UsageTotalDto;
}

export type AttributorNameDto = 'heuristic' | 'llm';

export interface EditionSummaryDto {
  readonly id: string;
  readonly label: string;
  readonly chapterCount: number;
}

export interface BookDto {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly editions: readonly EditionSummaryDto[];
}

export interface ImportResultDto {
  readonly bookId: string;
  readonly editionId: string;
  /** Title actually stored: the form's, or the EPUB's own when the form left it blank. */
  readonly title: string;
  readonly author: string | null;
  readonly format: string;
  readonly chapterCount: number;
  readonly volumeCount: number;
  readonly encoding: string;
  readonly replacedSequences: number;
  /** Heading lines kept as prose, one message each. */
  readonly warnings: readonly string[];
  /** Set when an existing edition was updated in place instead of a new one being created. */
  readonly reimport: {
    readonly kept: number;
    readonly updated: number;
    readonly added: number;
    readonly removed: number;
  } | null;
}

export interface DeleteBookResultDto {
  readonly bookId: string;
  readonly title: string;
  readonly editions: number;
  readonly chapters: number;
}

export interface ParseRunDto {
  readonly id: string;
  readonly chapterId: string;
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model: string | null;
  readonly status: ParseRunStatus;
  /** 1 for the first run of this chapter with this attributor, prompt and model; one more per run. */
  readonly attempt: number;
  /** host:pid of the process that ran it. */
  readonly workerId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
  /** ISO 8601 */
  readonly startedAt: string;
  /** Last liveness signal of a running run. */
  readonly heartbeatAt: string | null;
  readonly finishedAt: string | null;
}

export interface ChapterRowDto {
  readonly id: string;
  readonly index: number;
  readonly kind: ChapterKind;
  readonly number: number | null;
  readonly title: string | null;
  readonly charCount: number;
  readonly segmentCount: number;
  readonly latestRun: ParseRunDto | null;
}

export interface EditionDetailDto {
  readonly book: { readonly id: string; readonly title: string; readonly author: string | null };
  readonly edition: {
    readonly id: string;
    readonly label: string;
    readonly sourceFormat: string;
    readonly sourceFilename: string | null;
    readonly sourceEncoding: string;
    readonly normalizerVersion: string;
    readonly createdAt: string;
  };
  readonly chapters: readonly ChapterRowDto[];
}

export interface SegmentDto {
  readonly index: number;
  readonly kind: SegmentKind;
  readonly sceneIndex: number;
  readonly sceneLocation: string | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
  readonly speakerName: string | null;
  readonly speakerSurface: string | null;
  readonly speakerConfidence: number | null;
  readonly emotionType: string | null;
}

export interface ChapterDetailDto {
  readonly chapter: {
    readonly id: string;
    readonly index: number;
    readonly kind: ChapterKind;
    readonly number: number | null;
    readonly title: string | null;
    readonly headingRaw: string | null;
    readonly charCount: number;
    /** Full normalized text, for chapters that are not parsed yet. */
    readonly text: string;
  };
  readonly segments: readonly SegmentDto[];
  readonly prevIndex: number | null;
  readonly nextIndex: number | null;
}

export interface EntityDto {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly confidence: number;
  readonly aliases: readonly string[];
  readonly firstChapterId: string | null;
  readonly dialogueCount: number;
  readonly mentionCount: number;
}

export interface ParseRequestDto {
  readonly from?: number;
  readonly to?: number;
  readonly attributor?: AttributorNameDto;
  readonly force?: boolean;
  /** 1 to 20; defaults to 3. */
  readonly maxAttempts?: number;
}

/** Job types are owned by the queue package so the API, the worker and the web client agree. */
export type {
  JobChapterRefDto,
  JobDto,
  JobEventDto,
  JobOptionsDto,
  JobResultDto,
  JobStatusDto,
} from '@novelstruct/queue/contracts';
