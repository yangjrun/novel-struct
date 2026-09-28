import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  openDatabase,
  getChapterByIndex,
  entities,
  stateFacts,
  sourceRefs,
  parseRuns,
  shadowReviews,
  reviewItems,
  commitConsistencyFacts,
  type DbHandle,
} from '@novelstruct/db';
import { importBook } from '../src/import-book.js';
import { reviewConsistencyPreview } from '../src/review-consistency.js';
import type { ShadowJudge } from '../src/shadow-review.js';

let handle: DbHandle;
let editionId: string;
let chapterId: string;
let evidence: { quote: string; charStart: number; charEnd: number };
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const imported = await importBook(handle.db, {
    title: '引用复核',
    bytes: new TextEncoder().encode('第一章 收礼\n沈青崖说：“拿着。”\n她收下了糖。\n没人提到时间。'),
  });
  editionId = imported.editionId;
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  chapterId = chapter.id;
  const quote = '她收下了糖。';
  const charStart = chapter.text.indexOf(quote);
  evidence = { quote, charStart, charEnd: charStart + quote.length };
  await handle.db
    .insert(entities)
    .values({ id: 'ent_review', bookId: imported.bookId, type: 'character', canonicalName: '沈青崖', confidence: 1 });
  await commitConsistencyFacts(handle.db, {
    bookId: imported.bookId,
    editionId,
    chapterId,
    states: [{ entityId: 'ent_review', field: '持有物', value: '糖', confidence: 1, evidence }],
    relationships: [],
    events: [],
    foreshadows: [],
  });
});
afterAll(async () => {
  await handle.close();
});

const snapshot = () =>
  Promise.all([
    handle.db.select().from(stateFacts),
    handle.db.select().from(sourceRefs),
    handle.db.select().from(parseRuns),
    handle.db.select().from(shadowReviews),
    handle.db.select().from(reviewItems),
  ]);
function preview(count = 1) {
  return {
    editionId,
    chapterId,
    model: 'extractor',
    promptVersion: 'consistency-pass/0.3',
    entities: [{ id: 'ent_review', name: '伪造姓名' }],
    context: { sections: [{ content: '九月初，沈青崖拿到了糖。' }] },
    facts: {
      states: [],
      relationships: [],
      foreshadows: [],
      resolveForeshadowIds: [] as string[],
      events: Array.from({ length: count }, (_, i) => ({
        type: '收礼',
        summary: `收到糖 ${i}`,
        actorId: 'ent_review',
        storyTime: '九月初',
        evidence: { ...evidence },
      })),
    },
  };
}

it('reviews only each quote, includes storyTime and canonical names, and never approves or writes results', async () => {
  const before = await snapshot();
  let sent: unknown;
  const judge: ShadowJudge = {
    model: 'reviewer',
    async choose(state, questions) {
      sent = state;
      expect(questions.f0?.instructions).toContain('不得使用其他候选');
      return { f0: { label: 'supports', confidence: 0.99 } };
    },
  };
  const report = await reviewConsistencyPreview(handle.db, preview(), judge);
  expect(sent).toEqual({
    claims: [{ id: 'f0', quote: evidence.quote, claim: '收礼：收到糖 0；行动者：沈青崖；故事时间：九月初' }],
  });
  expect(JSON.stringify(sent)).not.toContain('伪造姓名');
  expect(report).toMatchObject({ scope: 'quote-only', assessed: 1, unassessed: 0, counts: { supports: 1, errors: 0 } });
  expect(report.items[0]).toMatchObject({ humanReview: 'pending', verdict: 'supports', evidence });
  expect(report.items[0]?.candidateHash).toMatch(/^[0-9a-f]{64}$/);
  expect(await snapshot()).toEqual(before);
  const changed = preview();
  changed.facts.events[0]!.storyTime = '十月';
  const second = await reviewConsistencyPreview(handle.db, changed, {
    model: 'reviewer',
    async choose() {
      return { f0: { label: 'insufficient', confidence: 0.9 } };
    },
  });
  expect(second.items[0]?.candidateHash).not.toBe(report.items[0]?.candidateHash);
  expect(second.previewHash).not.toBe(report.previewHash);
});

it('retains later batch results after a provider failure and leaves resolution-only assertions unassessed', async () => {
  const value = preview(9);
  value.facts.resolveForeshadowIds = ['fact_unresolved'];
  let calls = 0;
  const report = await reviewConsistencyPreview(handle.db, value, {
    model: 'unstable',
    async choose() {
      if (++calls === 1) throw new Error('rate limited');
      return { f0: { label: 'insufficient', confidence: 0.8 } };
    },
  });
  expect(report).toMatchObject({
    requested: 10,
    assessed: 1,
    unassessed: 9,
    counts: { errors: 8, insufficient: 1 },
    unassessedResolutionIds: ['fact_unresolved'],
  });
  expect(report.items.slice(0, 8).every((item) => item.verdict === null && item.error === 'rate limited')).toBe(true);
  expect(report.items[8]?.humanReview).toBe('pending');
});

it('counts invalid or missing answers as unassessed while preserving other answers', async () => {
  const report = await reviewConsistencyPreview(handle.db, preview(3), {
    model: 'bad-shape',
    async choose() {
      return { f0: { label: 'supports', confidence: 0.9 }, f1: { label: 'supports', confidence: 2 } };
    },
  });
  expect(report).toMatchObject({ assessed: 1, unassessed: 2, counts: { errors: 2 } });
});

it.each(['edition', 'offset', 'missing-offset', 'quote', 'entity', 'scene', 'schema'])(
  'rejects stale or invalid %s data before any review request',
  async (kind) => {
    const value: any = preview();
    if (kind === 'edition') value.editionId = 'ed_other';
    if (kind === 'offset') value.facts.events[0].evidence.charStart += 1;
    if (kind === 'missing-offset') delete value.facts.events[0].evidence.charStart;
    if (kind === 'quote') value.facts.events[0].evidence.quote = '原文没有';
    if (kind === 'entity') value.facts.events[0].actorId = 'ent_other';
    if (kind === 'scene') value.facts.events[0].sceneId = 'scn_other';
    if (kind === 'schema') delete value.facts.events;
    let calls = 0;
    await expect(
      reviewConsistencyPreview(handle.db, value, {
        model: 'unused',
        async choose() {
          calls++;
          return {};
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toBe(0);
  },
);
