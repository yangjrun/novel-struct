import type { Command } from 'commander';
import { listBooks } from '@novelstruct/db';
import { withDatabase } from '../context.js';
import { print } from '../output.js';

export function registerBooks(program: Command): void {
  program
    .command('books')
    .description('列出小说库中的书和版本')
    .action(async () => {
      const books = await withDatabase((db) => listBooks(db));
      if (books.length === 0) {
        print('小说库为空，先运行 import。');
        return;
      }
      for (const book of books) {
        print(`${book.id}  ${book.title}${book.author ? `  ${book.author}` : ''}`);
        for (const edition of book.editions) {
          print(`  版本 ${edition.id}  ${edition.label}  ${edition.chapterCount} 章`);
        }
      }
    });
}
