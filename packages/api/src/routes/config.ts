import { Hono } from 'hono';
import { ATTRIBUTOR_NAMES } from '@novelstruct/pipeline';
import type { ConfigDto } from '../contracts.js';
import type { AppContext } from '../context.js';
import { ok } from '../respond.js';

export function configRoutes(ctx: AppContext): Hono {
  return new Hono().get('/', (c) => {
    const dto: ConfigDto = {
      database: ctx.databaseKind,
      queue: ctx.jobs.kind,
      llmConfigured: ctx.llm !== undefined,
      llmModel: ctx.llm?.model ?? null,
      shadowModel: ctx.shadow?.model ?? null,
      attributors: ATTRIBUTOR_NAMES,
      pricing: ctx.pricing ?? null,
      embeddingConfigured: ctx.embedder !== undefined,
      weknoraConfigured: ctx.weknora !== undefined,
    };
    return ok(c, dto);
  });
}
