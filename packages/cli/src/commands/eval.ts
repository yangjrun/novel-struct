import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  type EvalProgressEvent,
  type EvalReport,
  evaluateAttribution,
  isAttributorName,
  loadEnv,
  parseGoldSet,
  sampleAttributionDrafts,
  formatAttributionDrafts,
} from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface EvalOptions {
  readonly gold: string;
  readonly attributor: string;
  readonly verbose: boolean;
  readonly json: boolean;
  readonly from?: number;
  readonly to?: number;
  readonly continueOnError: boolean;
}

const DEFAULT_GOLD = 'eval/zhe-you-xi-ye-tai-zhen-shi-le.gold.jsonl';

export function registerEval(program: Command): void {
  program
    .command('eval-sample <editionId>')
    .description('从章节对白抽取人工标注候选；指定 --gold 可跳过已有金标，不生成说话人答案')
    .requiredOption('--output <file>', '写入新的 JSONL 草稿文件（不覆盖现有文件）')
    .option('--gold <file>', '可选：排除已有金标对白')
    .option('--from <number>', '起始章节标题编号', parsePositiveInt, 1)
    .option('--to <number>', '结束章节标题编号，包含', parsePositiveInt, 20)
    .option('--per-chapter <number>', '每章最多抽样条数', parsePositiveInt, 5)
    .action(
      async (
        editionId: string,
        options: { output: string; gold?: string; from: number; to: number; perChapter: number },
      ) => {
        const gold = options.gold === undefined ? undefined : parseGoldSet(await readFile(options.gold, 'utf8'));
        const drafts = await withDatabase((db) =>
          sampleAttributionDrafts(db, {
            editionId,
            from: options.from,
            to: options.to,
            perChapter: options.perChapter,
            ...(gold === undefined ? {} : { gold }),
          }),
        );
        try {
          await writeFile(options.output, formatAttributionDrafts(drafts), { flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            fail(`文件 ${options.output} 已存在，请指定新的输出路径`);
          throw error;
        }
        print(`已生成 ${drafts.length} 条人工标注候选，写入 ${options.output}`);
      },
    );
  program
    .command('eval <editionId>')
    .description('用金标对白评测说话人归属器，不写库。金标是 JSON Lines，格式见 docs/08-eval.md')
    .option('--gold <file>', '金标文件，默认是仓库自带的《这游戏也太真实了》金标', DEFAULT_GOLD)
    .option('--attributor <name>', '说话人归属器：heuristic 或 llm', 'heuristic')
    .option('--from <number>', '只评测此章节编号及之后的金标', parsePositiveInt)
    .option('--to <number>', '只评测此章节编号及之前的金标', parsePositiveInt)
    .option('--continue-on-error', '模型拒绝或归属器失败时记录失败章节并继续，汇总仅计算已评测金标', false)
    .option('--verbose', '逐条输出错误与未归属的对白', false)
    .option('--json', '输出完整 JSON 报告而不是摘要', false)
    .action(async (editionId: string, options: EvalOptions) => {
      const attributor = options.attributor;
      if (!isAttributorName(attributor)) fail(`未知的归属器 ${attributor}，可选 heuristic 或 llm`);
      const gold = parseGoldSet(await readFile(options.gold, 'utf8'));
      if (options.from !== undefined && options.to !== undefined && options.from > options.to)
        fail('--from 不能大于 --to');
      if (
        !gold.some(
          (item) =>
            (options.from === undefined || item.chapter >= options.from) &&
            (options.to === undefined || item.chapter <= options.to),
        )
      )
        fail('选定章节范围内没有金标');
      const env = loadEnv();
      const report = await withDatabase((db) =>
        evaluateAttribution(db, {
          editionId,
          gold,
          ...(options.from === undefined ? {} : { from: options.from }),
          ...(options.to === undefined ? {} : { to: options.to }),
          continueOnError: options.continueOnError,
          attributor,
          ...(env.llm === undefined ? {} : { llm: env.llm }),
          // Progress goes to stderr so `--json > file` stays clean.
          onProgress: (event) => formatProgress(event, attributor).forEach((line) => printError(line)),
        }),
      );
      if (options.json) {
        print(JSON.stringify(report, null, 2));
        if (report.failures?.length) process.exitCode = 1;
        return;
      }
      formatEvalReport(report, options.verbose).forEach((line) => print(line));
      if (report.failures?.length) process.exitCode = 1;
    });
}

function parsePositiveInt(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`参数必须是正整数，收到 ${value}`);
  return number;
}

/** One line when a chapter starts and one when it finishes, so a slow model is visibly working. */
export function formatProgress(event: EvalProgressEvent, attributor: string): string[] {
  const label = `第 ${event.chapter} 章 [${event.chapterIndex}]`;
  if (event.type === 'chapter_start') {
    return [`${label}  ${event.charCount} 字，${event.goldCount} 条金标，${attributor} 归属中…`];
  }
  if (event.type === 'chapter_failed') {
    return [
      `${label}  ${event.reason === 'provider_rejected' ? '模型服务拒绝' : '模型/归属器失败'}，用时 ${(event.elapsedMs / 1000).toFixed(1)} s；${event.goldCount} 条金标未评测：${event.error}`,
    ];
  }
  return [
    `${label}  完成，用时 ${(event.elapsedMs / 1000).toFixed(1)} s，正确 ${event.correct} 错误 ${event.wrong} 未归属 ${event.unattributed}${event.usage === undefined ? '' : `，token 输入 ${event.usage.inputTokens} 输出 ${event.usage.outputTokens}`}`,
    ...event.warnings.map((w) => `    ! ${w}`),
  ];
}

/** Human-readable summary, one line per chapter plus optional per-item detail. Exported for tests. */
export function formatEvalReport(report: EvalReport, verbose: boolean): string[] {
  const model = report.model === undefined ? '' : `  模型 ${report.model}`;
  const usage =
    report.usage === undefined ? '' : `  token 输入 ${report.usage.inputTokens} 输出 ${report.usage.outputTokens}`;
  const lines = [
    `归属器 ${report.attributor} (${report.promptVersion})${model}`,
    `金标 ${report.total} 条：正确 ${report.correct}  错误 ${report.wrong}  未归属 ${report.unattributed}  准确率 ${report.total === 0 && report.failures?.length ? '未计算（无已评测条目）' : percent(report.accuracy)}${usage}`,
    ...report.chapters.map(
      (c) =>
        `  第 ${c.chapter} 章 [${c.chapterIndex}]  ${c.correct}/${c.total}  错误 ${c.wrong}  未归属 ${c.unattributed}`,
    ),
    ...(report.failures?.length
      ? [
          `未评测 ${report.failures.reduce((total, failure) => total + failure.goldCount, 0)} / ${report.requestedTotal ?? report.total} 条：${report.failures.length} 章模型/归属器失败；准确率只按已评测条目计算。`,
          ...report.failures.map(
            (failure) =>
              `  第 ${failure.chapter} 章 [${failure.chapterIndex}]  ${failure.reason === 'provider_rejected' ? '模型服务拒绝：' : ''}${failure.error}`,
          ),
        ]
      : []),
  ];
  if (!verbose) return lines;
  const misses = report.items.filter((i) => i.outcome !== 'correct');
  if (misses.length === 0) return report.failures?.length ? lines : [...lines, '全部正确。'];
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
