import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChapterIRSchema, type ChapterIRInput } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  commitChapterIR,
  createBook,
  type DbHandle,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  IRValidationError,
  listBooks,
  listChapterSegments,
  listChapterSummaries,
  listKnownEntities,
  openDatabase,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));

let handle: DbHandle;
let bookId: string;
let editionId: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookId = await createBook(handle.db, { libraryId, title: '示例小说', author: '示例作者' });
  const imported = await importNormalizedBook(handle.db, {
    bookId,
    label: 'v1',
    sourceFormat: 'txt',
    normalized: normalizeNovel(fixture),
  });
  editionId = imported.editionId;
});

afterAll(async () => {
  await handle.close();
});

describe('import', () => {
  it('stores the edition with its chapters', async () => {
    const books = await listBooks(handle.db);
    expect(books).toHaveLength(1);
    expect(books[0]?.editions).toEqual([{ id: editionId, label: 'v1', chapterCount: 5 }]);
    const summaries = await listChapterSummaries(handle.db, editionId);
    expect(summaries.map((c) => c.title)).toEqual([null, '断剑', '石桥', '夜谈', '铁老的信']);
  });

  it('reuses the default library', async () => {
    const first = await ensureDefaultLibrary(handle.db);
    const second = await ensureDefaultLibrary(handle.db);
    expect(first).toBe(second);
  });
});

describe('commitChapterIR', () => {
  async function chapterOne() {
    const chapter = await getChapterByIndex(handle.db, editionId, 1);
    if (chapter === undefined) throw new Error('chapter 1 missing');
    return chapter;
  }

  function wholeChapterIR(text: string, chapterId: string): ChapterIRInput {
    const at = text.indexOf('沈青崖');
    return {
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId,
      charCount: text.length,
      scenes: [{ id: 'scn_a', index: 0, charStart: 0, charEnd: text.length, characterIds: ['ent_a'] }],
      segments: [{ id: 'seg_a', sceneId: 'scn_a', index: 0, kind: 'narration', charStart: 0, charEnd: text.length }],
      entities: [
        { id: 'ent_a', type: 'character', canonicalName: '沈青崖', aliases: ['青崖哥'], isNew: true, confidence: 0.9 },
      ],
      mentions: [{ entityId: 'ent_a', surface: '沈青崖', charStart: at, charEnd: at + 3 }],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    };
  }

  it('writes scenes, segments, entities and evidence', async () => {
    const chapter = await chapterOne();
    const summary = await commitChapterIR(handle.db, ChapterIRSchema.parse(wholeChapterIR(chapter.text, chapter.id)));
    expect(summary).toEqual({ scenes: 1, segments: 1, newEntities: 1, mentions: 1 });

    const segments = await listChapterSegments(handle.db, chapter.id);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(chapter.text);

    const known = await listKnownEntities(handle.db, bookId);
    expect(known).toEqual([{ id: 'ent_a', type: 'character', canonicalName: '沈青崖', aliases: ['青崖哥'] }]);
  });

  it('replaces a previous structure pass instead of duplicating it', async () => {
    const chapter = await chapterOne();
    const ir = ChapterIRSchema.parse({
      ...wholeChapterIR(chapter.text, chapter.id),
      entities: [
        { id: 'ent_a', type: 'character', canonicalName: '沈青崖', aliases: ['青崖'], isNew: false, confidence: 0.9 },
      ],
    });
    await commitChapterIR(handle.db, ir);
    expect(await listChapterSegments(handle.db, chapter.id)).toHaveLength(1);
    const known = await listKnownEntities(handle.db, bookId);
    expect([...(known[0]?.aliases ?? [])].sort()).toEqual(['青崖', '青崖哥']);
  });

  it('rejects an IR that does not match the stored text', async () => {
    const chapter = await chapterOne();
    const ir = ChapterIRSchema.parse({
      ...wholeChapterIR(chapter.text, chapter.id),
      charCount: chapter.text.length - 1,
    });
    await expect(commitChapterIR(handle.db, ir)).rejects.toBeInstanceOf(IRValidationError);
  });
});
