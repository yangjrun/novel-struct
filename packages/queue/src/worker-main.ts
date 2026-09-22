import path from 'node:path';
import { openDatabase, sweepStaleBookLocks, sweepStaleRuns } from '@novelstruct/db';
import { loadEnv, STALE_RUN_AFTER_MS } from '@novelstruct/pipeline';
import { createRedisConnection } from './bull/connection.js';
import { ParseWorker } from './bull/worker.js';
import { parseQueueEnv } from './env.js';
import { stdioLogger } from './log.js';

const DEFAULT_DATA_DIR = './data';

/**
 * Dedicated parse worker: `pnpm worker` from the repository root. Needs `REDIS_URL`; reads the
 * same `.env` and database as the API. Run the API with `QUEUE_INLINE_WORKER=false` so only one
 * worker touches a book at a time.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const queueEnv = parseQueueEnv(process.env);
  if (queueEnv.redisUrl === undefined) {
    stdioLogger.error('worker 需要 REDIS_URL；没有 Redis 时 API 自带内存队列，不需要单独的 worker');
    process.exitCode = 1;
    return;
  }

  stdioLogger.info(`工作目录 ${process.cwd()}`);
  stdioLogger.info(
    env.databaseUrl === undefined
      ? `打开 PGlite 文件库 ${path.resolve(env.dataDir ?? DEFAULT_DATA_DIR)}（注意：PGlite 文件库同一时刻只能被一个进程打开）`
      : `连接 PostgreSQL ${redact(env.databaseUrl)}`,
  );
  const handle = await openDatabase({
    ...(env.databaseUrl === undefined ? {} : { databaseUrl: env.databaseUrl }),
    ...(env.dataDir === undefined ? {} : { dataDir: env.dataDir }),
  });
  await handle.migrate();
  const staleAfterMs = handle.kind === 'pglite' ? 0 : STALE_RUN_AFTER_MS;
  const swept = await sweepStaleRuns(handle.db, staleAfterMs);
  if (swept.length > 0) stdioLogger.info(`${swept.length} 条上次未完成的解析记录标记为已中断`);
  const locks = await sweepStaleBookLocks(handle.db, staleAfterMs);
  if (locks.length > 0) stdioLogger.info(`释放了 ${locks.length} 把过期的书锁`);

  const connection = createRedisConnection(queueEnv.redisUrl);
  const worker = new ParseWorker({
    deps: { db: handle.db, llm: env.llm, logger: stdioLogger },
    connection,
    prefix: queueEnv.prefix,
    concurrency: queueEnv.concurrency,
  });
  await worker.waitUntilReady();
  stdioLogger.info(
    `worker 就绪：Redis ${redact(queueEnv.redisUrl)}，前缀 ${queueEnv.prefix}，并发 ${queueEnv.concurrency}，模型 ${env.llm === undefined ? '未配置' : env.llm.model}`,
  );

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    stdioLogger.info('正在关闭，等待当前章节完成');
    void worker
      .close()
      .then(() => connection.quit())
      .then(() => handle.close())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@');
}

main().catch((error: unknown) => {
  stdioLogger.error('worker 启动失败', error);
  process.exitCode = 1;
});
