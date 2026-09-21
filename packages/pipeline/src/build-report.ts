import {
  type Db,
  getEdition,
  listChapterSummaries,
  listEditionMentionCounts,
  listEditionSegments,
  listKnownEntities,
} from '@novelstruct/db';
import { aggregateReport, renderReport } from '@novelstruct/report';
import { PipelineError } from './errors.js';

/** Self-contained HTML report of the structure pass for one edition. */
export async function buildReportHtml(db: Db, editionId: string, now: Date = new Date()): Promise<string> {
  const found = await getEdition(db, editionId);
  if (found === undefined) throw new PipelineError('not_found', `版本 ${editionId} 不存在`);
  const [chapters, segments, mentions, entities] = await Promise.all([
    listChapterSummaries(db, editionId),
    listEditionSegments(db, editionId),
    listEditionMentionCounts(db, editionId),
    listKnownEntities(db, found.book.id),
  ]);
  const data = aggregateReport({
    bookTitle: found.book.title,
    author: found.book.author,
    editionId,
    editionLabel: found.edition.label,
    generatedAt: now.toISOString(),
    chapters,
    segments,
    mentions,
    entities,
  });
  return renderReport(data);
}
