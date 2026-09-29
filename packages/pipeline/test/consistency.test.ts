import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  commitChapterIR,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  listEditionTimeline,
  openDatabase,
  stateFacts,
  sourceRefs,
  storyEvents,
  listEditionParseRuns,
  reimportNormalizedBook,
  entityMentions,
  entityAliases,
  relationships,
  foreshadows,
  shadowReviews,
  type DbHandle,
} from '@novelstruct/db';
import { createFakeLlmClient, LlmRequestRejectedError } from '@novelstruct/parser';
import { eq } from 'drizzle-orm';
import { parseEditionConsistency } from '../src/parse-consistency.js';
import { previewConsistencyPass, runConsistencyPass } from '../src/consistency-pass.js';

let handle: DbHandle;
let editionId: string;
let bookId: string;
let text: string;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, {
    libraryId: await ensureDefaultLibrary(handle.db),
    title: '一致性端到端',
  });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode('第一章 初遇\n次日清晨，沈青崖到了石桥。')),
    })
  ).editionId;
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  text = chapter.text;
  const at = text.indexOf('沈青崖');
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId: chapter.id,
      charCount: text.length,
      scenes: [
        { id: 'scn_consistency', index: 0, charStart: 0, charEnd: text.length, characterIds: ['ent_consistency'] },
      ],
      segments: [
        {
          id: 'seg_consistency',
          index: 0,
          sceneId: 'scn_consistency',
          kind: 'narration',
          charStart: 0,
          charEnd: text.length,
        },
      ],
      entities: [
        { id: 'ent_consistency', type: 'character', canonicalName: '沈青崖', aliases: [], isNew: true, confidence: 1 },
      ],
      mentions: [{ entityId: 'ent_consistency', surface: '沈青崖', charStart: at, charEnd: at + 3 }],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
});
afterAll(async () => {
  await handle.close();
});

it('runs a model against stored IR, validates evidence, commits and skips an already successful chapter', async () => {
  const evidence = { quote: text };
  const client = createFakeLlmClient(
    JSON.stringify({
      states: [{ entityId: 'ent_consistency', field: '位置', value: '石桥', confidence: 0.8, evidence }],
      events: [
        {
          type: '到达',
          summary: '到达石桥',
          actorId: 'ent_consistency',
          sceneId: 'scn_consistency',
          evidence,
          storyTime: '次日清晨',
          timeEvidence: { quote: '次日清晨' },
        },
      ],
    }),
  );
  const llm = { baseUrl: 'http://fake', apiKey: 'fake', model: client.model };
  let shadowInput: unknown;
  expect(
    await parseEditionConsistency(handle.db, {
      editionId,
      llm,
      client,
      shadowJudge: {
        model: 'test-time-review',
        async choose(state, questions) {
          shadowInput = state;
          return Object.fromEntries(Object.keys(questions).map((key) => [key, { label: 'supports', confidence: 1 }]));
        },
      },
    }),
  ).toEqual({
    succeeded: 1,
    skipped: 0,
    failed: 0,
  });
  expect(await handle.db.select().from(stateFacts)).toHaveLength(1);
  expect(JSON.stringify(shadowInput)).toContain('故事时间：次日清晨');
  expect(JSON.stringify(shadowInput)).toContain('次日清晨，沈青崖到了石桥。');
  for (const ref of await handle.db.select().from(sourceRefs)) {
    expect(text.slice(ref.charStart, ref.charEnd)).toBe(ref.quote);
  }
  expect((await listEditionParseRuns(handle.db, editionId)).find((run) => run.pass === 'consistency')).toMatchObject({
    status: 'succeeded',
    inputTokens: expect.any(Number),
  });
  expect((await listEditionTimeline(handle.db, editionId))[0]?.storyTime).toBe('次日清晨');
  expect(await parseEditionConsistency(handle.db, { editionId, llm, client })).toEqual({
    succeeded: 0,
    skipped: 1,
    failed: 0,
  });
  expect(client.requests).toHaveLength(1);
});

it('rejects committing a new model over existing facts before spending a model request', async () => {
  const client = createFakeLlmClient('{}', 'changed-model');
  const before = await listEditionParseRuns(handle.db, editionId);
  await expect(
    parseEditionConsistency(handle.db, {
      editionId,
      llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
      client,
    }),
  ).rejects.toThrow(/preview-consistency/);
  expect(client.requests).toHaveLength(0);
  expect(await listEditionParseRuns(handle.db, editionId)).toEqual(before);
  expect(await handle.db.select().from(stateFacts)).toHaveLength(1);
});

