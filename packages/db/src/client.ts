import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  readonly kind: 'pglite' | 'postgres';
  readonly db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenDatabaseOptions {
  /** PostgreSQL connection string. When set, PGlite options are ignored. */
  readonly databaseUrl?: string;
  /** Directory for the PGlite file database. Defaults to ./data. */
  readonly dataDir?: string;
  /** In-memory PGlite, for tests. */
  readonly inMemory?: boolean;
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));
const PGLITE_FILE = 'novelstruct.pglite';
const DEFAULT_DATA_DIR = './data';

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<DbHandle> {
  return options.databaseUrl ? openPostgres(options.databaseUrl) : openPglite(options);
}

function openPostgres(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString });
  const db = drizzlePg(pool, { schema });
  return {
    kind: 'postgres',
    db,
    migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}

async function openPglite(options: OpenDatabaseOptions): Promise<DbHandle> {
  const client = options.inMemory ? new PGlite() : new PGlite(await pgliteDataPath(options.dataDir));
  const db = drizzlePglite(client, { schema });
  return {
    kind: 'pglite',
    db,
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

async function pgliteDataPath(dataDir: string | undefined): Promise<string> {
  const dir = path.resolve(dataDir ?? DEFAULT_DATA_DIR);
  await mkdir(dir, { recursive: true });
  return path.join(dir, PGLITE_FILE);
}
