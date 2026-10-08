import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ChapterIRSchema } from '@novelstruct/core';
import {
  commitChapterIR,
  commitConsistencyFacts,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  memoryItems,
  openDatabase,
  saveWeKnoraDocument,
  saveWeKnoraKb,
  sourceRefs,
  stateFacts,
  storyEvents,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { createFakeLlmClient, createLlmAttributor } from '@novelstruct/parser';
import { createPostgresMemoryStore } from '@novelstruct/memory';
import { indexEditionScenes, type Embedder } from '@novelstruct/knowledge';
import { executeParsePlan, parseEditionConsistency, planEditionParse, previewConsistencyPass } from '../src/index.js';

let handle: DbHandle;
let bookId: string;
let editionId: string;
const chapters: NonNullable<Awaited<ReturnType<typeof getChapterByIndex>>>[] = [];
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '解析闭环' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(
        new TextEncoder().encode(
          '第一章 一\n青崖拿到了钥匙，留在石桥。\n第二章 二\n青崖来到山顶，仍握着钥匙。\n第三章 三\n青崖登上月球。',
        ),
      ),
    })
  ).editionId;
  await saveWeKnoraKb(handle.db, editionId, 'kb-loop');
  for (let i = 0; i < 3; i++) {
    const chapter = (await getChapterByIndex(handle.db, editionId, i))!;
    chapters.push(chapter);
    const at = chapter.text.indexOf('青崖');
    await commitChapterIR(
      handle.db,
      ChapterIRSchema.parse({
        irVersion: '0.1',
        bookId,
        editionId,
        chapterId: chapter.id,
        charCount: chapter.text.length,
        scenes: [
          {
            id: `scene-loop-${i}`,
            index: 0,
            charStart: 0,
            charEnd: chapter.text.length,
            characterIds: ['entity-loop'],
          },
        ],
        segments: [
          {
            id: `segment-loop-${i}`,
            index: 0,
            sceneId: `scene-loop-${i}`,
            kind: 'narration',
            charStart: 0,
            charEnd: chapter.text.length,
          },
        ],
        entities: [
          { id: 'entity-loop', type: 'character', canonicalName: '青崖', isNew: i === 0, confidence: 1, aliases: [] },
        ],
        mentions: [{ entityId: 'entity-loop', surface: '青崖', charStart: at, charEnd: at + 2 }],
        provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test', normalizerVersion: '0.3' },
      }),
    );
    await saveWeKnoraDocument(handle.db, chapter.id, `doc-loop-${i}`, chapter.contentHash);
  }
});
afterAll(async () => {
  await handle.close();
});

const search = vi.fn(async () =>
  chapters.map((chapter, index) => ({
    id: `chunk-loop-${index}`,
    knowledge_id: `doc-loop-${index}`,
    knowledge_base_id: 'kb-loop',
    content: chapter.text,
    score: 1,
  })),
);
const llm = { baseUrl: 'http://fake', apiKey: 'fake', model: 'loop-test' };

it('feeds committed memory and verified historical evidence into the next consistency chapter', async () => {
  const memory = createPostgresMemoryStore(handle.db);
  const recallStates = vi.spyOn(memory, 'recallStates');
  const recallSimilar = vi.spyOn(memory, 'recallSimilar');
  const contexts: { kind: string; content: string; evidence?: { chapterId: string } }[][] = [];
  const result = await parseEditionConsistency(handle.db, {
    editionId,
    from: 0,
    to: 1,
    llm,
    retrieval: { memory, weknora: { search } },
    client: {
      model: llm.model,
      async completeJson(request) {
        const input = JSON.parse(request.user);
        contexts.push(input.context);
        const first = input.chapterId === chapters[0]!.id;
        return {
          content: JSON.stringify({
            states: [
              {
                entityId: 'entity-loop',
                field: '位置',
                value: first ? '石桥' : '山顶',
                confidence: 1,
                evidence: { quote: input.text },
              },
            ],
            events: first
              ? [{ type: '获得', summary: '青崖获得钥匙', actorId: 'entity-loop', evidence: { quote: input.text } }]
              : [],
          }),
        };
      },
    },
  });
  expect(result).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
  expect(contexts[0]).toEqual([]);
  expect(contexts[1]).toContainEqual(
    expect.objectContaining({ kind: 'memory', content: expect.stringContaining('青崖获得钥匙') }),
  );
  const evidence = contexts[1]!.filter((part) => part.kind === 'evidence');
  expect(evidence).toHaveLength(1);
  expect(evidence[0]!.evidence?.chapterId).toBe(chapters[0]!.id);
  expect(JSON.stringify(contexts[1])).not.toContain('月球');
  expect(recallStates).toHaveBeenCalledWith(bookId, ['entity-loop'], 0, editionId);
  expect(recallSimilar).toHaveBeenCalledWith(bookId, expect.any(String), 20, editionId, 0);
  expect((await memory.recallState(bookId, 'entity-loop', 1, editionId))[0]!.content).toBe('位置: 山顶');
  expect(await handle.db.select().from(memoryItems)).toHaveLength(3);
});

