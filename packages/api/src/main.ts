import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDatabase } from '@novelstruct/db';
import { loadEnv } from '@novelstruct/pipeline';
import { createApp } from './app.js';
import { JobManager } from './jobs/manager.js';
import { stdioLogger } from './log.js';

const DEFAULT_PORT = 3100;
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const DEFAULT_DATA_DIR = './data';

async function main(): Promise<void> {
  const env = loadEnv();
  const port = Number.parseInt(process.env['PORT'] ?? '', 10) || DEFAULT_PORT;
  const hostname = process.env['HOST']?.trim() || undefined;
  const staticDir = process.env['NOVELSTRUCT_WEB_DIST']?.trim();
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? DEFAULT_DEV_ORIGINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  stdioLogger.info(`工作目录 ${process.cwd()}`);
  stdioLogger.info(
    env.databaseUrl === undefined
      ? `打开 PGlite 文件库 ${path.resolve(env.dataDir ?? DEFAULT_DATA_DIR)}`
      : `连接 PostgreSQL ${redact(env.databaseUrl)}`,
  );
  const handle = await openDatabase({
    ...(env.databaseUrl === undefined ? {} : { databaseUrl: env.databaseUrl }),
    ...(env.dataDir === undefined ? {} : { dataDir: env.dataDir }),
  });
  stdioLogger.info('应用迁移');
  await handle.migrate();
  stdioLogger.info(`数据库就绪（${handle.kind}），模型 ${env.llm === undefined ? '未配置' : env.llm.model}`);

  const jobs = new JobManager({ db: handle.db, llm: env.llm, logger: stdioLogger });
  const app = createApp(
    { db: handle.db, databaseKind: handle.kind, llm: env.llm, jobs, logger: stdioLogger },
    { corsOrigins },
  );

  if (staticDir !== undefined && staticDir.length > 0) {
    app.use('/*', serveStatic({ root: staticDir }));
    app.get('/*', serveStatic({ root: staticDir, path: 'index.html' }));
    stdioLogger.info(`托管前端目录 ${path.resolve(staticDir)}`);
  }

  const server = serve({ fetch: app.fetch, port, ...(hostname === undefined ? {} : { hostname }) }, (info) => {
    stdioLogger.info(`NovelStruct API 监听 http://localhost:${info.port}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    const hint =
      error.code === 'EADDRINUSE'
        ? `端口 ${port} 已被占用，换一个 PORT`
        : error.code === 'EACCES'
          ? `端口 ${port} 不可用（Windows 上常见于被 Hyper-V/WSL 保留的端口段，可用 netsh interface ipv4 show excludedportrange protocol=tcp 查看），换一个 PORT`
          : `监听端口 ${port} 失败`;
    stdioLogger.error(hint, error);
    void handle.close().finally(() => process.exit(1));
  });

  const shutdown = (): void => {
    stdioLogger.info(jobs.isBusy() ? '有解析任务在运行，等待当前章节完成后关闭' : '正在关闭');
    server.close(() => {
      void handle.close().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@');
}

main().catch((error: unknown) => {
  stdioLogger.error('API 启动失败', error);
  process.exitCode = 1;
});
