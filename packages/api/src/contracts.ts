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
  readonly shadowModel: string | null;
  readonly attributors: readonly AttributorNameDto[];
  /** Null until LLM_PRICE_INPUT and LLM_PRICE_OUTPUT are set; costs are then estimated. */
  readonly pricing: UsagePricingDto | null;
  readonly embeddingConfigured: boolean;
}

export interface SceneSearchResultDto {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly editionId: string;
  readonly editionLabel: string;
  readonly chapterId: string;
  readonly chapterIndex: number;
  readonly chapterTitle: string | null;
  readonly sceneId: string;
  readonly sceneIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly excerpt: string;
  readonly similarity: number;
}

export interface TimelineEventDto {
  readonly id: string;
  readonly chapterId: string;
  readonly chapterIndex: number;
  readonly chapterTitle: string | null;
  readonly storyTime: string | null;
  readonly type: string;
  readonly summary: string;
  readonly actor: string | null;
}

export interface EntityReviewDto {
  readonly id: string;
  readonly bookId: string;
  readonly editionId: string | null;
  readonly chapterId: string | null;
  readonly kind: string;
  readonly targetId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly status: string;
  readonly createdAt: string;
}

export interface VoiceProfileDto {
  readonly entityId: string;
  readonly provider: string;
  readonly voiceId: string;
  readonly params: string | null;
}

export interface TtsTaskDto {
  readonly id: string;
  readonly chapterId: string;
  readonly segmentIndex: number;
  readonly sceneIndex: number;
  readonly kind: SegmentKind;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly speakerEntityId: string | null;
  readonly speakerSurface: string | null;
  readonly voice: {
    readonly provider: string;
    readonly voiceId: string;
    readonly params: Record<string, string | number | boolean>;
  } | null;
  readonly emotion: string | null;
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
  readonly speakerEntityId: string | null;
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
  readonly shadowReviews: readonly ShadowReviewDto[];
  readonly prevIndex: number | null;
  readonly nextIndex: number | null;
}

export interface ShadowReviewDto {
  readonly pass: 'structure' | 'consistency';
  readonly itemKey: string;
  readonly charStart: number | null;
  readonly charEnd: number | null;
  readonly source: string | null;
  readonly claim: string | null;
  readonly label: string | null;
  readonly confidence: number | null;
  readonly model: string;
  readonly error: string | null;
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
  readonly allKinds?: boolean;
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
