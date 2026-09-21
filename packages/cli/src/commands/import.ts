import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { importBook, type ImportBookResult } from '@novelstruct/pipeline';
import { withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface ImportOptions {
  readonly title: string;
  readonly author?: string;
  readonly label: string;
}

export function registerImport(program: Command): void {
  program
    .command('import <file>')
    .description('导入一本 TXT 小说：规范化、切章、写入数据库。同名同标签再次导入会原地更新并保留章节 ID')
    .requiredOption('--title <title>', '书名')
    .option('--author <author>', '作者')
    .option('--label <label>', '版本标签', 'v1')
    .action(async (file: string, options: ImportOptions) => {
      const bytes = new Uint8Array(await readFile(file));
      const result = await withDatabase((db) =>
        importBook(db, {
          bytes,
          title: options.title,
          ...(options.author === undefined ? {} : { author: options.author }),
          label: options.label,
          filename: file,
        }),
      );
      const { normalized } = result;
      if (normalized.replacedSequences > 0) {
        printError(`警告：文件按 UTF-8 解码时有 ${normalized.replacedSequences} 处无效字节被替换为 U+FFFD`);
      }
      normalized.warnings.forEach((w) => printError(`警告：${w}`));
      formatImportSummary(result).forEach((line) => print(line));
      for (const chapter of normalized.chapters) {
        const label = chapter.title ?? chapter.headingRaw ?? '';
        print(`  [${chapter.index}] ${chapter.kind.padEnd(12)} ${label}  (${chapter.text.length} 字)`);
      }
    });
}

/** Header lines of the import output. Exported for tests. */
export function formatImportSummary(
  result: Pick<ImportBookResult, 'bookId' | 'editionId' | 'chapterCount' | 'volumeCount' | 'reimport'> & {
    readonly normalized: { readonly encoding: string };
  },
): string[] {
  const head = [
    `书籍 ${result.bookId}`,
    `版本 ${result.editionId}  编码 ${result.normalized.encoding}  卷 ${result.volumeCount}  章 ${result.chapterCount}`,
  ];
  const r = result.reimport;
  if (r === undefined) return head;
  return [
    ...head,
    `重复导入：章节 ID 已复用，未变 ${r.kept}  内容更新 ${r.updated}  新增 ${r.added}  删除 ${r.removed}`,
  ];
}
