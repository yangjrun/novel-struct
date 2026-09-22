import { type Db, getEdition, summarizeUsage, type UsageRow } from '@novelstruct/db';
import type { LlmPricing } from './env.js';
import { PipelineError } from './errors.js';

export interface TokenCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A usage row with its cost at the configured prices; null when no prices are configured or no model was involved. */
export interface UsageLine extends UsageRow {
  readonly cost: number | null;
}

export interface UsageTotal extends TokenCounts {
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Sum of the priced rows; null when no prices are configured. */
  readonly cost: number | null;
}

export interface UsageReport {
  readonly pricing: LlmPricing | null;
  readonly rows: readonly UsageLine[];
  readonly total: UsageTotal;
}

export interface UsageReportOptions {
  /** Restrict to one edition; must exist. */
  readonly editionId?: string;
  readonly pricing?: LlmPricing;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Cost of a token count at the given prices, in the pricing currency. */
export function estimateCost(tokens: TokenCounts, pricing: LlmPricing): number {
  return (
    (tokens.inputTokens * pricing.inputPerMillion + tokens.outputTokens * pricing.outputPerMillion) /
    TOKENS_PER_PRICE_UNIT
  );
}

/**
 * Token usage per edition, attributor and model, with an estimated cost. One price pair applies
 * to every model-backed run, so the estimate is "at today's prices", not a ledger of what each
 * historical run cost.
 */
export async function buildUsageReport(db: Db, options: UsageReportOptions = {}): Promise<UsageReport> {
  if (options.editionId !== undefined && (await getEdition(db, options.editionId)) === undefined) {
    throw new PipelineError('not_found', `版本 ${options.editionId} 不存在`);
  }
  const pricing = options.pricing ?? null;
  const rows = (await summarizeUsage(db, options.editionId === undefined ? {} : { editionId: options.editionId })).map(
    (row): UsageLine => ({
      ...row,
      cost: pricing === null || row.model === null ? null : estimateCost(row, pricing),
    }),
  );
  return { pricing, rows, total: totalOf(rows, pricing) };
}

function totalOf(rows: readonly UsageLine[], pricing: LlmPricing | null): UsageTotal {
  const sum = (pick: (row: UsageLine) => number): number => rows.reduce((acc, row) => acc + pick(row), 0);
  return {
    runs: sum((r) => r.runs),
    succeeded: sum((r) => r.succeeded),
    failed: sum((r) => r.failed),
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
    cost: pricing === null ? null : sum((r) => r.cost ?? 0),
  };
}
