import type { Db } from '@novelstruct/db';
import type { LlmEnv } from '@novelstruct/pipeline';
import type { JobQueue } from '@novelstruct/queue';
import type { Logger } from './log.js';

/** Everything a route handler may touch. Built once in `main.ts` or by a test. */
export interface AppContext {
  readonly db: Db;
  readonly databaseKind: 'pglite' | 'postgres';
  readonly llm: LlmEnv | undefined;
  readonly jobs: JobQueue;
  readonly logger: Logger;
}
