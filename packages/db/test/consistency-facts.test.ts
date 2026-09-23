import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  commitChapterIR,
  commitConsistencyFacts,
  createBook,
  deleteBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  relationships,
  sourceRefs,
  stateChanges,
  stateFacts,
  storyEvents,
  foreshadows,
  reviewItems,
  listEditionTimeline,
  type DbHandle,
} from '../src/index.js';

let handle: DbHandle;
let bookId: string;
let editionId: string;
let chapters: { id: string; text: string }[];
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '事实测试' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode('第一章 一\n沈青崖到了。\n第二章 二\n沈青崖离开。')),
    })
  ).editionId;
  chapters = [];
  for (let index = 0; index < 2; index++) {
    const ch = await getChapterByIndex(handle.db, editionId, index);
    if (!ch) throw new Error('missing chapter');
    chapters.push(ch);
    await commitChapterIR(
      handle.db,
      ChapterIRSchema.parse({
        irVersion: '0.1',
        bookId,
        editionId,
        chapterId: ch.id,
        charCount: ch.text.length,
        scenes: [{ id: `scn_f${index}`, index: 0, charStart: 0, charEnd: ch.text.length, characterIds: ['ent_f'] }],
        segments: [
          {
            id: `seg_f${index}`,
            sceneId: `scn_f${index}`,
            index: 0,
            kind: 'narration',
            charStart: 0,
            charEnd: ch.text.length,
          },
        ],
        entities: [
          { id: 'ent_f', type: 'character', canonicalName: '沈青崖', isNew: index === 0, aliases: [], confidence: 1 },
        ],
        mentions: [],
        provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
      }),
    );
  }
});
afterAll(async () => {
  await handle.close();
});

it('requires accurate evidence and matching entity scope, writes history with supersede', async () => {
  const first = chapters[0]!;
  const second = chapters[1]!;
  const quote = (ch: typeof first) => ({ charStart: 0, charEnd: ch.text.length, quote: ch.text });
  const make = (ch: typeof first, value: string) => ({
    bookId,
    editionId,
    chapterId: ch.id,
    states: [{ entityId: 'ent_f', field: '位置', value, confidence: 0.55, evidence: quote(ch) }],
    relationships: [
      { subjectId: 'ent_f', predicate: '所在地', objectId: 'ent_f', confidence: 0.8, evidence: quote(ch) },
    ],
    events: [
      {
        type: '移动',
        summary: '离开',
        actorId: 'ent_f',
        sceneId: ch.id === first.id ? 'scn_f0' : 'scn_f1',
        evidence: quote(ch),
      },
    ],
    foreshadows: [{ summary: '尚未解开的信', evidence: quote(ch) }],
  });
  await expect(
    commitConsistencyFacts(handle.db, {
      ...make(first, '桥'),
      states: [
        { entityId: 'ent_f', field: '位置', value: '桥', confidence: 1, evidence: { ...quote(first), quote: '错' } },
      ],
    }),
  ).rejects.toThrow('证据');
  expect(await handle.db.select().from(stateFacts)).toHaveLength(0);
  await expect(
    commitConsistencyFacts(handle.db, {
      ...make(first, '桥'),
      states: [{ entityId: 'ent_foreign', field: '位置', value: '桥', confidence: 1, evidence: quote(first) }],
    }),
  ).rejects.toThrow('实体');
  await commitConsistencyFacts(handle.db, make(first, '桥'));
  const clueId = (await handle.db.select({ id: foreshadows.id }).from(foreshadows))[0]!.id;
  await commitConsistencyFacts(handle.db, { ...make(second, '山'), resolveForeshadowIds: [clueId] });
  const states = await handle.db.select().from(stateFacts);
  expect(states).toHaveLength(2);
  expect(states.find((s) => s.value === '桥')).toMatchObject({
    validToChapterId: second.id,
    supersededBy: states.find((s) => s.value === '山')?.id,
  });
  expect(await handle.db.select().from(stateChanges)).toMatchObject([
    { fromValue: '桥', toValue: '山', chapterId: second.id },
  ]);
  expect(await handle.db.select().from(relationships)).toHaveLength(2);
  expect(await handle.db.select().from(storyEvents)).toHaveLength(2);
  expect(await handle.db.select().from(foreshadows)).toHaveLength(2);
  expect((await handle.db.select().from(foreshadows)).find((f) => f.id === clueId)?.resolvedChapterId).toBe(second.id);
  expect(await handle.db.select().from(reviewItems)).toHaveLength(2);
  expect((await listEditionTimeline(handle.db, editionId)).map((event) => event.chapterIndex)).toEqual([0, 1]);
  await deleteBook(handle.db, bookId);
  expect(await handle.db.select().from(stateFacts)).toHaveLength(0);
  expect(await handle.db.select().from(sourceRefs)).toHaveLength(0);
});
