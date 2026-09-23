import { Hono } from 'hono';
import {
  listBooks,
  listEditionIds,
  listEntityReviews,
  finishEntityReview,
  getBook,
  listVoiceProfiles,
  setVoiceProfile,
} from '@novelstruct/db';
import { deleteBookSafely, importBook } from '@novelstruct/pipeline';
import { z } from 'zod';
import type { BookDto, DeleteBookResultDto, ImportResultDto } from '../contracts.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { ok } from '../respond.js';

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const ImportFields = z.object({
  /** Optional so an EPUB can supply its own title; the pipeline rejects a TXT without one. */
  title: z.string().trim().max(200).optional(),
  author: z.string().trim().max(100).optional(),
  label: z.string().trim().max(50).optional(),
});

export function bookRoutes(ctx: AppContext): Hono {
  return new Hono()
    .get('/', async (c) => {
      const books: BookDto[] = await listBooks(ctx.db);
      return ok(c, books);
    })
    .get('/:bookId/reviews', async (c) => {
      const bookId = c.req.param('bookId');
      if (!(await getBook(ctx.db, bookId))) throw new HttpError(404, `书 ${bookId} 不存在`);
      const reviews = await listEntityReviews(ctx.db, bookId);
      return ok(
        c,
        reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      );
    })
    .get('/:bookId/voices', async (c) => {
      const bookId = c.req.param('bookId');
      if (!(await getBook(ctx.db, bookId))) throw new HttpError(404, '书不存在');
      return ok(c, await listVoiceProfiles(ctx.db, bookId));
    })
    .put('/:bookId/voices/:entityId', async (c) => {
      const body = z
        .object({
          provider: z.string().trim().min(1),
          voiceId: z.string().trim().min(1),
          params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        })
        .parse(await c.req.json());
      const bookId = c.req.param('bookId');
      if (!(await getBook(ctx.db, bookId))) throw new HttpError(404, '书不存在');
      await setVoiceProfile(ctx.db, { bookId, entityId: c.req.param('entityId'), ...body });
      return ok(c, { entityId: c.req.param('entityId'), ...body });
    })
    .post('/:bookId/reviews/:id', async (c) => {
      const status = z.enum(['approved', 'rejected']).parse(((await c.req.json()) as { status?: unknown }).status);
      const bookId = c.req.param('bookId');
      const review = (await listEntityReviews(ctx.db, bookId)).find((r) => r.id === c.req.param('id'));
      if (!review) throw new HttpError(404, '复核项不存在');
      if (!(await finishEntityReview(ctx.db, review.id, status))) throw new HttpError(409, '复核项已经处理');
      return ok(c, { id: review.id, status });
    })
    .post('/import', async (c) => {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!(file instanceof File)) throw new HttpError(400, '缺少上传文件字段 file');
      if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限`);
      const fields = ImportFields.parse({
        title: stringField(body['title']),
        author: stringField(body['author']),
        label: stringField(body['label']),
      });

      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importBook(ctx.db, {
        bytes,
        ...optional('title', fields.title),
        ...optional('author', fields.author),
        ...optional('label', fields.label),
        filename: file.name,
      });
      ctx.logger.info(`导入 ${result.bookId} / ${result.editionId}: ${result.title}, ${result.chapterCount} 章`);
      const dto: ImportResultDto = {
        bookId: result.bookId,
        editionId: result.editionId,
        title: result.title,
        author: result.author ?? null,
        format: result.normalized.format,
        chapterCount: result.chapterCount,
        volumeCount: result.volumeCount,
        encoding: result.normalized.encoding,
        replacedSequences: result.normalized.replacedSequences,
        warnings: result.normalized.warnings,
        reimport: result.reimport ?? null,
      };
      return ok(c, dto, result.reimport === undefined ? 201 : 200);
    })
    .delete('/:bookId', async (c) => {
      const bookId = c.req.param('bookId');
      const editionIds = new Set(await listEditionIds(ctx.db, bookId));
      const active = (await ctx.jobs.list()).filter(
        (job) => editionIds.has(job.editionId) && (job.status === 'queued' || job.status === 'running'),
      );
      if (active.length > 0) throw new HttpError(409, `这本书还有 ${active.length} 个解析任务未结束，先取消它们`);

      const result: DeleteBookResultDto = await deleteBookSafely(ctx.db, bookId);
      ctx.logger.info(`删除 ${result.bookId}: ${result.title}, ${result.editions} 个版本 ${result.chapters} 章`);
      return ok(c, result);
    });
}

function stringField(value: string | File | (string | File)[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined || value.length === 0 ? {} : ({ [key]: value } as Record<K, string>);
}
