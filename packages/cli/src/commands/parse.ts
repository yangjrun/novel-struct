import type { Command } from 'commander';
import {
  DEFAULT_MAX_ATTEMPTS,
  isAttributorName,
  loadEnv,
  type ParseChapterEvent,
  parseEdition,
  parseEditionConsistency,
} from '@novelstruct/pipeline';
import { fail, parseIndex, withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface ParseOptions {
  readonly from: number;
  readonly to?: number;
  readonly attributor: string;
  readonly force: boolean;
  readonly allKinds: boolean;
  readonly maxAttempts: number;
}

export function registerParse(program: Command): void {
  program
    .command('parse-consistency <editionId>')
    .description('按章顺序运行 LLM 一致性遍（须先完成结构遍）')
    .option('--from <index>', '起始章节 index', parseIndex, 0)
    .option('--to <index>', '结束章节 index，包含', parseIndex)
    .option('--budget <number>', 'Context Builder 上限', parsePositiveInt, 3000)
    .option('--all-kinds', '包括作者留言与前言（默认不解析）', false)
    .action(async (editionId: string, options: { from: number; to?: number; budget: number; allKinds: boolean }) => {
      const env = loadEnv();
      if (!env.llm) fail('先设置 LLM_API_KEY 和 LLM_MODEL');
      const result = await withDatabase((db) =>
        parseEditionConsistency(db, {
          editionId,
          llm: env.llm!,
          ...(env.shadow ? { shadow: env.shadow } : {}),
          from: options.from,
          ...(options.to === undefined ? {} : { to: options.to }),
          budget: options.budget,
          allKinds: options.allKinds,
          onEvent: (event) => print(`[${event.chapterIndex}] ${event.status}: ${event.message}`),
        }),
      );
      print(`一致性遍：成功 ${result.succeeded} 跳过 ${result.skipped} 失败 ${result.failed}`);
      if (result.failed) process.exitCode = 1;
    });
  program
    .command('parse <editionId>')
    .description('对一个版本的章节运行结构遍，结果写入数据库')
    .option('--from <index>', '起始章节 index，从 0 开始', parseIndex, 0)
    .option('--to <index>', '结束章节 index，包含', parseIndex)
    .option('--attributor <name>', '说话人归属器：heuristic 或 llm', 'heuristic')
    .option('--force', '忽略已成功的解析记录和失败次数上限，强制重跑', false)
    .option('--all-kinds', '包括作者留言与前言（默认不解析）', false)
    .option(
      '--max-attempts <n>',
      '同一章用同一归属器与提示词失败这么多次后跳过，直到加 --force',
      parsePositiveInt,
      DEFAULT_MAX_ATTEMPTS,
    )
    .action(async (editionId: string, options: ParseOptions) => {
      const attributor = options.attributor;
      if (!isAttributorName(attributor)) fail(`未知的归属器 ${attributor}，可选 heuristic 或 llm`);
      const env = loadEnv();
      const result = await withDatabase((db) =>
        parseEdition(
          db,
          {
            editionId,
            from: options.from,
            ...(options.to === undefined ? {} : { to: options.to }),
            attributor,
            force: options.force,
            allKinds: options.allKinds,
            maxAttempts: options.maxAttempts,
            ...(env.llm === undefined ? {} : { llm: env.llm }),
            ...(env.shadow === undefined ? {} : { shadow: env.shadow }),
          },
          { onEvent: printEvent },
        ),
      );
      print(`完成：成功 ${result.succeeded}  跳过 ${result.skipped}  失败 ${result.failed}`);
      if (result.blockedBy !== undefined) {
        printError(`这本书正在被 ${result.blockedBy} 解析，本次没有处理剩余章节；等它结束后再运行`);
        process.exitCode = 1;
      }
      if (result.failed > 0) process.exitCode = 1;
    });
}

/** One line per chapter, plus indented warnings. Exported for tests. */
export function formatEvent(event: ParseChapterEvent): string[] {
  const label = `[${event.chapter.index}] ${event.chapter.title ?? event.chapter.kind}`;
  switch (event.type) {
    case 'skipped':
      return [`${label}  跳过，${event.reason}`];
    case 'failed':
      return [`${label}  失败: ${event.error}`];
    case 'succeeded': {
      const s = event.summary;
      const tokens =
        event.usage === undefined ? '' : `  token 输入 ${event.usage.inputTokens} 输出 ${event.usage.outputTokens}`;
      return [
        `${label}  场景 ${s.scenes}  分段 ${s.segments}  新实体 ${s.newEntities}  提及 ${s.mentions}  未消解对白 ${event.unresolved}${tokens}`,
        ...event.warnings.map((w) => `    ! ${w}`),
      ];
    }
  }
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`--max-attempts 必须是正整数，收到 ${value}`);
  return n;
}

function printEvent(event: ParseChapterEvent): void {
  const lines = formatEvent(event);
  if (event.type === 'failed') lines.forEach((line) => printError(line));
  else lines.forEach((line) => print(line));
}
