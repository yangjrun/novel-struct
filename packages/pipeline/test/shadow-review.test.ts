import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getChapterByIndex,
  listChapterShadowReviews,
  openDatabase,
  shadowReviews,
  storyEvents,
  type DbHandle,
} from '@novelstruct/db';
import { createFakeLlmClient } from '@novelstruct/parser';
import {
  createJevJudge,
  evaluateShadow,
  importBook,
  judgeEvidence,
  judgeQuotes,
  parseEdition,
  parseShadowEnv,
  parseShadowGold,
  quoteReviewCandidates,
  runConsistencyPass,
  type ShadowJudge,
} from '../src/index.js';

const text = '第一章 原文\n所谓“废土人”没有受过教育。\n铁老说：“走。”\n“嗯。”他点头。';
const bytes = new TextEncoder().encode(text);
const shadow: ShadowJudge = {
  model: 'jev-test',
  async choose(state, questions) {
    const candidates = state as { quotes?: { quote: string }[]; claims?: { claim: string }[] };
    return Object.fromEntries(
      Object.keys(questions).map((key) => {
        const index = Number(key.slice(1));
        const label = key.startsWith('q')
          ? candidates.quotes![index]!.quote.includes('废土人')
            ? 'term'
            : 'dialogue'
          : candidates.claims![index]!.claim.includes('未发生')
            ? 'insufficient'
            : 'supports';
        return [key, { label, confidence: 0.91 }];
      }),
    );
  },
};

