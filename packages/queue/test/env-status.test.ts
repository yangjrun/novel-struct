import { describe, expect, it } from 'vitest';
import { parseQueueEnv } from '../src/env.js';
import { countEvents, finalStatus } from '../src/status.js';
import type { JobEventDto } from '../src/contracts.js';

const chapter = { id: 'ch_1', index: 1, kind: 'chapter', title: null } as const;
const events: readonly JobEventDto[] = [
  {
    type: 'succeeded',
    chapter,
    summary: { scenes: 1, segments: 2, newEntities: 0, mentions: 0 },
    unresolved: 0,
    warnings: [],
  },
  { type: 'skipped', chapter: { ...chapter, index: 2 }, reason: 'x' },
  { type: 'failed', chapter: { ...chapter, index: 3 }, error: 'boom' },
];

describe('parseQueueEnv', () => {
  it('defaults to the memory queue with an inline worker', () => {
    expect(parseQueueEnv({})).toEqual({ prefix: 'novelstruct', inlineWorker: true, concurrency: 1 });
  });

  it('reads Redis settings, the inline-worker switch and the concurrency', () => {
    expect(
      parseQueueEnv({
        REDIS_URL: ' redis://x:6379 ',
        QUEUE_PREFIX: 'ns',
        QUEUE_INLINE_WORKER: 'false',
        QUEUE_CONCURRENCY: '4',
      }),
    ).toEqual({
      redisUrl: 'redis://x:6379',
      prefix: 'ns',
      inlineWorker: false,
      concurrency: 4,
    });
    expect(() => parseQueueEnv({ QUEUE_CONCURRENCY: '0' })).toThrow(/正整数/);
  });
});

describe('status helpers', () => {
  it('counts events by type', () => {
    expect(countEvents(events, false)).toEqual({ succeeded: 1, failed: 1, skipped: 1, stopped: false });
  });

  it('derives the final status', () => {
    expect(finalStatus({ succeeded: 1, failed: 0, skipped: 0, stopped: false }, false)).toBe('succeeded');
    expect(finalStatus({ succeeded: 1, failed: 1, skipped: 0, stopped: false }, false)).toBe('failed');
    expect(finalStatus({ succeeded: 1, failed: 1, skipped: 0, stopped: true }, true)).toBe('cancelled');
  });
});
