import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  createBook,
  ensureDefaultLibrary,
  entities,
  getChapterByIndex,
  importNormalizedBook,
  memoryItems,
} from '@novelstruct/db';
import { createLoggedDatabase } from '../../db/test/helpers/logged-database.js';
import { createPostgresMemoryStore, type MemoryHit } from '../src/index.js';

const handle = createLoggedDatabase();
const ENTITY_IDS = Array.from({ length: 30 }, (_, i) => `ent_batch_${String(i).padStart(2, '0')}`);
let bookId: string;
let otherBookId: string;
let editionId: string;
let otherEditionId: string;
let chapterIds: string[];

function state(entityId: string, suffix: string, from: number, to: number | null) {
  return {
    id: `${suffix}-${entityId}`,
    bookId,
    editionId,
    room: 'state',
    entityId,
    content: `${suffix}: ${entityId}`,
    validFromChapterId: chapterIds[from]!,
    validToChapterId: to === null ? null : chapterIds[to]!,
    sourceFactTable: 'state_facts',
    sourceFactId: `${suffix}-${entityId}`,
  };
}

function hit(entityId: string, suffix: string): MemoryHit {
  return {
    room: 'state',
    entityId,
    content: `${suffix}: ${entityId}`,
    sourceFactTable: 'state_facts',
    sourceFactId: `${suffix}-${entityId}`,
  };
}

beforeAll(async () => {
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookId = await createBook(handle.db, { libraryId, title: '批量状态召回' });
  otherBookId = await createBook(handle.db, { libraryId, title: '隔离书' });
  const normalized = normalizeNovel(
    new TextEncoder().encode(
      '第一章 初始\n青崖在石桥。\n第二章 此前\n青崖在山顶。\n第三章 当前\n青崖在城里。\n第四章 后来\n青崖回家。',
    ),
  );
  const edition = await importNormalizedBook(handle.db, { bookId, label: 'v1', sourceFormat: 'txt', normalized });
  editionId = edition.editionId;
  chapterIds = [...edition.chapterIds];
  otherEditionId = (await importNormalizedBook(handle.db, { bookId, label: 'v2', sourceFormat: 'txt', normalized }))
    .editionId;
  await handle.db
    .insert(entities)
    .values(ENTITY_IDS.map((id) => ({ id, bookId, type: 'character' as const, canonicalName: id, confidence: 1 })));
  await handle.db
    .insert(memoryItems)
    .values(
      ENTITY_IDS.flatMap((id) => [
        state(id, 'z', 0, null),
        state(id, 'b', 1, null),
        state(id, 'a', 1, 3),
        state(id, 'expired', 0, 2),
        state(id, 'future', 3, null),
        { ...state(id, 'event', 0, null), room: 'event' },
      ]),
    );
  const alternate = (await getChapterByIndex(handle.db, otherEditionId, 0))!;
  await handle.db.insert(memoryItems).values({
    ...state(ENTITY_IDS[0]!, 'other-edition', 0, null),
    editionId: otherEditionId,
    validFromChapterId: alternate.id,
  });
});

afterAll(async () => handle.close());

describe('batched memory state recall', () => {
  it.each([1, 10, 30])('uses two executed queries for %i entities and preserves per-entity ordering', async (count) => {
    const memory = createPostgresMemoryStore(handle.db);
    const ids = Object.freeze(ENTITY_IDS.slice(0, count).reverse());
    handle.clearQueries();
    const result = await memory.recallStates!(bookId, ids, 2, editionId);
    expect(result).toEqual(ids.flatMap((id) => ['z', 'a', 'b'].map((suffix) => hit(id, suffix))));
    expect(handle.queries).toHaveLength(2);
    expect(handle.queries[1]!.sql).toMatch(/left join/i);
    expect(handle.queries[1]!.sql).toMatch(/>\s*\$/);
  });

  it('preserves duplicate input entities, unknown entities and the single-entity API', async () => {
    const memory = createPostgresMemoryStore(handle.db);
    const ids = [ENTITY_IDS[1]!, 'ent_missing', ENTITY_IDS[0]!, ENTITY_IDS[1]!];
    const batch = await memory.recallStates!(bookId, ids, 2, editionId);
    expect(batch).toEqual(
      ids.filter((id) => id !== 'ent_missing').flatMap((id) => ['z', 'a', 'b'].map((suffix) => hit(id, suffix))),
    );
    expect(batch).toEqual((await Promise.all(ids.map((id) => memory.recallState(bookId, id, 2, editionId)))).flat());
  });

  it('also filters ended states in SQL when called through the original single-entity API', async () => {
    const memory = createPostgresMemoryStore(handle.db);
    handle.clearQueries();
    expect(await memory.recallState(bookId, ENTITY_IDS[0]!, 2, editionId)).toEqual(
      ['z', 'a', 'b'].map((suffix) => hit(ENTITY_IDS[0]!, suffix)),
    );
    expect(handle.queries).toHaveLength(2);
  });

  it.each([
    [0, ['expired', 'z']],
    [1, ['expired', 'z', 'a', 'b']],
    [2, ['z', 'a', 'b']],
    [3, ['z', 'b', 'future']],
  ] as const)('uses the original half-open validity interval at chapter %i', async (index, suffixes) => {
    const memory = createPostgresMemoryStore(handle.db);
    const result = await memory.recallStates!(bookId, [ENTITY_IDS[0]!], index, editionId);
    expect(result).toEqual(suffixes.map((suffix) => hit(ENTITY_IDS[0]!, suffix)));
  });

  it('validates scope for empty input but does not query any state rows', async () => {
    const memory = createPostgresMemoryStore(handle.db);
    handle.clearQueries();
    expect(await memory.recallStates!(bookId, [], 2, editionId)).toEqual([]);
    expect(handle.queries).toHaveLength(1);
    expect(handle.queries[0]!.sql).not.toContain('memory_items');
    await expect(memory.recallStates!(otherBookId, [], 2, editionId)).rejects.toThrow('不匹配');
  });

  it('keeps editions and books isolated', async () => {
    const memory = createPostgresMemoryStore(handle.db);
    expect(await memory.recallStates!(bookId, [ENTITY_IDS[0]!], 2, otherEditionId)).toEqual([
      hit(ENTITY_IDS[0]!, 'other-edition'),
    ]);
    await expect(memory.recallStates!(otherBookId, [ENTITY_IDS[0]!], 2, editionId)).rejects.toThrow('不匹配');
    await expect(memory.recallStates!(bookId, [ENTITY_IDS[0]!], 2, 'ed_missing')).rejects.toThrow('不匹配');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid chapter index %s before querying states',
    async (index) => {
      const memory = createPostgresMemoryStore(handle.db);
      handle.clearQueries();
      await expect(memory.recallStates!(bookId, [], index, editionId)).rejects.toThrow('index');
      expect(handle.queries).toHaveLength(1);
    },
  );
});
