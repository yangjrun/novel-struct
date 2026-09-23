import type { Command } from 'commander';
import { createPostgresMemoryStore } from '@novelstruct/memory';
import { withDatabase } from '../context.js';
import { print } from '../output.js';

export function registerMemory(program: Command): void {
  program
    .command('memory-rebuild <bookId>')
    .description('从事实层重建该书全部版本的 PostgreSQL 记忆，原有派生记忆将被替换')
    .action(async (bookId: string) => {
      const total = await withDatabase((db) => createPostgresMemoryStore(db).rebuild(bookId));
      print(`重建记忆：${total} 条`);
    });
}
