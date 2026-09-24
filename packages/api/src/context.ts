import type { Db } from '@novelstruct/db';
import type { LlmEnv, LlmPricing, ShadowEnv } from '@novelstruct/pipeline';
import type { JobQueue } from '@novelstruct/queue';
import type { Embedder } from '@novelstruct/knowledge';
import type { Logger } from './log.js';

/** Everything a route handler may touch. Built once in `main.ts` or by a test. */
export interface AppContext {
  readonly db: Db;
  readonly databaseKind: 'pglite' | 'postgres';
  readonly llm: LlmEnv | undefined;
  readonly shadow?: ShadowEnv;
  /** Token prices for cost estimates; undefined leaves every cost null. */
  readonly pricing: LlmPricing | undefined;
  readonly jobs: JobQueue;
  readonly logger: Logger;
  /** When set, all API routes require Authorization: Bearer <token>. */
  readonly apiToken?: string;
  readonly embedder?: Embedder;
}
