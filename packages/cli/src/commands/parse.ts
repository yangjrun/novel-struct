import type { Command } from 'commander';
import { isAttributorName, loadEnv, type ParseChapterEvent, parseEdition } from '@novelstruct/pipeline';
import { fail, parseIndex, withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface ParseOptions {
  readonly from: number;
  readonly to?: number;
  readonly attributor: string;
  readonly force: boolean;
}

export function registerParse(program: Command): void {
  program
    .command('parse <editionId>')
    .description('对一个版本的章节运行结构遍，结果写入数据库')
    .option('--from <index>', '起始章节 index，从 0 开始', parseIndex, 0)
    .option('--to <index>', '结束章节 index，包含', parseIndex)
    .option('--attributor <name>', '说话人归属器：heuristic 或 llm', 'heuristic')
    .option('--force', '忽略已成功的解析记录，强制重跑', false)
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
            ...(env.llm === undefined ? {} : { llm: env.llm }),
          },
          { onEvent: printEvent },
        ),
      );
      print(`完成：成功 ${result.succeeded}  跳过 ${result.skipped}  失败 ${result.failed}`);
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
      return [
        `${label}  场景 ${s.scenes}  分段 ${s.segments}  新实体 ${s.newEntities}  提及 ${s.mentions}  未消解对白 ${event.unresolved}`,
        ...event.warnings.map((w) => `    ! ${w}`),
      ];
    }
  }
}

function printEvent(event: ParseChapterEvent): void {
  const lines = formatEvent(event);
  if (event.type === 'failed') lines.forEach((line) => printError(line));
  else lines.forEach((line) => print(line));
}
