import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { createJevJudge, evaluateShadow, loadEnv, parseShadowGold } from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print } from '../output.js';

export function registerEvalShadow(program: Command): void {
  program
    .command('eval-shadow <editionId>')
    .description('用中文金标评测 Jev 的对白/事实影子复核；只读，不修改解析结果')
    .option('--gold <file>', '标注的 JSONL', 'eval/jev-shadow.gold.jsonl')
    .option('--json', '输出完整 JSON 报告', false)
    .action(async (editionId: string, options: { gold: string; json: boolean }) => {
      const config = loadEnv().shadow;
      if (!config) fail('请设置 TYPESAFE_API_KEY 后再运行 Jev 评测');
      const gold = parseShadowGold(await readFile(options.gold, 'utf8'));
      const report = await withDatabase((db) => evaluateShadow(db, editionId, gold, createJevJudge(config)));
      if (options.json) print(JSON.stringify(report, null, 2));
      else {
        print(
          `${report.model}：标注 ${report.requested}，已评测 ${report.assessed}，正确 ${report.correct}，错误 ${report.wrong}，不确定 ${report.uncertain}，准确率 ${report.accuracy === null ? '未计算' : `${(report.accuracy * 100).toFixed(1)}%`}`,
        );
        print(
          `  引号用途 ${report.quote.correct}/${report.quote.assessed}；证据支持 ${report.evidence.correct}/${report.evidence.assessed}`,
        );
        print(`  已存结构遍引号用途 ${report.mainQuote.correct}/${report.mainQuote.assessed}（仅统计已解析章节）`);
        print(
          `  对照主解析：检出错误 ${report.disagreements.detectedErrors}，误报 ${report.disagreements.falseAlarms}，漏检 ${report.disagreements.missedErrors}`,
        );
        if (report.missedByExtractor.length) print(`  引号抽取器未找到 ${report.missedByExtractor.length} 条金标候选`);
        report.items
          .filter((item) => !item.correct)
          .forEach((item) =>
            print(
              `  第 ${item.gold.chapter} 章 ${item.gold.quote}：预期 ${item.gold.expected}，得到 ${item.predicted}`,
            ),
          );
        report.failures.forEach((failure) => print(`  第 ${failure.chapter} 章未评测：${failure.error}`));
      }
      if (report.failures.length || report.missedByExtractor.length) process.exitCode = 1;
    });
}
