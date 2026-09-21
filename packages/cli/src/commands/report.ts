import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { buildReportHtml } from '@novelstruct/pipeline';
import { withDatabase } from '../context.js';
import { print } from '../output.js';

interface ReportOptions {
  readonly out?: string;
}

const DEFAULT_DIR = 'reports';

export function registerReport(program: Command): void {
  program
    .command('report <editionId>')
    .description('生成一个版本的结构遍 HTML 报告：对白归属、旁白占比、角色对白与出场分布')
    .option('--out <file>', `输出路径，默认 ${DEFAULT_DIR}/<editionId>.html`)
    .action(async (editionId: string, options: ReportOptions) => {
      const html = await withDatabase((db) => buildReportHtml(db, editionId));
      const out = path.resolve(options.out ?? path.join(DEFAULT_DIR, `${editionId}.html`));
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, html, 'utf8');
      print(`报告已写入 ${out}`);
    });
}
