import { BullJobQueue } from './bull/bull-queue.js';
import type { QueueEnv } from './env.js';
import { MemoryJobQueue } from './memory-queue.js';
import type { JobQueue, QueueDeps } from './types.js';

export interface CreateJobQueueOptions extends QueueDeps {
  readonly env: QueueEnv;
}

/** Memory queue without `REDIS_URL`, BullMQ with it. The caller owns `close()`. */
export function createJobQueue(options: CreateJobQueueOptions): JobQueue {
  const { env, ...deps } = options;
  if (env.redisUrl === undefined) return new MemoryJobQueue(deps);
  return new BullJobQueue({ ...deps, redisUrl: env.redisUrl, prefix: env.prefix, inlineWorker: env.inlineWorker });
}
