import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { DbHandle } from '../../src/client.js';
import * as schema from '../../src/schema/index.js';

export interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface LoggedDatabase extends DbHandle {
  readonly queries: readonly RecordedQuery[];
  clearQueries(): void;
}

/** Counts executed SQL, including bound parameters, without changing production database configuration. */
export function createLoggedDatabase(): LoggedDatabase {
  const client = new PGlite({ extensions: { vector } });
  let queries: readonly RecordedQuery[] = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery: (sql, params) => {
        queries = [...queries, { sql, params: [...params] }];
      },
    },
  });
  return {
    kind: 'pglite',
    db,
    migrate: () => migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) }),
    close: () => client.close(),
    get queries() {
      return queries;
    },
    clearQueries() {
      queries = [];
    },
  };
}
