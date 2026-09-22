import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { importBook, type ImportBookResult, titleFromFilename } from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print, printError } from '../output.js';

interface ImportOptions {
  readonly title?: string;
  readonly author?: string;
  readonly label: string;
}

const NOVEL_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.epub']);

export function registerImport(program: Command): void {
  program
    .command('import <paths...>')
    .description(
      '导入 TXT 或 EPUB 小说：规范化、切章、写入数据库。可给多个文件或目录，目录下的 .txt 和 .epub 逐个导入；' +
        '没给 --title 时书名和作者从文件名取（书名(作者).txt）。同名同标签再次导入会原地更新并保留章节 ID',
    )
    .option('--title <title>', '书名；只在导入单个文件时可用，EPUB 可省略，取文件自带的元数据')
    .option('--author <author>', '作者；只在导入单个文件时可用')
    .option('--label <label>', '版本标签', 'v1')
    .action(async (paths: string[], options: ImportOptions) => {
      const files = await collectNovelFiles(paths);
      if (files.length === 0) fail('没有找到 .txt 或 .epub 文件');
      if (files.length > 1 && (options.title !== undefined || options.author !== undefined)) {
        fail('--title 和 --author 只能在导入单个文件时使用');
      }
      if (files.length === 1) {
        await importSingle(files[0]!, options);
        return;
      }
      const failures = await importMany(files, options.label);
      print(`导入完成：成功 ${files.length - failures}，失败 ${failures}`);
      if (failures > 0) process.exitCode = 1;
    });
}

/**
 * Files to import: a directory contributes its .txt and .epub entries (not recursively, sorted),
 * a file is taken as given. Duplicates are dropped, order is preserved.
 */
export async function collectNovelFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const given of paths) {
    const info = await stat(given).catch(() => undefined);
    if (info === undefined) fail(`找不到 ${given}`);
    if (info.isDirectory()) {
      const entries = (await readdir(given, { withFileTypes: true }))
        .filter((e) => e.isFile() && NOVEL_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
        .map((e) => path.join(given, e.name))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
      files.push(...entries);
    } else {
      files.push(given);
    }
  }
  return [...new Set(files)];
}

/** Title and author for a file without explicit options: TXT from its name, EPUB from its own metadata. */
export function inferredMeta(file: string): { readonly title?: string; readonly author?: string } {
  if (path.extname(file).toLowerCase() === '.epub') return {};
  return titleFromFilename(file);
}

async function importSingle(file: string, options: ImportOptions): Promise<void> {
  const bytes = new Uint8Array(await readFile(file));
  const inferred = inferredMeta(file);
  const title = options.title ?? inferred.title;
  const author = options.author ?? inferred.author;
  const result = await withDatabase((db) =>
    importBook(db, {
      bytes,
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
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
}

/** One line per file; a failure is reported and skipped so one bad file does not stop the batch. */
async function importMany(files: readonly string[], label: string): Promise<number> {
  let failures = 0;
  await withDatabase(async (db) => {
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await readFile(file));
        const result = await importBook(db, { bytes, ...inferredMeta(file), label, filename: file });
        print(formatBatchLine(file, result));
        result.normalized.warnings.forEach((w) => printError(`  警告：${w}`));
      } catch (error) {
        failures += 1;
        printError(`失败 ${file}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return failures;
}

type BatchLineInput = Pick<ImportBookResult, 'title' | 'author' | 'chapterCount' | 'reimport'> & {
  readonly normalized: { readonly format: string };
};

/** `导入 书名  作者  txt  1180 章`, or `更新` with the reimport counts. Exported for tests. */
export function formatBatchLine(file: string, result: BatchLineInput): string {
  const who = `${result.title}${result.author === undefined ? '' : `  ${result.author}`}`;
  const base = `${who}  ${result.normalized.format}  ${result.chapterCount} 章  ${path.basename(file)}`;
  const r = result.reimport;
  if (r === undefined) return `导入 ${base}`;
  return `更新 ${base}（未变 ${r.kept} 更新 ${r.updated} 新增 ${r.added} 删除 ${r.removed}）`;
}

type ImportSummaryInput = Pick<
  ImportBookResult,
  'bookId' | 'editionId' | 'title' | 'author' | 'chapterCount' | 'volumeCount' | 'reimport'
> & {
  readonly normalized: { readonly format: string; readonly encoding: string };
};

/** Header lines of the import output. Exported for tests. */
export function formatImportSummary(result: ImportSummaryInput): string[] {
  const head = [
    `书籍 ${result.bookId}  ${result.title}${result.author === undefined ? '' : `  ${result.author}`}`,
    `版本 ${result.editionId}  格式 ${result.normalized.format}  编码 ${result.normalized.encoding}  卷 ${result.volumeCount}  章 ${result.chapterCount}`,
  ];
  const r = result.reimport;
  if (r === undefined) return head;
  return [
    ...head,
    `重复导入：章节 ID 已复用，未变 ${r.kept}  内容更新 ${r.updated}  新增 ${r.added}  删除 ${r.removed}`,
  ];
}