it('keeps preview read-only and rejects model evidence copied from retrieved history', async () => {
  const snapshot = () =>
    Promise.all([
      handle.db.select().from(memoryItems),
      handle.db.select().from(stateFacts),
      handle.db.select().from(storyEvents),
      handle.db.select().from(sourceRefs),
    ]);
  const before = await snapshot();
  const client = createFakeLlmClient(
    JSON.stringify({ events: [{ type: '获得', summary: '获得钥匙', evidence: { quote: chapters[0]!.text } }] }),
  );
  await expect(
    previewConsistencyPass(handle.db, {
      chapterId: chapters[1]!.id,
      llm,
      client,
      retrieval: { weknora: { search } },
    }),
  ).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});

it('retrieves an earlier vector result even when current/future scenes rank higher', async () => {
  const embedder: Embedder = {
    model: 'loop-vector',
    embed: async (text) => [text.includes('拿到了') ? 0 : 1, 1, ...Array<number>(1534).fill(0)],
  };
  await indexEditionScenes(handle.db, { editionId, embedder });
  const preview = await previewConsistencyPass(handle.db, {
    chapterId: chapters[1]!.id,
    llm,
    client: createFakeLlmClient('{}'),
    retrieval: { embedder },
  });
  expect(preview.context.sections.filter((part) => part.kind === 'similar')).toEqual([
    expect.objectContaining({ reference: 'scene-loop-0', content: expect.stringContaining('拿到了钥匙') }),
  ]);
});

it('passes recall through the structure pipeline to the LLM attribution prompt', async () => {
  const client = createFakeLlmClient('{}');
  const plan = await planEditionParse(handle.db, {
    editionId,
    from: 1,
    to: 1,
    attributor: 'llm',
    llm,
    retrieval: { weknora: { search } },
  });
  const result = await executeParsePlan(handle.db, {
    ...plan,
    choice: { ...plan.choice, attributor: createLlmAttributor(client) },
  });
  expect(result.succeeded).toBe(1);
  expect(client.requests[0]!.user).toContain('历史上下文');
  expect(client.requests[0]!.user).toContain('青崖获得钥匙');
  expect(client.requests[0]!.user).toContain('chunk-loop-0');
  expect(client.requests[0]!.user).not.toContain('月球');
  // Replacing structure still invalidates the edition's dependent facts and memory.
  expect(await handle.db.select().from(memoryItems)).toEqual([]);
});

it('rolls facts and evidence back if refreshing memory fails', async () => {
  await handle.db.execute(
    sql`ALTER TABLE memory_items ADD CONSTRAINT reject_test_memory CHECK (content <> '位置: 失败测试')`,
  );
  const chapter = chapters[0]!;
  const beforeRefs = await handle.db.select().from(sourceRefs);
  try {
    await expect(
      commitConsistencyFacts(handle.db, {
        bookId,
        editionId,
        chapterId: chapter.id,
        states: [
          {
            entityId: 'entity-loop',
            field: '位置',
            value: '失败测试',
            confidence: 1,
            evidence: { charStart: 0, charEnd: chapter.text.length, quote: chapter.text },
          },
        ],
        events: [],
        relationships: [],
        foreshadows: [],
      }),
    ).rejects.toThrow();
    expect(await handle.db.select().from(stateFacts)).toEqual([]);
    expect(await handle.db.select().from(memoryItems)).toEqual([]);
    expect(await handle.db.select().from(sourceRefs)).toEqual(beforeRefs);
  } finally {
    await handle.db.execute(sql`ALTER TABLE memory_items DROP CONSTRAINT reject_test_memory`);
  }
});
