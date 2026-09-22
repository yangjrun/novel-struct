export interface QueueEnv {
  /** Unset means the in-process memory queue. */
  readonly redisUrl?: string;
  /** Key prefix shared by every queue of one deployment. */
  readonly prefix: string;
  /** Whether the API process should also run a worker. Off when dedicated workers exist. */
  readonly inlineWorker: boolean;
}

export const DEFAULT_QUEUE_PREFIX = 'novelstruct';
const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off']);

/**
 * Queue settings from environment-shaped input. `REDIS_URL` selects BullMQ; without it the
 * API keeps the memory queue and needs nothing installed, matching the PGlite default.
 */
export function parseQueueEnv(env: Readonly<Record<string, string | undefined>>): QueueEnv {
  const redisUrl = nonEmpty(env['REDIS_URL']);
  const inline = nonEmpty(env['QUEUE_INLINE_WORKER']);
  return {
    ...(redisUrl === undefined ? {} : { redisUrl }),
    prefix: nonEmpty(env['QUEUE_PREFIX']) ?? DEFAULT_QUEUE_PREFIX,
    inlineWorker: inline === undefined || !FALSE_VALUES.has(inline.toLowerCase()),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
