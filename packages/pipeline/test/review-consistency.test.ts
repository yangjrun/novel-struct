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
import { hashRevisionAudit, reviewConsistencyPreview } from '../src/review-consistency.js';
import { reviseConsistencyPreview } from '../src/revise-consistency.js';
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

it('revises a candidate with audit evidence, invalidates old hashes and never writes facts', async () => {
  const value = preview(2);
  const judge: ShadowJudge = {
    model: 'reviewer',
    async choose() {
      return {};
    },
  };
  const report = await reviewConsistencyPreview(handle.db, value, judge);
  const before = await snapshot();
  const replacement = { ...value.facts.events[1]!, summary: '收下了糖' };
  const patch = {
    sourceHash: report.sourceHash,
    previewHash: report.previewHash,
    editor: 'reviewer',
    revisions: [
      { key: 'events:0', candidateHash: report.items[0]!.candidateHash, reason: '重复候选', replacement: null },
      { key: 'events:1', candidateHash: report.items[1]!.candidateHash, reason: '缩小断言', replacement },
    ],
  };
  const revised = await reviseConsistencyPreview(handle.db, value, patch);
  expect(revised.facts.events).toEqual([replacement]);
  expect(revised.revision).toMatchObject({
    parentPreviewHash: report.previewHash,
    editor: 'reviewer',
    humanReview: 'pending',
  });
  expect(revised.revision.changes[1]).toMatchObject({ before: value.facts.events[1], after: replacement });
  expect(revised.revision.previewHash).not.toBe(report.previewHash);
  await expect(reviseConsistencyPreview(handle.db, revised, patch)).rejects.toThrow('已变化');
  expect(await snapshot()).toEqual(before);
});