describe('Jev shadow review', () => {
  it('calls the dedicated TypeSafe API and validates answer ids and options', async () => {
    const sent: unknown[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(JSON.parse(init!.body as string));
      return new Response(
        JSON.stringify({ model: 'jev-1.13.0', answers: { q0: { type: 'choice', choice: 'term', confidence: 0.9 } } }),
      );
    };
    const judge = createJevJudge(
      { baseUrl: 'https://api.typesafe.ai/v1/', apiKey: 'test', model: 'jev-1.13.0' },
      fetchImpl,
    );
    const options = { q0: { type: 'choice' as const, instructions: '用途？', criteria: { term: '术语' } } };
    expect(await judge.choose({ quote: '“废土人”' }, options)).toEqual({ q0: { label: 'term', confidence: 0.9 } });
    expect(sent[0]).toEqual({ model: 'jev-1.13.0', state: { quote: '“废土人”' }, questions: options });
    expect(parseShadowEnv({})).toBeUndefined();
    expect(parseShadowEnv({ TYPESAFE_API_KEY: ' k ' })).toMatchObject({ model: 'jev-1.13.0' });
    const broken = createJevJudge(
      { baseUrl: 'https://fake/v1', apiKey: 'test', model: 'jev-test' },
      async () =>
        new Response(
          JSON.stringify({ model: 'jev-test', answers: { q0: { type: 'choice', choice: 'other', confidence: 0.9 } } }),
        ),
    );
    await expect(broken.choose('x', options)).rejects.toThrow(/invalid choice/);
  });

  it('includes suppressed quoted terms in shadow candidates without changing main extraction', async () => {
    const candidates = quoteReviewCandidates(text.slice(text.indexOf('所谓')), []);
    expect(candidates.map((c) => c.source)).toEqual(['“废土人”', '“走。”', '“嗯。”']);
    expect((await judgeQuotes(shadow, candidates)).map((c) => c.label)).toEqual(['term', 'dialogue', 'dialogue']);
    expect(
      (
        await judgeEvidence(shadow, [
          { itemKey: 'f1', charStart: 0, charEnd: 2, source: '铁老', context: text, claim: '未发生的事情' },
        ])
      )[0]?.label,
    ).toBe('insufficient');
  });

  let handle: DbHandle;
  let editionId: string;
  beforeAll(async () => {
    handle = await openDatabase({ inMemory: true });
    await handle.migrate();
    editionId = (await importBook(handle.db, { bytes, title: '影子复核测试' })).editionId;
  });
  afterAll(async () => handle.close());

  it('persists shadow assessments after a successful structure parse and removes stale ones on re-parse', async () => {
    const done = await parseEdition(handle.db, { editionId, shadowJudge: shadow });
    expect(done.succeeded).toBe(1);
    const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
    const reviews = await listChapterShadowReviews(handle.db, chapter.id);
    expect(reviews.map((r) => [r.source, r.label, r.claim])).toEqual([
      ['“废土人”', 'term', 'narration'],
      ['“走。”', 'dialogue', 'dialogue'],
      ['“嗯。”', 'dialogue', 'dialogue'],
    ]);
    const failing: ShadowJudge = {
      model: 'jev-failing',
      choose: async () => {
        throw new Error('offline');
      },
    };
    const rerun = await parseEdition(handle.db, { editionId, force: true, shadowJudge: failing });
    expect(rerun.succeeded).toBe(1);
    expect(await listChapterShadowReviews(handle.db, chapter.id)).toMatchObject([
      { pass: 'structure', itemKey: 'error', error: 'offline', model: 'jev-failing' },
    ]);
    const recovered = await parseEdition(handle.db, { editionId, shadowJudge: shadow });
    expect(recovered).toMatchObject({ succeeded: 0, skipped: 1, failed: 0 });
    expect((await listChapterShadowReviews(handle.db, chapter.id)).map((item) => item.model)).toEqual([
      'jev-test',
      'jev-test',
      'jev-test',
    ]);
    const unconfigured = await parseEdition(handle.db, { editionId, force: true });
    expect(unconfigured.succeeded).toBe(1);
    expect(await listChapterShadowReviews(handle.db, chapter.id)).toEqual([]);
    const backfill = await parseEdition(handle.db, { editionId, shadowJudge: shadow });
    expect(backfill).toMatchObject({ succeeded: 0, skipped: 1, failed: 0 });
    expect(await listChapterShadowReviews(handle.db, chapter.id)).toHaveLength(3);
  });

  it('reviews facts after they are committed, without changing the facts', async () => {
    const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
    const evidence = { charStart: 0, charEnd: chapter.text.length, quote: chapter.text };
    const client = createFakeLlmClient(
      JSON.stringify({ events: [{ type: '提示', summary: '铁老对人说走', evidence }] }),
    );
    await runConsistencyPass(handle.db, {
      chapterId: chapter.id,
      llm: { apiKey: 'test', model: client.model, baseUrl: 'https://fake' },
      client,
      shadowJudge: shadow,
    });
    expect(await handle.db.select().from(storyEvents).where(eq(storyEvents.chapterId, chapter.id))).toHaveLength(1);
    expect(
      (await listChapterShadowReviews(handle.db, chapter.id)).filter((r) => r.pass === 'consistency'),
    ).toMatchObject([{ label: 'supports', model: 'jev-test', claim: '提示：铁老对人说走' }]);
    // Structure replacement invalidates both dependent facts and their shadow judgments.
    await parseEdition(handle.db, { editionId, force: true });
    expect(await handle.db.select().from(shadowReviews).where(eq(shadowReviews.chapterId, chapter.id))).toEqual([]);
  });

  it('evaluates gold without writing, and reports incomplete provider coverage', async () => {
    const gold = parseShadowGold(
      [
        '{"kind":"quote","chapter":1,"quote":"废土人","expected":"term"}',
        '{"kind":"quote","chapter":1,"quote":"走。","expected":"dialogue"}',
        '{"kind":"evidence","chapter":1,"quote":"铁老说：","claim":"未发生的事情","expected":"insufficient"}',
      ].join('\n'),
    );
    const report = await evaluateShadow(handle.db, editionId, gold, shadow);
    expect(report).toMatchObject({
      requested: 3,
      assessed: 3,
      correct: 3,
      wrong: 0,
      quote: { assessed: 2, correct: 2 },
      evidence: { assessed: 1, correct: 1 },
      mainQuote: { assessed: 2, correct: 2 },
      disagreements: { detectedErrors: 0, falseAlarms: 0, missedErrors: 0 },
      failures: [],
      missedByExtractor: [],
    });
    const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
    expect(await listChapterShadowReviews(handle.db, chapter.id)).toEqual([]);
    const badJudge: ShadowJudge = {
      model: 'wrong',
      choose: async (_state, questions) =>
        Object.fromEntries(
          Object.keys(questions).map((key) => [
            key,
            {
              label: key.startsWith('q') ? 'term' : 'insufficient',
              confidence: 0.8,
            },
          ]),
        ),
    };
    expect((await evaluateShadow(handle.db, editionId, gold, badJudge)).disagreements).toEqual({
      detectedErrors: 0,
      falseAlarms: 1,
      missedErrors: 0,
    });
    expect(
      (
        await evaluateShadow(handle.db, editionId, gold, {
          model: 'bad',
          choose: async () => {
            throw new Error('rejected');
          },
        })
      ).failures,
    ).toHaveLength(2);
    expect(() => parseShadowGold('{"chapter":1}')).toThrow(/第 1 行/);
  });

  it('reports in-source quote text that the candidate extractor missed rather than pretending it was assessed', async () => {
    const gold = parseShadowGold('{"kind":"quote","chapter":1,"quote":"没有受过教育","expected":"dialogue"}');
    const report = await evaluateShadow(handle.db, editionId, gold, shadow);
    expect(report).toMatchObject({
      requested: 1,
      assessed: 0,
      missedByExtractor: [{ chapter: 1, quote: '没有受过教育' }],
    });
  });
});
