import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from './context.js';
import { toErrorReply } from './errors.js';
import { fail } from './respond.js';
import { bookRoutes } from './routes/books.js';
import { configRoutes } from './routes/config.js';
import { editionRoutes } from './routes/editions.js';
import { jobRoutes, parseJobRoutes } from './routes/jobs.js';

export interface CreateAppOptions {
  /** Origins allowed to call the API from a browser; the Vite dev server in development. */
  readonly corsOrigins?: readonly string[];
}

/**
 * Builds the Hono app; every JSON route lives under /api and answers with the envelope,
 * including 404s for unknown /api paths, so a static SPA fallback mounted later never
 * swallows an API miss. Pure with respect to the context it receives.
 */
export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  if (options.corsOrigins !== undefined && options.corsOrigins.length > 0) {
    app.use('/api/*', cors({ origin: [...options.corsOrigins] }));
  }

  app.route('/api/config', configRoutes(ctx));
  app.route('/api/books', bookRoutes(ctx));
  app.route('/api/editions', parseJobRoutes(ctx));
  app.route('/api/editions', editionRoutes(ctx));
  app.route('/api/jobs', jobRoutes(ctx));
  app.all('/api/*', (c) => fail(c, `没有这个接口: ${c.req.method} ${c.req.path}`, 404));
  app.get('/health', (c) => c.json({ ok: true }));

  app.onError((error, c) => {
    const reply = toErrorReply(error);
    if (reply.unexpected) ctx.logger.error(`${c.req.method} ${c.req.path} 失败`, error);
    return fail(c, reply.message, reply.status);
  });
  return app;
}