it('previews a successful chapter using the same extraction without changing any saved results', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const snapshot = () =>
    Promise.all([
      handle.db.select().from(stateFacts),
      handle.db.select().from(storyEvents),
      handle.db.select().from(relationships),
      handle.db.select().from(foreshadows),
      handle.db.select().from(sourceRefs),
      handle.db.select().from(shadowReviews),
      listEditionParseRuns(handle.db, editionId),
    ]);
  const before = await snapshot();
  const client = createFakeLlmClient(
    JSON.stringify({
      states: [
        { entityId: 'ent_consistency', field: '位置', value: '石桥', confidence: 0.9, evidence: { quote: text } },
      ],
    }),
    'preview-test',
  );
  const result = await previewConsistencyPass(handle.db, {
    chapterId: chapter.id,
    llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
    client,
  });
  expect(result.facts.states[0]?.evidence).toEqual({ quote: text, charStart: 0, charEnd: text.length });
  expect(result.model).toBe('preview-test');
  expect(result.entities).toContainEqual({ id: 'ent_consistency', name: '沈青崖' });
  expect(await snapshot()).toEqual(before);
  expect(client.requests).toHaveLength(1);
});

it.each([
  [
    'empty state value',
    {
      states: [
        { entityId: 'ent_consistency', field: '位置', value: ' ', confidence: 1, evidence: { quote: '沈青崖' } },
      ],
    },
    '状态字段、值',
  ],
  ['empty event', { events: [{ type: '到达', summary: ' ', evidence: { quote: '沈青崖' } }] }, '摘要不能为空'],
  ['empty foreshadow', { foreshadows: [{ summary: ' ', evidence: { quote: '沈青崖' } }] }, '伏笔摘要'],
  [
    'time anchor',
    { events: [{ type: '到达', summary: '到达石桥', storyTime: '九月初', evidence: { quote: '沈青崖' } }] },
    'timeEvidence',
  ],
  [
    'duplicate event',
    { events: [1, 2].map(() => ({ type: '到达', summary: '到达石桥', evidence: { quote: '沈青崖' } })) },
    '相同事件',
  ],
  [
    'entity',
    { events: [{ type: '到达', summary: '到达石桥', actorId: 'ent_other', evidence: { quote: '沈青崖' } }] },
    '本章候选之外',
  ],
  [
    'scene',
    { events: [{ type: '到达', summary: '到达石桥', sceneId: 'scn_other', evidence: { quote: '沈青崖' } }] },
    '不属于本章',
  ],
  [
    'state',
    {
      states: [1, 2].map((n) => ({
        entityId: 'ent_consistency',
        field: '位置',
        value: String(n),
        confidence: 1,
        evidence: { quote: '沈青崖' },
      })),
    },
    '重复定义',
  ],
  [
    'relation',
    {
      relationships: [1, 2].map(() => ({
        subjectId: 'ent_consistency',
        objectId: 'ent_consistency',
        predicate: '认识',
        confidence: 1,
        evidence: { quote: '沈青崖' },
      })),
    },
    '重复定义',
  ],
])('rejects invalid %s references/keys in read-only preview', async (_kind, output, message) => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const client = createFakeLlmClient(JSON.stringify(output));
  const before = await listEditionParseRuns(handle.db, editionId);
  await expect(
    previewConsistencyPass(handle.db, {
      chapterId: chapter.id,
      llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
      client,
    }),
  ).rejects.toThrow(message);
  expect(await listEditionParseRuns(handle.db, editionId)).toEqual(before);
});

it('invalidates facts and their evidence when structure is replaced', async () => {
  const before = await handle.db.select().from(sourceRefs);
  expect(before).toHaveLength(3); // structure mention + state and event evidence
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId: chapter.id,
      charCount: chapter.text.length,
      scenes: [{ id: 'scn_reparsed', index: 0, charStart: 0, charEnd: chapter.text.length, characterIds: [] }],
      segments: [
        {
          id: 'seg_reparsed',
          index: 0,
          sceneId: 'scn_reparsed',
          kind: 'narration',
          charStart: 0,
          charEnd: chapter.text.length,
        },
      ],
      entities: [],
      mentions: [],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
  expect(await handle.db.select().from(stateFacts)).toHaveLength(0);
  expect(await handle.db.select().from(storyEvents)).toHaveLength(0);
  expect(await handle.db.select().from(sourceRefs)).toHaveLength(0);
  expect((await listEditionParseRuns(handle.db, editionId)).some((run) => run.pass === 'consistency')).toBe(false);
});

it('clears changed chapter evidence and derived WeKnora pointers on re-import', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const start = chapter.text.indexOf('沈青崖');
  await handle.db.insert(sourceRefs).values({
    id: 'src_reimport_alias',
    editionId,
    chapterId: chapter.id,
    charStart: start,
    charEnd: start + 3,
    quote: '沈青崖',
    weknoraChunkId: 'old-chunk',
  });
  await handle.db.insert(entityAliases).values({
    id: 'als_reimport_alias',
    entityId: 'ent_consistency',
    alias: '青崖',
    sourceRefId: 'src_reimport_alias',
  });
  const normalized = normalizeNovel(new TextEncoder().encode('第一章 初遇\n沈青崖到了另一座石桥。'));
  const result = await reimportNormalizedBook(handle.db, { editionId, normalized });
  expect(result.updated).toBe(1);
  expect(await handle.db.select().from(sourceRefs).where(eq(sourceRefs.chapterId, chapter.id))).toEqual([]);
  expect(
    (await handle.db.select().from(entityAliases).where(eq(entityAliases.id, 'als_reimport_alias')))[0]?.sourceRefId,
  ).toBeNull();
  expect(await handle.db.select().from(entityMentions).where(eq(entityMentions.chapterId, chapter.id))).toEqual([]);
});

