import { Hono } from 'hono';
import { listBooks } from '@novelstruct/db';
import { importBook } from '@novelstruct/pipeline';
import { z } from 'zod';
import type { BookDto, ImportResultDto } from '../contracts.js';
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
    });
}

function stringField(value: string | File | (string | File)[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined || value.length === 0 ? {} : ({ [key]: value } as Record<K, string>);
}
