import type { Db } from '@novelstruct/db';
import type { LlmEnv } from '@novelstruct/pipeline';
import type { JobManager } from './jobs/manager.js';
import type { Logger } from './log.js';

/** Everything a route handler may touch. Built once in `main.ts` or by a test. */
export interface AppContext {
  readonly db: Db;
  readonly databaseKind: 'pglite' | 'postgres';
  readonly llm: LlmEnv | undefined;
  readonly jobs: JobManager;
  readonly logger: Logger;
}