it('marks a failed model extraction without committing malformed evidence', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId: chapter.id,
      charCount: chapter.text.length,
      scenes: [{ id: 'scn_bad_evidence', index: 0, charStart: 0, charEnd: chapter.text.length, characterIds: [] }],
      segments: [
        {
          id: 'seg_bad_evidence',
          index: 0,
          sceneId: 'scn_bad_evidence',
          kind: 'narration',
          charStart: 0,
          charEnd: chapter.text.length,
        },
      ],
      entities: [],
      mentions: [],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
  const client = createFakeLlmClient(
    JSON.stringify({
      events: [{ type: 'arrival', summary: '错证据', evidence: { charStart: 0, charEnd: 2, quote: '错误' } }],
    }),
  );
  const result = await parseEditionConsistency(handle.db, {
    editionId,
    llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
    client,
  });
  expect(result).toEqual({ succeeded: 0, skipped: 0, failed: 1 });
  expect((await listEditionParseRuns(handle.db, editionId)).find((run) => run.pass === 'consistency')).toMatchObject({
    status: 'failed',
    inputTokens: expect.any(Number),
  });
  expect(await handle.db.select().from(storyEvents)).toEqual([]);
  expect(await handle.db.select().from(sourceRefs)).toEqual([]);
});

it.each([
  { content: 'The request was rejected because it was considered high risk', finishReason: 'stop' },
  { content: '{"events":[]}', finishReason: 'content_filter' },
])('reports provider rejection before parsing or committing: $finishReason', async (response) => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const usage = { inputTokens: 12, outputTokens: 34 };
  let recordedUsage;
  const client = { model: 'refusal-test', completeJson: async () => ({ ...response, usage }) };
  await expect(
    runConsistencyPass(handle.db, {
      chapterId: chapter.id,
      llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
      client,
      onUsage: (value) => {
        recordedUsage = value;
      },
    }),
  ).rejects.toBeInstanceOf(LlmRequestRejectedError);
  expect(recordedUsage).toEqual(usage);
  expect(await handle.db.select().from(storyEvents)).toEqual([]);
  expect(await handle.db.select().from(sourceRefs)).toEqual([]);
});

it('keeps a response preview and stop reason for malformed consistency output', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const client = {
    model: 'truncated-test',
    completeJson: async () => ({ content: '{"events":[', finishReason: 'length' }),
  };
  await expect(
    runConsistencyPass(handle.db, {
      chapterId: chapter.id,
      llm: { baseUrl: 'http://fake', apiKey: 'fake', model: client.model },
      client,
    }),
  ).rejects.toThrow(/response length: 11 characters; finish_reason: length; response preview: \{"events":\[/);
  expect(await handle.db.select().from(sourceRefs)).toEqual([]);
});

it('resumes after the failure limit is raised, preserving failures and skipping a later successful run', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const model = 'recovery-test';
  const llm = { baseUrl: 'http://fake', apiKey: 'fake', model };
  const rejected = createFakeLlmClient('The request was rejected because it was considered high risk', model);
  for (let i = 0; i < 3; i++) {
    expect(await parseEditionConsistency(handle.db, { editionId, llm, client: rejected })).toEqual({
      succeeded: 0,
      skipped: 0,
      failed: 1,
    });
  }
  const client = createFakeLlmClient(
    JSON.stringify({
      events: [
        {
          type: 'arrival',
          summary: '沈青崖到达另一座石桥',
          evidence: {
            charStart: 0,
            charEnd: chapter.text.length,
            quote: chapter.text,
          },
        },
      ],
    }),
    model,
  );
  await expect(parseEditionConsistency(handle.db, { editionId, llm, client })).rejects.toThrow(/--max-attempts/);
  expect(client.requests).toHaveLength(0);
  expect(await parseEditionConsistency(handle.db, { editionId, llm, client, maxAttempts: 4 })).toEqual({
    succeeded: 1,
    skipped: 0,
    failed: 0,
  });
  const runs = (await listEditionParseRuns(handle.db, editionId)).filter((run) => run.model === model);
  expect(runs.filter((run) => run.status === 'failed')).toHaveLength(3);
  expect(runs.find((run) => run.status === 'succeeded')).toMatchObject({ attempt: 4 });
  expect(await handle.db.select().from(storyEvents)).toHaveLength(1);
  expect(await parseEditionConsistency(handle.db, { editionId, llm, client })).toEqual({
    succeeded: 0,
    skipped: 1,
    failed: 0,
  });
  expect(client.requests).toHaveLength(1);
  expect(await handle.db.select().from(storyEvents)).toHaveLength(1);
});

it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid consistency failure limits: %s', async (maxAttempts) => {
  await expect(
    parseEditionConsistency(handle.db, {
      editionId,
      llm: { baseUrl: 'http://fake', apiKey: 'fake', model: 'unused' },
      maxAttempts,
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
});
