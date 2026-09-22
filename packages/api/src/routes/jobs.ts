import { Hono } from 'hono';
import { ATTRIBUTOR_NAMES, DEFAULT_MAX_ATTEMPTS } from '@novelstruct/pipeline';
import { z } from 'zod';
import type { JobDto } from '../contracts.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { ok } from '../respond.js';

const MAX_ATTEMPTS_CAP = 20;

const ParseRequest = z
  .object({
    from: z.number().int().min(0).default(0),
    to: z.number().int().min(0).nullable().default(null),
    attributor: z.enum(ATTRIBUTOR_NAMES).default('heuristic'),
    force: z.boolean().default(false),
    maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS_CAP).default(DEFAULT_MAX_ATTEMPTS),
  })
  .refine((v) => v.to === null || v.to >= v.from, { message: 'to 不能小于 from', path: ['to'] });

export function jobRoutes(ctx: AppContext): Hono {
  return new Hono()
    .get('/', async (c) => ok(c, await ctx.jobs.list()))
    .get('/:jobId', async (c) => {
      const job = await ctx.jobs.get(c.req.param('jobId'));
      if (job === undefined) throw new HttpError(404, '任务不存在');
      return ok(c, job);
    })
    .post('/:jobId/cancel', async (c) => {
      const job = await ctx.jobs.cancel(c.req.param('jobId'));
      if (job === undefined) throw new HttpError(404, '任务不存在');
      return ok(c, job);
    });
}

/** Mounted under /editions so the URL reads `POST /editions/:id/parse`. */
export function parseJobRoutes(ctx: AppContext): Hono {
  return new Hono().post('/:editionId/parse', async (c) => {
    const options = ParseRequest.parse(await readJson(c.req.raw));
    const job: JobDto = await ctx.jobs.enqueue(c.req.param('editionId'), options);
    ctx.logger.info(`任务 ${job.id} 入队: ${job.editionId} ${options.attributor} ${job.total} 章`);
    return ok(c, job, 202);
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
  }
}
