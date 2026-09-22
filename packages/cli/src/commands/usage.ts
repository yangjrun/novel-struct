import type { Command } from 'commander';
import { buildUsageReport, loadEnv, type UsageLine, type UsageReport } from '@novelstruct/pipeline';
import { withDatabase } from '../context.js';
import { print } from '../output.js';

export function registerUsage(program: Command): void {
  program
    .command('usage [editionId]')
    .description('统计解析记录的 token 用量与估算成本，按版本、归属器、模型分组；不给版本则统计全库')
    .action(async (editionId: string | undefined) => {
      const env = loadEnv();
      const report = await withDatabase((db) =>
        buildUsageReport(db, {
          ...(editionId === undefined ? {} : { editionId }),
          ...(env.pricing === undefined ? {} : { pricing: env.pricing }),
        }),
      );
      formatUsageReport(report).forEach((line) => print(line));
    });
}

/** One line per edition, attributor and model, then a total. Exported for tests. */
export function formatUsageReport(report: UsageReport): string[] {
  if (report.rows.length === 0) return ['还没有解析记录。'];
  const header =
    report.pricing === null
      ? '未设置 LLM_PRICE_INPUT / LLM_PRICE_OUTPUT，只统计 token，不估算成本'
      : `单价：每百万 token 输入 ${report.pricing.inputPerMillion} 输出 ${report.pricing.outputPerMillion} ${report.pricing.currency}`;
  const total = report.total;
  return [
    header,
    ...report.rows.map((row) => formatRow(row, report)),
    `合计  运行 ${total.runs}（成功 ${total.succeeded} 失败 ${total.failed}）  输入 ${total.inputTokens}  输出 ${total.outputTokens}${formatCost(total.cost, report)}`,
  ];
}

function formatRow(row: UsageLine, report: UsageReport): string {
  const who = `${row.attributor}${row.model === null ? '' : `/${row.model}`}`;
  return `${row.bookTitle} ${row.editionLabel}  ${who}  运行 ${row.runs}（成功 ${row.succeeded} 失败 ${row.failed}）  章 ${row.chapters}  输入 ${row.inputTokens}  输出 ${row.outputTokens}${formatCost(row.cost, report)}`;
}

function formatCost(cost: number | null, report: UsageReport): string {
  if (cost === null || report.pricing === null) return '';
  return `  成本 ${cost.toFixed(4)} ${report.pricing.currency}`;
}
