import { describe, expect, it } from 'vitest';
import { formatEvent } from '../src/commands/parse.js';

const chapter = { id: 'chp_1', index: 3, kind: 'chapter' as const, title: '夜谈' };

describe('formatEvent', () => {
  it('formats a success with warnings', () => {
    expect(
      formatEvent({
        type: 'succeeded',
        chapter,
        summary: { scenes: 2, segments: 10, newEntities: 1, mentions: 4 },
        unresolved: 1,
        warnings: ['odd quote'],
      }),
    ).toEqual(['[3] 夜谈  场景 2  分段 10  新实体 1  提及 4  未消解对白 1', '    ! odd quote']);
  });

  it('formats skips and failures, falling back to the kind when untitled', () => {
    expect(formatEvent({ type: 'skipped', chapter, reason: '已有记录' })).toEqual(['[3] 夜谈  跳过，已有记录']);
    expect(formatEvent({ type: 'failed', chapter: { ...chapter, title: null }, error: 'boom' })).toEqual([
      '[3] chapter  失败: boom',
    ]);
  });
});
