import { describe, expect, it } from 'vitest';
import type { KnownEntity } from '@novelstruct/core';
import { findMentions, resolveEntities, resolveSpeaker } from '../src/index.js';

const known: KnownEntity[] = [
  { id: 'ent_lin', type: 'character', canonicalName: '沈青崖', aliases: ['青崖哥'] },
  { id: 'ent_town', type: 'location', canonicalName: '云来镇', aliases: [] },
];

describe('resolveEntities', () => {
  it('matches known entities by canonical name or alias and keeps their id', () => {
    const resolved = resolveEntities(known, [
      { type: 'character', name: '青崖哥', aliases: ['青崖'], confidence: 0.9 },
    ]);
    expect(resolved.entities).toEqual([
      { id: 'ent_lin', type: 'character', canonicalName: '沈青崖', aliases: ['青崖'], isNew: false, confidence: 0.9 },
    ]);
    expect(resolveSpeaker(resolved, '青崖')).toBe('ent_lin');
    expect(resolveSpeaker(resolved, '青崖哥')).toBe('ent_lin');
  });

  it('creates new entities for unknown names', () => {
    const resolved = resolveEntities(known, [{ type: 'character', name: '铁老', aliases: [], confidence: 0.5 }]);
    const entity = resolved.entities[0]!;
    expect(entity.isNew).toBe(true);
    expect(entity.id.startsWith('ent_')).toBe(true);
    expect(resolveSpeaker(resolved, '铁老')).toBe(entity.id);
  });

  it('does not match across types', () => {
    const resolved = resolveEntities(known, [{ type: 'item', name: '云来镇', aliases: [], confidence: 0.5 }]);
    expect(resolved.entities[0]?.isNew).toBe(true);
    expect(resolveSpeaker(resolved, '云来镇')).toBeUndefined();
  });

  it('merges duplicate reports of the same new entity within a chapter and keeps it new', () => {
    const resolved = resolveEntities(
      [],
      [
        { type: 'character', name: '顾小满', aliases: ['小满'], confidence: 0.5 },
        { type: 'character', name: '小满', aliases: [], confidence: 0.8 },
      ],
    );
    expect(resolved.entities).toHaveLength(1);
    expect(resolved.entities[0]).toMatchObject({
      canonicalName: '顾小满',
      aliases: ['小满'],
      confidence: 0.8,
      isNew: true,
    });
  });

  it('reports a known entity as not new even when its alias is reported twice', () => {
    const resolved = resolveEntities(known, [
      { type: 'character', name: '沈青崖', aliases: ['青崖'], confidence: 0.9 },
      { type: 'character', name: '青崖', aliases: [], confidence: 0.7 },
    ]);
    expect(resolved.entities).toHaveLength(1);
    expect(resolved.entities[0]).toMatchObject({ id: 'ent_lin', isNew: false, aliases: ['青崖'] });
  });
});

describe('findMentions', () => {
  it('finds every occurrence and prefers the longest surface on overlap', () => {
    const text = '沈青崖看着青崖哥的剑。青崖没有说话。';
    const mentions = findMentions(text, [{ id: 'ent_lin', names: ['沈青崖', '青崖哥', '青崖'] }]);
    expect(mentions.map((m) => [m.surface, text.slice(m.charStart, m.charEnd)])).toEqual([
      ['沈青崖', '沈青崖'],
      ['青崖哥', '青崖哥'],
      ['青崖', '青崖'],
    ]);
  });

  it('ignores single character names', () => {
    expect(findMentions('他来了', [{ id: 'x', names: ['他'] }])).toEqual([]);
  });
});
