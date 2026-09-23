import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  commitChapterIR,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  setVoiceProfile,
  type DbHandle,
} from '@novelstruct/db';
import { buildChapterTtsTasks, tasksFromIR } from '../src/index.js';

let handle: DbHandle;
let bookId: string;
let chapterId: string;
let ir: ReturnType<typeof ChapterIRSchema.parse>;
let text: string;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '有声测试' });
  const editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode('第一章 问候\n青崖说：“你好。”')),
    })
  ).editionId;
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  chapterId = chapter.id;
  text = chapter.text;
  const start = text.indexOf('“');
  ir = ChapterIRSchema.parse({
    irVersion: '0.1',
    bookId,
    editionId,
    chapterId,
    charCount: text.length,
    scenes: [{ id: 'scn_tts', index: 0, charStart: 0, charEnd: text.length, characterIds: ['ent_tts'] }],
    segments: [
      { id: 'seg_narrator', index: 0, sceneId: 'scn_tts', kind: 'narration', charStart: 0, charEnd: start },
      {
        id: 'seg_voice',
        index: 1,
        sceneId: 'scn_tts',
        kind: 'dialogue',
        charStart: start,
        charEnd: text.length,
        speaker: { entityId: 'ent_tts', surface: '青崖', confidence: 1 },
      },
    ],
    entities: [{ id: 'ent_tts', type: 'character', canonicalName: '青崖', aliases: [], isNew: true, confidence: 1 }],
    mentions: [
      { entityId: 'ent_tts', surface: '青崖', charStart: text.indexOf('青崖'), charEnd: text.indexOf('青崖') + 2 },
    ],
    provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
  });
  await commitChapterIR(handle.db, ir);
  await setVoiceProfile(handle.db, {
    bookId,
    entityId: 'ent_tts',
    provider: 'test',
    voiceId: 'male1',
    params: { speed: 1 },
  });
});
afterAll(async () => {
  await handle.close();
});

it('generates ordered full-coverage tasks from IR and the stored chapter, with voice mappings', async () => {
  const options = { narratorVoice: { provider: 'test', voiceId: 'narrator' } };
  const expected = tasksFromIR(
    ir,
    text,
    new Map([['ent_tts', { provider: 'test', voiceId: 'male1', params: { speed: 1 } }]]),
    options,
  );
  const actual = await buildChapterTtsTasks(handle.db, chapterId, bookId, options);
  expect(actual.map((task) => task.text).join('')).toBe(text);
  expect(actual.map((task) => task.id)).toEqual(expected.map((task) => task.id));
  expect(actual.map((task) => task.voice?.voiceId)).toEqual(['narrator', 'male1']);
  await expect(buildChapterTtsTasks(handle.db, chapterId, 'bk_wrong')).rejects.toThrow('不属于');
});
