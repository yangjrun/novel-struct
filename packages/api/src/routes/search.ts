import { Hono } from 'hono';
import { indexEditionScenes, searchScenes } from '@novelstruct/knowledge';
import { getEdition } from '@novelstruct/db';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { ok } from '../respond.js';

const SearchRequest = z.object({
  query: z.string().trim().min(1).max(500),
  bookIds: z.array(z.string().min(1)).min(1).max(100),
  limit: z.number().int().min(1).max(50).optional(),
});

export function searchRoutes(ctx: AppContext): Hono {
  return new Hono()
    .post('/', async (c) => {
      if (!ctx.embedder) throw new HttpError(400, '请先配置 EMBEDDING_API_KEY 和 EMBEDDING_MODEL');
      const body = SearchRequest.parse(await c.req.json());
      return ok(c, await searchScenes(ctx.db, { ...body, embedder: ctx.embedder }));
    })
    .post('/editions/:id/index', async (c) => {
      if (!ctx.embedder) throw new HttpError(400, '请先配置 EMBEDDING_API_KEY 和 EMBEDDING_MODEL');
      if (!(await getEdition(ctx.db, c.req.param('id')))) throw new HttpError(404, '版本不存在');
      return ok(c, await indexEditionScenes(ctx.db, { editionId: c.req.param('id'), embedder: ctx.embedder }));
    });
}
