import { type Db, openDatabase } from '@novelstruct/db';
import { loadEnv } from '@novelstruct/pipeline';
import { CliError } from './errors.js';

export { CliError } from './errors.js';

/** Opens the configured database, applies migrations, runs `fn`, and always closes the handle. */
export async function withDatabase<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const env = loadEnv();
  const handle = await openDatabase({
    ...(env.databaseUrl === undefined ? {} : { databaseUrl: env.databaseUrl }),
    ...(env.dataDir === undefined ? {} : { dataDir: env.dataDir }),
  });
  try {
    await handle.migrate();
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

/** Throws instead of exiting so open database handles are still closed by `withDatabase`. */
export function fail(message: string): never {
  throw new CliError(message);
}

export function parseIndex(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) throw new CliError(`章节 index 必须是非负整数，收到 ${value}`);
  return n;
}
