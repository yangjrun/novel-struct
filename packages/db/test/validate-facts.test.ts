import { expect, it } from 'vitest';
import { validateFactBatch } from '../src/repositories/validate-facts.js';

const event = {
  type: '交易',
  summary: '交换了电池',
  actorId: 'ent_a',
  evidence: { quote: '交换了电池', charStart: 10, charEnd: 15 },
};
it('rejects the same event with the same evidence, even if the scene differs', () => {
  expect(() =>
    validateFactBatch({ states: [], relationships: [], events: [event, { ...event, sceneId: 'scn_other' }] }),
  ).toThrow('相同事件');
});
it('preserves a repeated action at a different position or with a different actor', () => {
  expect(() =>
    validateFactBatch({
      states: [],
      relationships: [],
      events: [
        event,
        { ...event, evidence: { ...event.evidence, charStart: 20, charEnd: 25 } },
        { ...event, actorId: 'ent_b' },
      ],
    }),
  ).not.toThrow();
});
it('rejects whitespace that would cause state field drift', () => {
  expect(() =>
    validateFactBatch({
      states: [{ entityId: 'ent_a', field: ' 位置', value: '桥', confidence: 1, evidence: event.evidence }],
      relationships: [],
      events: [],
    }),
  ).toThrow('首尾空白');
});

it.each([
  { states: [{ entityId: 'ent_a', field: '位置', value: '  ', confidence: 1, evidence: event.evidence }] },
  { states: [{ entityId: 'ent_a', field: '位置', value: '桥', confidence: NaN, evidence: event.evidence }] },
  {
    relationships: [
      { subjectId: 'ent_a', objectId: 'ent_b', predicate: '认识', confidence: 2, evidence: event.evidence },
    ],
  },
  { events: [{ ...event, summary: '\n ' }] },
  { events: [{ ...event, storyTime: ' ' }] },
  { foreshadows: [{ summary: ' ', evidence: event.evidence }] },
])('rejects invalid fact values before a preview or commit: %j', (invalid) => {
  expect(() => validateFactBatch({ states: [], relationships: [], events: [], ...invalid })).toThrow();
});