it('preserves metadata and verifies the audit chain across two revisions and a fresh review', async () => {
  const value = { ...preview(2), usage: { inputTokens: 12, outputTokens: 34 } };
  const judge: ShadowJudge = {
    model: 'reviewer',
    async choose() {
      return {};
    },
  };
  const firstReport = await reviewConsistencyPreview(handle.db, value, judge);
  const first = await reviseConsistencyPreview(handle.db, value, {
    sourceHash: firstReport.sourceHash,
    previewHash: firstReport.previewHash,
    editor: 'first editor',
    revisions: [
      {
        key: 'events:0',
        candidateHash: firstReport.items[0]!.candidateHash,
        reason: '删除重复',
        replacement: null,
      },
    ],
  });
  expect(first).toMatchObject({ entities: value.entities, context: value.context, usage: value.usage });
  expect(first.context).not.toBe(value.context);
  expect(first.revision).not.toBe(first.revisionHistory[0]);
  expect(first.revisionHistory).toHaveLength(1);
  const secondReport = await reviewConsistencyPreview(handle.db, JSON.parse(JSON.stringify(first)), judge);
  const second = await reviseConsistencyPreview(handle.db, first, {
    sourceHash: secondReport.sourceHash,
    previewHash: secondReport.previewHash,
    editor: 'second editor',
    revisions: [
      {
        key: 'events:0',
        candidateHash: secondReport.items[0]!.candidateHash,
        reason: '缩小断言',
        replacement: { ...first.facts.events[0]!, summary: '收下糖' },
      },
    ],
  });
  expect(second).toMatchObject({ entities: value.entities, context: value.context, usage: value.usage });
  expect(second.revisionHistory).toHaveLength(2);
  expect(second.revisionHistory[0]).toEqual(first.revision);
  expect(second.revisionHistory[1]).toEqual(second.revision);
  expect(second.revision.parentPreviewHash).toBe(first.revision.previewHash);
  const truncated = { ...second, revisionHistory: [second.revision] };
  await expect(reviewConsistencyPreview(handle.db, truncated, judge)).rejects.toMatchObject({ code: 'invalid_input' });
  const altered = {
    ...second,
    revisionHistory: [
      {
        ...second.revisionHistory[0]!,
        changes: [{ ...second.revisionHistory[0]!.changes[0]!, before: { forged: true } }],
      },
      second.revisionHistory[1]!,
    ],
  };
  await expect(reviewConsistencyPreview(handle.db, altered, judge)).rejects.toMatchObject({ code: 'invalid_input' });
  const forgedBody = { ...first.revision, changes: [{ ...first.revision.changes[0]!, before: { forged: true } }] };
  const forgedAudit = { ...forgedBody, auditHash: hashRevisionAudit(forgedBody) };
  await expect(
    reviewConsistencyPreview(handle.db, { ...first, revision: forgedAudit, revisionHistory: [forgedAudit] }, judge),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  expect((await reviewConsistencyPreview(handle.db, JSON.parse(JSON.stringify(second)), judge)).previewHash).toBe(
    second.revision.previewHash,
  );
});

it('rejects a tampered revision hash before contacting the judge or creating another revision', async () => {
  const value = preview();
  const report = await reviewConsistencyPreview(handle.db, value, {
    model: 'test',
    async choose() {
      return {};
    },
  });
  const first = await reviseConsistencyPreview(handle.db, value, {
    sourceHash: report.sourceHash,
    previewHash: report.previewHash,
    editor: 'editor',
    revisions: [
      {
        key: 'events:0',
        candidateHash: report.items[0]!.candidateHash,
        reason: '缩小断言',
        replacement: { ...value.facts.events[0]!, summary: '收下糖' },
      },
    ],
  });
  const tampered = {
    ...first,
    facts: { ...first.facts, events: [{ ...first.facts.events[0]!, summary: '凭空增加事实' }] },
  };
  let calls = 0;
  await expect(
    reviewConsistencyPreview(handle.db, tampered, {
      model: 'test',
      async choose() {
        calls += 1;
        return {};
      },
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  expect(calls).toBe(0);
  await expect(
    reviseConsistencyPreview(handle.db, tampered, {
      sourceHash: report.sourceHash,
      previewHash: first.revision.previewHash,
      editor: 'editor',
      revisions: [
        { key: 'events:0', candidateHash: report.items[0]!.candidateHash, reason: '再改', replacement: null },
      ],
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
});

it.each([
  'source',
  'preview',
  'candidate',
  'quote',
  'entity',
  'duplicate',
  'missing-replacement',
  'empty',
  'unchanged',
  'unknown-evidence-field',
])('rejects invalid revision %s without writing', async (kind) => {
  const value = preview();
  const report = await reviewConsistencyPreview(handle.db, value, {
    model: 'reviewer',
    async choose() {
      return {};
    },
  });
  const patch: any = {
    sourceHash: report.sourceHash,
    previewHash: report.previewHash,
    editor: 'reviewer',
    revisions: [
      {
        key: 'events:0',
        candidateHash: report.items[0]!.candidateHash,
        reason: '修正',
        replacement: { ...value.facts.events[0], summary: '收下了糖' },
      },
    ],
  };
  if (kind === 'source') patch.sourceHash = '0'.repeat(64);
  if (kind === 'preview') patch.previewHash = '0'.repeat(64);
  if (kind === 'candidate') patch.revisions[0].candidateHash = '0'.repeat(64);
  if (kind === 'quote') patch.revisions[0].replacement.evidence = { ...evidence, quote: '不存在的原文' };
  if (kind === 'entity') patch.revisions[0].replacement.actorId = 'ent_other';
  if (kind === 'duplicate') patch.revisions.push(patch.revisions[0]);
  if (kind === 'missing-replacement') delete patch.revisions[0].replacement;
  if (kind === 'empty') patch.revisions[0].replacement.summary = ' ';
  if (kind === 'unchanged') patch.revisions[0].replacement = value.facts.events[0];
  if (kind === 'unknown-evidence-field') patch.revisions[0].replacement.evidence = { ...evidence, storyTime: '昨天' };
  const before = await snapshot();
  await expect(reviseConsistencyPreview(handle.db, value, patch)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await snapshot()).toEqual(before);
});

it('allows removing duplicate saved events but rejects a revision that creates duplicates', async () => {
  const value = preview(2);
  value.facts.events[1] = { ...value.facts.events[0]! };
  const judge: ShadowJudge = {
    model: 'test',
    async choose() {
      return {};
    },
  };
  const report = await reviewConsistencyPreview(handle.db, value, judge);
  const patch = {
    sourceHash: report.sourceHash,
    previewHash: report.previewHash,
    editor: 'test',
    revisions: [
      { key: 'events:1', candidateHash: report.items[1]!.candidateHash, reason: '删除重复', replacement: null },
    ],
  };
  expect((await reviseConsistencyPreview(handle.db, value, patch)).facts.events).toHaveLength(1);

  const distinct = preview(2);
  const distinctReport = await reviewConsistencyPreview(handle.db, distinct, judge);
  const before = await snapshot();
  await expect(
    reviseConsistencyPreview(handle.db, distinct, {
      ...patch,
      previewHash: distinctReport.previewHash,
      revisions: [
        {
          key: 'events:1',
          candidateHash: distinctReport.items[1]!.candidateHash,
          reason: '改摘要',
          replacement: distinct.facts.events[0],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('相同事件') });
  expect(await snapshot()).toEqual(before);
});

it('rejects unknown foreshadow fields instead of silently losing revision content', async () => {
  const value = { ...preview(), facts: { ...preview().facts, foreshadows: [{ summary: '糖的来源未知', evidence }] } };
  const report = await reviewConsistencyPreview(handle.db, value, {
    model: 'test',
    async choose() {
      return {};
    },
  });
  await expect(
    reviseConsistencyPreview(handle.db, value, {
      sourceHash: report.sourceHash,
      previewHash: report.previewHash,
      editor: 'test',
      revisions: [
        {
          key: 'foreshadows:0',
          candidateHash: report.items.find((item) => item.key === 'foreshadows:0')!.candidateHash,
          reason: '更正',
          replacement: { ...value.facts.foreshadows[0], summary: '来源待查', storyTime: '九月初' },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
});

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

it('sends each claim to a separate judge request so another quote cannot influence it', async () => {
  const seen: unknown[] = [];
  const report = await reviewConsistencyPreview(handle.db, preview(2), {
    model: 'isolated',
    async choose(state) {
      seen.push(state);
      return { f0: { label: 'supports', confidence: 0.7 } };
    },
  });
  expect(seen).toHaveLength(2);
  expect(seen.every((state) => (state as { claims: unknown[] }).claims.length === 1)).toBe(true);
  expect(report).toMatchObject({ assessed: 2, unassessed: 0 });
});

it('retains later isolated results after a provider failure and leaves resolution-only assertions unassessed', async () => {
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
    assessed: 8,
    unassessed: 2,
    counts: { errors: 1, insufficient: 8 },
    unassessedResolutionIds: ['fact_unresolved'],
  });
  expect(report.items[0]).toMatchObject({ verdict: null, error: 'rate limited' });
  expect(report.items.slice(1).every((item) => item.verdict === 'insufficient')).toBe(true);
});

it('counts invalid or missing isolated answers as unassessed while preserving other answers', async () => {
  let calls = 0;
  const report = await reviewConsistencyPreview(handle.db, preview(3), {
    model: 'bad-shape',
    async choose(): Promise<Readonly<Record<string, { label: string; confidence: number }>>> {
      calls += 1;
      if (calls === 1) return { f0: { label: 'supports', confidence: 0.9 } };
      if (calls === 2) return { f0: { label: 'supports', confidence: 2 } };
      return {};
    },
  });
  expect(report).toMatchObject({ assessed: 1, unassessed: 2, counts: { errors: 2 } });
});

it.each([
  'edition',
  'offset',
  'missing-offset',
  'quote',
  'entity',
  'scene',
  'schema',
  'unknown-fact',
  'unknown-foreshadow-field',
  'misspelled-audit',
])('rejects stale or invalid %s data before any review request', async (kind) => {
  const value: any = preview();
  if (kind === 'edition') value.editionId = 'ed_other';
  if (kind === 'offset') value.facts.events[0].evidence.charStart += 1;
  if (kind === 'missing-offset') delete value.facts.events[0].evidence.charStart;
  if (kind === 'quote') value.facts.events[0].evidence.quote = '原文没有';
  if (kind === 'entity') value.facts.events[0].actorId = 'ent_other';
  if (kind === 'scene') value.facts.events[0].sceneId = 'scn_other';
  if (kind === 'schema') delete value.facts.events;
  if (kind === 'unknown-fact') value.facts.event = [];
  if (kind === 'unknown-foreshadow-field') value.facts.foreshadows = [{ summary: '未解', evidence, storyTime: '昨天' }];
  if (kind === 'misspelled-audit') value.revison = { humanReview: 'approved' };
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
});
