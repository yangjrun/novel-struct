import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { fitContext } from '@novelstruct/knowledge';
import type { MemoryHit, MemoryStore } from '@novelstruct/memory';
import { createParserRetrieval, recallParserContext } from '../src/parser-context.js';

const CAST = Array.from({ length: 31 }, (_, i) => ({
  id: `entity-${i}`,
  canonicalName: `角色_${String(i).padStart(2, '0')}`,
}));
let handle: DbHandle;
let bookId: string;
let editionId: string;
let chapterIds: string[];

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '召回兼容' });
  const edition = await importNormalizedBook(handle.db, {
    bookId,
    label: 'v1',
    sourceFormat: 'txt',
    normalized: normalizeNovel(
      new TextEncoder().encode(
        `第一章 初始\n开场。\n第二章 相遇\n${CAST.map((entity) => entity.canonicalName).join('、')}碰面。\n第三章 空场\n没有角色出场。`,
      ),
    ),
  });
  editionId = edition.editionId;
  chapterIds = [...edition.chapterIds];
});

afterAll(async () => handle.close());

function stateHit(entityId: string, content = `状态 ${entityId}`): MemoryHit {
  return { room: 'state', entityId, content, sourceFactTable: 'state_facts', sourceFactId: `state-${entityId}` };
}

function memoryFixture(batch: boolean) {
  return {
    recallState: vi.fn<MemoryStore['recallState']>(async (_bookId, entityId) => [stateHit(entityId)]),
    recallSimilar: vi.fn<MemoryStore['recallSimilar']>(async () => [
      stateHit(CAST[0]!.id, '相似记忆更新'),
      stateHit('extra'),
    ]),
    rebuild: vi.fn<MemoryStore['rebuild']>(async () => 0),
    ...(batch
      ? {
          recallStates: vi.fn(
            async (_bookId: string, entityIds: readonly string[], _index: number, _editionId: string) =>
              entityIds.map((id) => stateHit(id)),
          ),
        }
      : {}),
  };
}

describe('parser memory batching compatibility', () => {
  it('does not configure external retrieval clients without explicit environment settings', () => {
    expect(createParserRetrieval({})).toEqual({});
  });

  it('prefers one bulk call, preserves deduplication order and produces the same budgeted context', async () => {
    const input = [CAST[2]!, CAST[0]!, CAST[1]!];
    const batch = memoryFixture(true);
    const legacy = memoryFixture(false);
    const actual = await recallParserContext(handle.db, chapterIds[1]!, input, { memory: batch });
    const previous = await recallParserContext(handle.db, chapterIds[1]!, input, { memory: legacy });
    expect(batch.recallStates).toHaveBeenCalledExactlyOnceWith(
      bookId,
      input.map((entity) => entity.id),
      0,
      editionId,
    );
    expect(batch.recallState).not.toHaveBeenCalled();
    expect(legacy.recallState).toHaveBeenCalledTimes(3);
    expect(actual).toEqual([
      { kind: 'memory', reference: 'state-entity-2', content: 'state_facts entity-2: 状态 entity-2' },
      { kind: 'memory', reference: 'state-entity-0', content: 'state_facts entity-0: 相似记忆更新' },
      { kind: 'memory', reference: 'state-entity-1', content: 'state_facts entity-1: 状态 entity-1' },
      { kind: 'memory', reference: 'state-extra', content: 'state_facts extra: 状态 extra' },
    ]);
    expect(actual).toEqual(previous);
    for (const budget of [50, 200, 3000]) expect(fitContext(actual, budget)).toEqual(fitContext(previous, budget));
    expect(batch.recallSimilar).toHaveBeenCalledExactlyOnceWith(bookId, expect.any(String), 20, editionId, 0);
  });

  it('keeps the 30-entity selection order and never includes names absent from the chapter', async () => {
    const memory = memoryFixture(true);
    const input = [{ id: 'absent', canonicalName: '未出场名字' }, ...CAST.slice().reverse()];
    await recallParserContext(handle.db, chapterIds[1]!, input, { memory });
    expect(memory.recallStates).toHaveBeenCalledExactlyOnceWith(
      bookId,
      CAST.slice()
        .reverse()
        .slice(0, 30)
        .map((entity) => entity.id),
      0,
      editionId,
    );
    expect(memory.recallState).not.toHaveBeenCalled();
  });

  it('does not call either state API when no entity is involved, but still recalls similar memory', async () => {
    const memory = memoryFixture(true);
    await recallParserContext(handle.db, chapterIds[2]!, CAST, { memory });
    expect(memory.recallStates).not.toHaveBeenCalled();
    expect(memory.recallState).not.toHaveBeenCalled();
    expect(memory.recallSimilar).toHaveBeenCalledOnce();
  });

  it('keeps the first chapter free of memory and evidence requests', async () => {
    const memory = memoryFixture(true);
    const search = vi.fn();
    expect(await recallParserContext(handle.db, chapterIds[0]!, CAST, { memory, weknora: { search } })).toEqual([]);
    expect(memory.recallStates).not.toHaveBeenCalled();
    expect(memory.recallState).not.toHaveBeenCalled();
    expect(memory.recallSimilar).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('propagates a bulk failure instead of masking it by retrying each entity', async () => {
    const memory = memoryFixture(true);
    memory.recallStates!.mockRejectedValueOnce(new Error('批量召回失败'));
    await expect(recallParserContext(handle.db, chapterIds[1]!, CAST, { memory })).rejects.toThrow('批量召回失败');
    expect(memory.recallState).not.toHaveBeenCalled();
  });

  it('reports a missing chapter before calling an injected memory store', async () => {
    const memory = memoryFixture(true);
    await expect(recallParserContext(handle.db, 'chapter_missing', [], { memory })).rejects.toThrow('章节不存在');
    expect(memory.recallSimilar).not.toHaveBeenCalled();
    expect(await getChapterByIndex(handle.db, editionId, 1)).toBeDefined();
  });
});
