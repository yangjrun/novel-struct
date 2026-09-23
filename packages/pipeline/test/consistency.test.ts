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
  type DbHandle,
} from '@novelstruct/db';
import { createFakeLlmClient } from '@novelstruct/parser';
import { eq } from 'drizzle-orm';
import { parseEditionConsistency } from '../src/parse-consistency.js';

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
      normalized: normalizeNovel(new TextEncoder().encode('第一章 初遇\n沈青崖到了石桥。')),
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
  const evidence = { charStart: 0, charEnd: text.length, quote: text };
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
        },
      ],
    }),
  );
  const llm = { baseUrl: 'http://fake', apiKey: 'fake', model: client.model };
  expect(await parseEditionConsistency(handle.db, { editionId, llm, client })).toEqual({
    succeeded: 1,
    skipped: 0,
    failed: 0,
  });
  expect(await handle.db.select().from(stateFacts)).toHaveLength(1);
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
