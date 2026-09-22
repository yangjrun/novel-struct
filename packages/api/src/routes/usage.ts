import { Hono } from 'hono';
import { buildUsageReport, type UsageReport } from '@novelstruct/pipeline';
import type { UsageReportDto } from '../contracts.js';
import type { AppContext } from '../context.js';
import { ok } from '../respond.js';

/** `GET /api/usage`: token totals and estimated cost across the whole library. */
export function usageRoutes(ctx: AppContext): Hono {
  return new Hono().get('/', async (c) => {
    const report = await buildUsageReport(ctx.db, pricingOption(ctx));
    return ok(c, toUsageDto(report));
  });
}

/** Mounted under /editions so the URL reads `GET /editions/:id/usage`. */
export function editionUsageRoutes(ctx: AppContext): Hono {
  return new Hono().get('/:editionId/usage', async (c) => {
    const report = await buildUsageReport(ctx.db, { editionId: c.req.param('editionId'), ...pricingOption(ctx) });
    return ok(c, toUsageDto(report));
  });
}

function pricingOption(ctx: AppContext): { pricing?: AppContext['pricing'] } {
  return ctx.pricing === undefined ? {} : { pricing: ctx.pricing };
}

export function toUsageDto(report: UsageReport): UsageReportDto {
  return {
    pricing: report.pricing,
    rows: report.rows.map((row) => ({
      ...row,
      lastRunAt: row.lastRunAt === null ? null : row.lastRunAt.toISOString(),
    })),
    total: report.total,
  };
}
