export * from './schema/index.js';
export { openDatabase, type Db, type DbHandle, type OpenDatabaseOptions } from './client.js';
export { ensureDefaultLibrary, DEFAULT_LIBRARY_NAME } from './repositories/library.js';
export {
  createBook,
  findBookByTitle,
  findEditionByLabel,
  listBooks,
  listEditionIds,
  getBook,
  getEdition,
  type BookSummary,
  type EditionSummary,
  type EditionWithBook,
} from './repositories/books.js';
export { deleteBook, type DeleteBookResult } from './repositories/delete-book.js';
export {
  importNormalizedBook,
  type ImportEditionInput,
  type ImportEditionResult,
} from './repositories/import-edition.js';
export {
  matchChapters,
  reimportNormalizedBook,
  type ChapterMatch,
  type ChapterMatching,
  type ExistingChapter,
  type ReimportCounts,
  type ReimportEditionInput,
  type ReimportEditionResult,
} from './repositories/reimport-edition.js';
export {
  getChapterById,
  getChapterByIndex,
  getChapterByNumber,
  listChapterSummaries,
  type ChapterRow,
  type ChapterSummary,
} from './repositories/chapters.js';
export { listKnownEntities } from './repositories/entities.js';
export {
  startParseRun,
  heartbeatParseRun,
  finishParseRun,
  inspectChapterRuns,
  markRunInterrupted,
  sweepStaleRuns,
  type ChapterRunState,
  type RunningRun,
  type StartParseRunInput,
  type FinishParseRunInput,
  type ParseRunKey,
} from './repositories/parse-runs.js';
export { commitChapterIR, IRValidationError, type CommitSummary } from './repositories/commit-ir.js';
export { listChapterSegments, type SegmentView } from './repositories/segments.js';
export {
  listEditionSegments,
  listEditionMentionCounts,
  type EditionSegmentRow,
  type MentionCountRow,
} from './repositories/report-queries.js';
export { listBookEntities, type EntityView } from './repositories/entity-views.js';
export { listEditionParseRuns, latestRunByChapter, type ParseRunView } from './repositories/parse-run-views.js';
export { listChapterSegmentCounts, type ChapterSegmentCount } from './repositories/chapter-stats.js';
export { summarizeUsage, type UsageFilter, type UsageRow } from './repositories/usage.js';
export {
  acquireBookLock,
  releaseBookLock,
  renewBookLock,
  sweepStaleBookLocks,
  type BookLockHolder,
  type BookLockOutcome,
  type BookLockRequest,
} from './repositories/book-locks.js';
