import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  type EvalProgressEvent,
  type EvalReport,
  evaluateAttribution,
  isAttributorName,
  loadEnv,
  parseGoldSet,
} from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface EvalOptions {
  readonly gold: string;
  readonly attributor: string;
  readonly verbose: boolean;
  readonly json: boolean;
}

const DEFAULT_GOLD = 'eval/zhe-you-xi-ye-tai-zhen-shi-le.gold.jsonl';

export function registerEval(program: Command): void {
  program
    .command('eval <editionId>')
    .description('用金标对白评测说话人归属器，不写库。金标是 JSON Lines，格式见 docs/08-eval.md')
    .option('--gold <file>', '金标文件，默认是仓库自带的《这游戏也太真实了》金标', DEFAULT_GOLD)
    .option('--attributor <name>', '说话人归属器：heuristic 或 llm', 'heuristic')
    .option('--verbose', '逐条输出错误与未归属的对白', false)
    .option('--json', '输出完整 JSON 报告而不是摘要', false)
    .action(async (editionId: string, options: EvalOptions) => {
      const attributor = options.attributor;
      if (!isAttributorName(attributor)) fail(`未知的归属器 ${attributor}，可选 heuristic 或 llm`);
      const gold = parseGoldSet(await readFile(options.gold, 'utf8'));
      const env = loadEnv();
      const report = await withDatabase((db) =>
        evaluateAttribution(db, {
          editionId,
          gold,
          attributor,
          ...(env.llm === undefined ? {} : { llm: env.llm }),
          // Progress goes to stderr so `--json > file` stays clean.
          onProgress: (event) => formatProgress(event, attributor).forEach((line) => printError(line)),
        }),
      );
      if (options.json) {
        print(JSON.stringify(report, null, 2));
        return;
      }
      formatEvalReport(report, options.verbose).forEach((line) => print(line));
    });
}

/** One line when a chapter starts and one when it finishes, so a slow model is visibly working. */
export function formatProgress(event: EvalProgressEvent, attributor: string): string[] {
  const label = `第 ${event.chapter} 章 [${event.chapterIndex}]`;
  if (event.type === 'chapter_start') {
    return [`${label}  ${event.charCount} 字，${event.goldCount} 条金标，${attributor} 归属中…`];
  }
  return [`${label}  完成，用时 ${(event.elapsedMs / 1000).toFixed(1)} s`, ...event.warnings.map((w) => `    ! ${w}`)];
}

/** Human-readable summary, one line per chapter plus optional per-item detail. Exported for tests. */
export function formatEvalReport(report: EvalReport, verbose: boolean): string[] {
  const model = report.model === undefined ? '' : `  模型 ${report.model}`;
  const usage =
    report.usage === undefined ? '' : `  token 输入 ${report.usage.inputTokens} 输出 ${report.usage.outputTokens}`;
  const lines = [
    `归属器 ${report.attributor} (${report.promptVersion})${model}`,
    `金标 ${report.total} 条：正确 ${report.correct}  错误 ${report.wrong}  未归属 ${report.unattributed}  准确率 ${percent(report.accuracy)}${usage}`,
    ...report.chapters.map(
      (c) =>
        `  第 ${c.chapter} 章 [${c.chapterIndex}]  ${c.correct}/${c.total}  错误 ${c.wrong}  未归属 ${c.unattributed}`,
    ),
  ];
  if (!verbose) return lines;
  const misses = report.items.filter((i) => i.outcome !== 'correct');
  if (misses.length === 0) return [...lines, '全部正确。'];
  return [
    ...lines,
    '',
    ...misses.map(
      (i) =>
        `  第 ${i.gold.chapter} 章  期望 ${i.expected}  得到 ${i.predicted ?? '（未归属）'} (${i.confidence.toFixed(1)})  ${truncate(i.quoteText)}`,
    ),
  ];
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

const MAX_QUOTE_PREVIEW = 40;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length <= MAX_QUOTE_PREVIEW ? flat : `${flat.slice(0, MAX_QUOTE_PREVIEW)}…`;
}
