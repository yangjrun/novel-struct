import { Command } from 'commander';
import { PipelineError } from '@novelstruct/pipeline';
import { registerBench } from './commands/bench.js';
import { registerBooks } from './commands/books.js';
import { registerDelete } from './commands/delete.js';
import { registerEval } from './commands/eval.js';
import { registerEvalShadow } from './commands/eval-shadow.js';
import { registerImport } from './commands/import.js';
import { registerParse } from './commands/parse.js';
import { registerReport } from './commands/report.js';
import { registerSearch } from './commands/search.js';
import { registerMemory } from './commands/memory.js';
import { registerShow } from './commands/show.js';
import { registerUsage } from './commands/usage.js';
import { CliError } from './errors.js';
import { printError } from './output.js';

const program = new Command()
  .name('novelstruct')
  .description('小说结构化命令行。默认使用本地 PGlite 文件库，设置 DATABASE_URL 后使用 PostgreSQL。')
  .version('0.1.0');

registerImport(program);
registerBooks(program);
registerDelete(program);
registerParse(program);
registerShow(program);
registerReport(program);
registerEval(program);
registerEvalShadow(program);
registerUsage(program);
registerBench(program);
registerSearch(program);
registerMemory(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CliError || error instanceof PipelineError) {
    printError(error.message);
  } else {
    printError(`未预期的错误: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  process.exitCode = 1;
}
