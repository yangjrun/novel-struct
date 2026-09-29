export * from './schema/index.js';
export { validateFactBatch } from './repositories/validate-facts.js';
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
  replaceShadowReviews,
  listChapterShadowReviews,
  hasChapterShadowReviews,
  type ShadowPass,
  type ShadowReviewInput,
} from './repositories/shadow-reviews.js';
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
  recentEntityMentions,
  currentEntityStates,
  unresolvedForeshadows,
  type HistoricalMention,
} from './repositories/context-queries.js';
export {
  commitConsistencyFacts,
  type CommitFactsInput,
  type FactEvidence,
  type StateProposal,
  type RelationProposal,
  type EventProposal,
  type ForeshadowProposal,
} from './repositories/commit-facts.js';
export {
  resolveEntityNameAt,
  setEntityAliasInterval,
  enqueueEntityReview,
  listEntityReviews,
  finishEntityReview,
  mergeEntities,
  splitEntity,
} from './repositories/entity-review.js';
export { listEditionTimeline } from './repositories/timeline.js';
export { setVoiceProfile, listVoiceProfiles } from './repositories/voices.js';
export {
  getWeKnoraKb,
  saveWeKnoraKb,
  listChaptersForWeKnora,
  saveWeKnoraDocument,
  linkWeKnoraChunks,
  clearWeKnoraPointers,
  clearWeKnoraEditionPointers,
} from './repositories/weknora.js';
export { listWeKnoraEditions, listWeKnoraSources, getWeKnoraLocalStatus } from './repositories/weknora-web.js';
export { rebuildBookMemory } from './repositories/memory.js';
export {
  EMBEDDING_DIMENSIONS,
  listScenesToIndex,
  saveSceneEmbedding,
  sceneContentHash,
  searchSceneEmbeddings,
  validateEmbedding,
  type SceneToIndex,
  type SceneSearchHit,
} from './repositories/scene-search.js';
export {
  acquireBookLock,
  releaseBookLock,
  renewBookLock,
  sweepStaleBookLocks,
  type BookLockHolder,
  type BookLockOutcome,
  type BookLockRequest,
} from './repositories/book-locks.js';
