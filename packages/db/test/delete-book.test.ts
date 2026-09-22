import { readFileSync } from 'node:fs';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChapterIRSchema, type ChapterIRInput } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  acquireBookLock,
  bookEditions,
  bookLocks,
  books,
  chapters,
  commitChapterIR,
  createBook,
  type DbHandle,
  deleteBook,
  ensureDefaultLibrary,
  entities,
  entityAliases,
  entityMentions,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  parseRuns,
  scenes,
  segments,
  sourceRefs,
  startParseRun,
  volumes,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));

let handle: DbHandle;
let bookA: string;
let bookB: string;

/** One scene, one narration segment, one new entity with an alias and a mention. */
async function parseChapterOne(bookId: string, editionId: string, entityId: string): Promise<void> {
  const chapter = await getChapterByIndex(handle.db, editionId, 1);
  if (chapter === undefined) throw new Error('chapter 1 missing');
  const at = chapter.text.indexOf('沈青崖');
  const sceneId = `scn_${entityId}`;
  const ir: ChapterIRInput = {
    irVersion: '0.1',
    bookId,
    editionId,
    chapterId: chapter.id,
    charCount: chapter.text.length,
    scenes: [{ id: sceneId, index: 0, charStart: 0, charEnd: chapter.text.length, characterIds: [entityId] }],
    segments: [
      { id: `seg_${entityId}`, sceneId, index: 0, kind: 'narration', charStart: 0, charEnd: chapter.text.length },
    ],
    entities: [
      { id: entityId, type: 'character', canonicalName: '沈青崖', aliases: ['青崖哥'], isNew: true, confidence: 0.9 },
    ],
    mentions: [{ entityId, surface: '沈青崖', charStart: at, charEnd: at + 3 }],
    provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
  };
  await startParseRun(handle.db, {
    editionId,
    chapterId: chapter.id,
    pass: 'structure',
    attributor: 'test',
    promptVersion: 'test/0',
    attempt: 1,
    workerId: 'h:1',
  });
  await commitChapterIR(handle.db, ChapterIRSchema.parse(ir));
}

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookA = await createBook(handle.db, { libraryId, title: '甲' });
  bookB = await createBook(handle.db, { libraryId, title: '乙' });
  const normalized = normalizeNovel(fixture);
  const a = await importNormalizedBook(handle.db, { bookId: bookA, label: 'v1', sourceFormat: 'txt', normalized });
  await importNormalizedBook(handle.db, { bookId: bookA, label: 'v2', sourceFormat: 'txt', normalized });
  const b = await importNormalizedBook(handle.db, { bookId: bookB, label: 'v1', sourceFormat: 'txt', normalized });
  await parseChapterOne(bookA, a.editionId, 'ent_a');
  await parseChapterOne(bookB, b.editionId, 'ent_b');
  await acquireBookLock(handle.db, { bookId: bookA, owner: 'x', workerId: 'h:1', staleAfterMs: 1000 });
});

afterAll(async () => {
  await handle.close();
});

const tables = {
  bookEditions,
  volumes,
  chapters,
  parseRuns,
  scenes,
  segments,
  entities,
  entityAliases,
  entityMentions,
  sourceRefs,
  bookLocks,
};

async function rowCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await handle.db.select({ n: count() }).from(table);
    out[name] = row?.n ?? 0;
  }
  return out;
}

describe('deleteBook', () => {
  it('removes every row of the book and nothing of another book', async () => {
    const before = await rowCounts();
    expect(before).toMatchObject({
      bookEditions: 3,
      chapters: 15,
      parseRuns: 2,
      scenes: 2,
      segments: 2,
      entities: 2,
      entityAliases: 2,
      entityMentions: 2,
      sourceRefs: 2,
      bookLocks: 1,
    });

    const result = await deleteBook(handle.db, bookA);
    expect(result).toEqual({ bookId: bookA, title: '甲', editions: 2, chapters: 10 });

    // Exactly book B's rows remain.
    expect(await rowCounts()).toMatchObject({
      bookEditions: 1,
      chapters: 5,
      parseRuns: 1,
      scenes: 1,
      segments: 1,
      entities: 1,
      entityAliases: 1,
      entityMentions: 1,
      sourceRefs: 1,
      bookLocks: 0,
    });
    expect(await handle.db.select({ id: books.id }).from(books)).toEqual([{ id: bookB }]);
    expect((await handle.db.select({ id: entities.id }).from(entities).where(eq(entities.bookId, bookB)))[0]?.id).toBe(
      'ent_b',
    );
  });

  it('returns undefined for a missing book', async () => {
    expect(await deleteBook(handle.db, bookA)).toBeUndefined();
  });
});
