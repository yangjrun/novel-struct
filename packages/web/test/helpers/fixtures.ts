import type {
  ChapterDetailDto,
  ConfigDto,
  EditionDetailDto,
  EntityDto,
  EntityReviewDto,
  JobDto,
  ParseRunDto,
  TimelineEventDto,
  UsageReportDto,
  VoiceProfileDto,
} from '@novelstruct/api/contracts';

const CREATED_AT = '2026-09-30T00:00:00.000Z';

export function configFixture(): ConfigDto {
  return {
    database: 'pglite',
    queue: 'memory',
    llmConfigured: false,
    llmModel: null,
    shadowModel: null,
    attributors: ['heuristic'],
    pricing: null,
    embeddingConfigured: false,
    weknoraConfigured: false,
  };
}

export function editionFixture(editionId = 'edition-a', bookId = 'book-a'): EditionDetailDto {
  return {
    book: { id: bookId, title: `Book ${editionId}`, author: null },
    edition: {
      id: editionId,
      label: '测试版本',
      sourceFormat: 'txt',
      sourceFilename: null,
      sourceEncoding: 'utf-8',
      normalizerVersion: 'test',
      createdAt: CREATED_AT,
    },
    chapters: [
      {
        id: `${editionId}-chapter-1`,
        index: 1,
        kind: 'chapter',
        number: 1,
        title: '第一章',
        charCount: 12,
        segmentCount: 0,
        latestRun: null,
      },
    ],
  };
}

export function parseRunFixture(overrides: Partial<ParseRunDto> = {}): ParseRunDto {
  return {
    id: 'run-1',
    chapterId: 'edition-a-chapter-1',
    pass: 'structure',
    attributor: 'heuristic',
    promptVersion: 'test',
    model: null,
    status: 'succeeded',
    attempt: 1,
    workerId: null,
    inputTokens: null,
    outputTokens: null,
    error: null,
    startedAt: CREATED_AT,
    heartbeatAt: null,
    finishedAt: CREATED_AT,
    ...overrides,
  };
}

export function entityFixture(name = 'Entity edition-a'): EntityDto {
  return {
    id: 'entity-1',
    type: 'character',
    canonicalName: name,
    description: null,
    confidence: 0.9,
    aliases: [],
    firstChapterId: null,
    dialogueCount: 1,
    mentionCount: 1,
  };
}

export function voiceFixture(): VoiceProfileDto {
  return { entityId: 'entity-1', provider: 'test-provider', voiceId: 'voice-1', params: null };
}

export function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: 'job-1',
    editionId: 'edition-a',
    status: 'running',
    options: { from: 1, to: 1, attributor: 'heuristic', force: false, maxAttempts: 3 },
    total: 1,
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    finishedAt: null,
    events: [],
    result: null,
    error: null,
    ...overrides,
  };
}

export function usageFixture(inputTokens = 0): UsageReportDto {
  return {
    pricing: null,
    rows: [],
    total: { runs: 0, succeeded: 0, failed: 0, inputTokens, outputTokens: 0, cost: null },
  };
}

export function chapterFixture(editionId = 'edition-a', index = 1): ChapterDetailDto {
  return {
    chapter: {
      id: `${editionId}-chapter-${index}`,
      index,
      kind: 'chapter',
      number: index,
      title: `Chapter ${editionId}-${index}`,
      headingRaw: null,
      charCount: 12,
      text: '第一行原文\n第二行原文',
    },
    segments: [],
    shadowReviews: [],
    prevIndex: index > 1 ? index - 1 : null,
    nextIndex: index + 1,
  };
}

export function timelineFixture(editionId = 'edition-a'): TimelineEventDto {
  return {
    id: `event-${editionId}`,
    chapterId: `${editionId}-chapter-1`,
    chapterIndex: 1,
    chapterTitle: '第一章',
    storyTime: null,
    type: 'event',
    summary: `Event ${editionId}`,
    actor: null,
  };
}

export function reviewFixture(bookId = 'book-a'): EntityReviewDto {
  return {
    id: `review-${bookId}`,
    bookId,
    editionId: null,
    chapterId: null,
    kind: 'entity',
    targetId: 'entity-1',
    reason: `Review ${bookId}`,
    confidence: 0.8,
    status: 'pending',
    createdAt: CREATED_AT,
  };
}
