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

export interface ParseRunDto {
  readonly id: string;
  readonly chapterId: string;
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model: string | null;
  readonly status: ParseRunStatus;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
  /** ISO 8601 */
  readonly startedAt: string;
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
