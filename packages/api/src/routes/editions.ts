import { Hono } from 'hono';
import {
  getChapterByIndex,
  getEdition,
  latestRunByChapter,
  listBookEntities,
  listChapterSegmentCounts,
  listChapterSegments,
  listChapterSummaries,
  listEditionParseRuns,
  type ParseRunView,
} from '@novelstruct/db';
import { buildReportHtml } from '@novelstruct/pipeline';
import { z } from 'zod';
import type { ChapterDetailDto, EditionDetailDto, EntityDto, ParseRunDto } from '../contracts.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { ok } from '../respond.js';

const ChapterIndex = z.coerce.number().int().min(0);

export function editionRoutes(ctx: AppContext): Hono {
  return new Hono()
    .get('/:editionId', async (c) => {
      const editionId = c.req.param('editionId');
      const found = await getEdition(ctx.db, editionId);
      if (found === undefined) throw new HttpError(404, `版本 ${editionId} 不存在`);
      const [chapters, counts, runs] = await Promise.all([
        listChapterSummaries(ctx.db, editionId),
        listChapterSegmentCounts(ctx.db, editionId),
        listEditionParseRuns(ctx.db, editionId),
      ]);
      const segmentCounts = new Map(counts.map((r) => [r.chapterId, r.segmentCount] as const));
      const latest = latestRunByChapter(runs);
      const dto: EditionDetailDto = {
        book: { id: found.book.id, title: found.book.title, author: found.book.author },
        edition: {
          id: found.edition.id,
          label: found.edition.label,
          sourceFormat: found.edition.sourceFormat,
          sourceFilename: found.edition.sourceFilename,
          sourceEncoding: found.edition.sourceEncoding,
          normalizerVersion: found.edition.normalizerVersion,
          createdAt: found.edition.createdAt.toISOString(),
        },
        chapters: chapters.map((ch) => {
          const run = latest.get(ch.id);
          return {
            ...ch,
            segmentCount: segmentCounts.get(ch.id) ?? 0,
            latestRun: run === undefined ? null : toRunDto(run),
          };
        }),
      };
      return ok(c, dto);
    })
    .get('/:editionId/chapters/:index', async (c) => {
      const editionId = c.req.param('editionId');
      const index = ChapterIndex.parse(c.req.param('index'));
      const chapter = await getChapterByIndex(ctx.db, editionId, index);
      if (chapter === undefined) throw new HttpError(404, `版本 ${editionId} 没有 index 为 ${index} 的章节`);
      const [segments, summaries] = await Promise.all([
        listChapterSegments(ctx.db, chapter.id),
        listChapterSummaries(ctx.db, editionId),
      ]);
      const indexes = summaries.map((s) => s.index);
      const position = indexes.indexOf(index);
      const dto: ChapterDetailDto = {
        chapter: {
          id: chapter.id,
          index: chapter.index,
          kind: chapter.kind,
          number: chapter.number,
          title: chapter.title,
          headingRaw: chapter.headingRaw,
          charCount: chapter.charCount,
          text: chapter.text,
        },
        segments,
        prevIndex: indexes[position - 1] ?? null,
        nextIndex: indexes[position + 1] ?? null,
      };
      return ok(c, dto);
    })
    .get('/:editionId/entities', async (c) => {
      const editionId = c.req.param('editionId');
      const found = await getEdition(ctx.db, editionId);
      if (found === undefined) throw new HttpError(404, `版本 ${editionId} 不存在`);
      const entities: EntityDto[] = await listBookEntities(ctx.db, found.book.id);
      return ok(c, entities);
    })
    .get('/:editionId/runs', async (c) => {
      const editionId = c.req.param('editionId');
      const runs = await listEditionParseRuns(ctx.db, editionId);
      const dto: ParseRunDto[] = runs.map(toRunDto);
      return ok(c, dto);
    })
    .get('/:editionId/report', async (c) => {
      const html = await buildReportHtml(ctx.db, c.req.param('editionId'));
      return c.html(html);
    });
}

function toRunDto(run: ParseRunView): ParseRunDto {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
  };
}
