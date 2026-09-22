import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { listBooks } from '@novelstruct/db';
import { deleteBookSafely } from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print } from '../output.js';

interface DeleteOptions {
  readonly yes: boolean;
}

export interface ConfirmInput {
  readonly yes: boolean;
  readonly isTty: boolean;
  /** What the user typed, once asked; undefined when not asked. */
  readonly answer?: string;
}

/** Only `y` / `yes` (any case) confirms; `--yes` skips the question; a pipe without `--yes` is refused. */
export function shouldProceed(input: ConfirmInput): boolean {
  if (input.yes) return true;
  if (!input.isTty) fail('非交互环境请加 --yes 确认删除');
  return /^y(es)?$/i.test((input.answer ?? '').trim());
}

export function registerDelete(program: Command): void {
  program
    .command('delete <bookId>')
    .description('删除一本书及其全部版本、章节、解析结果和实体，不可恢复')
    .option('--yes', '不询问，直接删除', false)
    .action(async (bookId: string, options: DeleteOptions) => {
      const result = await withDatabase(async (db) => {
        const book = (await listBooks(db)).find((b) => b.id === bookId);
        if (book === undefined) fail(`书 ${bookId} 不存在`);
        const chapters = book.editions.reduce((sum, e) => sum + e.chapterCount, 0);
        print(
          `《${book.title}》${book.author ? `  ${book.author}` : ''}  ${book.editions.length} 个版本  ${chapters} 章`,
        );

        const isTty = process.stdin.isTTY === true;
        const answer = options.yes || !isTty ? undefined : await ask('输入 y 确认删除：');
        if (!shouldProceed({ yes: options.yes, isTty, answer })) return undefined;
        return deleteBookSafely(db, bookId);
      });
      if (result === undefined) {
        print('已取消。');
        return;
      }
      print(`已删除《${result.title}》：${result.editions} 个版本，${result.chapters} 章`);
    });
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
