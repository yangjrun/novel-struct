import { afterAll, beforeAll, expect, it } from 'vitest';
import { ChapterIRSchema, type ChapterIR } from '@novelstruct/core';
import {
  commitChapterIR,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  type DbHandle,
  stateFacts,
  sourceRefs,
  foreshadows,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { buildConsistencyContext, estimateContextTokens } from '../src/index.js';

let handle: DbHandle;
let ir: ChapterIR;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '上下文测试' });
  const normalized = normalizeNovel(
    new TextEncoder().encode('第一章 初见\n沈青崖在桥上。\n第二章 重逢\n沈青崖再来桥上。'),
  );
  const editionId = (await importNormalizedBook(handle.db, { bookId, label: 'v1', sourceFormat: 'txt', normalized }))
    .editionId;
  const first = await getChapterByIndex(handle.db, editionId, 0);
  const second = await getChapterByIndex(handle.db, editionId, 1);
  if (!first || !second) throw new Error('missing chapter');
  const at = first.text.indexOf('沈青崖');
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId: first.id,
      charCount: first.text.length,
      scenes: [{ id: 'scn_one', index: 0, charStart: 0, charEnd: first.text.length, characterIds: ['ent_one'] }],
      segments: [
        { id: 'seg_one', sceneId: 'scn_one', index: 0, kind: 'narration', charStart: 0, charEnd: first.text.length },
      ],
      entities: [
        { id: 'ent_one', type: 'character', canonicalName: '沈青崖', aliases: [], confidence: 1, isNew: true },
      ],
      mentions: [{ entityId: 'ent_one', surface: '沈青崖', charStart: at, charEnd: at + 3 }],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
  const evidenceId = 'src_context';
  await handle.db
    .insert(sourceRefs)
    .values({ id: evidenceId, editionId, chapterId: first.id, charStart: at, charEnd: at + 3, quote: '沈青崖' });
  await handle.db.insert(stateFacts).values({
    id: 'state_context',
    bookId,
    editionId,
    entityId: 'ent_one',
    field: '位置',
    value: '石桥',
    validFromChapterId: first.id,
    confidence: 1,
    sourceRefId: evidenceId,
  });
  await handle.db.insert(foreshadows).values({
    id: 'foreshadow_context',
    bookId,
    editionId,
    plantedChapterId: first.id,
    summary: '神秘来客',
    sourceRefId: evidenceId,
  });
  const secondAt = second.text.indexOf('沈青崖');
  ir = ChapterIRSchema.parse({
    irVersion: '0.1',
    bookId,
    editionId,
    chapterId: second.id,
    charCount: second.text.length,
    scenes: [{ id: 'scn_two', index: 0, charStart: 0, charEnd: second.text.length, characterIds: ['ent_one'] }],
    segments: [
      { id: 'seg_two', sceneId: 'scn_two', index: 0, kind: 'narration', charStart: 0, charEnd: second.text.length },
    ],
    entities: [{ id: 'ent_one', type: 'character', canonicalName: '沈青崖', aliases: [], confidence: 1, isNew: false }],
    mentions: [{ entityId: 'ent_one', surface: '沈青崖', charStart: secondAt, charEnd: secondAt + 3 }],
    provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
  });
});
afterAll(async () => {
  await handle.close();
});

it('is deterministic, bounded and sees only earlier chapters in the same edition', async () => {
  const first = await buildConsistencyContext(handle.db, ir, { budget: 500 });
  const second = await buildConsistencyContext(handle.db, ir, { budget: 500 });
  expect(first).toEqual(second);
  expect(first.sections.map((s) => s.kind)).toEqual(['state', 'mention', 'foreshadow']);
  expect(first.sections[1]?.content).toContain('沈青崖');
  const tight = await buildConsistencyContext(handle.db, ir, { budget: 50 });
  expect(tight.estimatedTokens).toBeLessThanOrEqual(50);
  expect(tight.omitted).toBeGreaterThan(0);
  expect(estimateContextTokens('abc中文')).toBe(7);
  await expect(buildConsistencyContext(handle.db, ir, { budget: 0 })).rejects.toThrow('预算');
});
