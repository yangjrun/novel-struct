import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PARSE_PASSES, PARSE_RUN_STATUSES } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  createBook,
  type DbHandle,
  ensureDefaultLibrary,
  importNormalizedBook,
  listEditionParseRuns,
  listLatestEditionParseRuns,
  latestRunByChapter,
  openDatabase,
  parseRuns,
} from '../src/index.js';

const STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-01T00:01:00.000Z');
const novel = new TextEncoder().encode('第一章 出发\n甲出发了。\n第二章 相遇\n乙走来了。\n第三章 归来\n二人回家了。');

let handle: DbHandle;
let bookId: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookId = await createBook(handle.db, { libraryId, title: '最新解析测试' });
});

afterAll(async () => {
  await handle.close();
});

async function importEdition(label: string) {
  return importNormalizedBook(handle.db, {
    bookId,
    label,
    sourceFormat: 'txt',
    normalized: normalizeNovel(novel),
  });
}

function makeRun(
  editionId: string,
  chapterId: string,
  id: string,
  overrides: Partial<typeof parseRuns.$inferSelect> = {},
): typeof parseRuns.$inferSelect {
  return {
    id,
    editionId,
    chapterId,
    pass: 'structure',
    attributor: 'heuristic',
    promptVersion: 'test/1',
    model: null,
    status: 'succeeded',
    attempt: 1,
    workerId: null,
    inputTokens: null,
    outputTokens: null,
    error: null,
    startedAt: STARTED_AT,
    heartbeatAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('latest edition parse runs', () => {
  it('keeps the existing in-memory projection valid for unordered callers', () => {
    const early = makeRun('edition', 'chapter', 'early');
    const latest = makeRun('edition', 'chapter', 'latest', { startedAt: LATER });
    const equalTime = makeRun('edition', 'chapter', 'equal', { startedAt: LATER });
    expect(latestRunByChapter([]).size).toBe(0);
    expect(latestRunByChapter([early, latest, equalTime, early]).get('chapter')).toBe(latest);
  });

  it('returns no rows for an edition with unparsed chapters or a missing edition', async () => {
    const { editionId, chapterIds } = await importEdition('empty');
    expect(chapterIds).toHaveLength(3);
    expect(await listLatestEditionParseRuns(handle.db, editionId)).toEqual([]);
    expect(await listLatestEditionParseRuns(handle.db, 'ed_missing')).toEqual([]);
  });

  it('keeps editions isolated and omits chapters without runs', async () => {
    const first = await importEdition('first');
    const second = await importEdition('second');
    await handle.db
      .insert(parseRuns)
      .values([
        makeRun(first.editionId, first.chapterIds[0]!, 'run_first'),
        makeRun(second.editionId, second.chapterIds[0]!, 'run_second', { startedAt: LATER }),
      ]);

    const rows = await listLatestEditionParseRuns(handle.db, first.editionId);
    expect(rows.map(({ id, chapterId }) => ({ id, chapterId }))).toEqual([
      { id: 'run_first', chapterId: first.chapterIds[0] },
    ]);
    expect((await listLatestEditionParseRuns(handle.db, second.editionId)).map((run) => run.id)).toEqual([
      'run_second',
    ]);
  });

  it.each(PARSE_PASSES.flatMap((pass) => PARSE_RUN_STATUSES.map((status) => ({ pass, status }))))(
    'selects the newest $pass/$status run across all passes and statuses with the complete view',
    async ({ pass, status }) => {
      const { editionId, chapterIds } = await importEdition(`${pass}-${status}`);
      const prefix = `${pass}_${status}`;
      const newest = makeRun(editionId, chapterIds[0]!, `${prefix}_a_new`, {
        pass,
        status,
        attributor: 'test-attributor',
        promptVersion: 'test/2',
        model: 'test-model',
        attempt: 7,
        workerId: 'test:7',
        inputTokens: 40,
        outputTokens: 20,
        error: 'synthetic diagnostic',
        startedAt: LATER,
        heartbeatAt: LATER,
        finishedAt: LATER,
      });
      await handle.db.insert(parseRuns).values([
        makeRun(editionId, chapterIds[0]!, `${prefix}_z_old`, {
          pass: pass === 'structure' ? 'consistency' : 'structure',
          status: status === 'succeeded' ? 'failed' : 'succeeded',
        }),
        newest,
      ]);
      const { editionId: _editionId, ...expected } = newest;
      expect(await listLatestEditionParseRuns(handle.db, editionId)).toEqual([expected]);
    },
  );

  it('breaks equal start times by descending id, not insertion order', async () => {
    const { editionId, chapterIds } = await importEdition('ties');
    // The greatest id is inserted first: id order is only a stable tie-breaker, not creation time.
    for (const id of ['run_z_tie', 'run_a_tie', 'run_m_tie']) {
      await handle.db.insert(parseRuns).values(makeRun(editionId, chapterIds[0]!, id));
    }

    expect((await listLatestEditionParseRuns(handle.db, editionId)).map((run) => run.id)).toEqual(['run_z_tie']);
  });

  it('fetches three latest rows in one DISTINCT ON query while history still returns all 300 rows', async () => {
    const { editionId, chapterIds } = await importEdition('many');
    const history = chapterIds.flatMap((chapterId) =>
      Array.from({ length: 100 }, (_, i) =>
        makeRun(editionId, chapterId, `run_${chapterId}_${i}`, {
          attempt: i + 1,
          startedAt: new Date(STARTED_AT.getTime() + i * 1_000),
        }),
      ),
    );
    await handle.db.insert(parseRuns).values(history);
    const distinctQuery = vi.spyOn(handle.db, 'selectDistinctOn');
    const fullQuery = vi.spyOn(handle.db, 'select');
    try {
      const latest = await listLatestEditionParseRuns(handle.db, editionId);
      expect(distinctQuery).toHaveBeenCalledTimes(1);
      expect(distinctQuery).toHaveBeenCalledWith([parseRuns.chapterId], expect.any(Object));
      expect(fullQuery).not.toHaveBeenCalled();
      expect(latest).toHaveLength(3);
      expect(new Set(latest.map((run) => run.chapterId))).toEqual(new Set(chapterIds));
      expect(latest.every((run) => run.attempt === 100)).toBe(true);

      const all = await listEditionParseRuns(handle.db, editionId);
      expect(fullQuery).toHaveBeenCalledTimes(1);
      expect(distinctQuery).toHaveBeenCalledTimes(1);
      expect(all).toHaveLength(300);
      expect(all[0]?.startedAt).toEqual(new Date(STARTED_AT.getTime() + 99_000));
      expect(all.at(-1)?.startedAt).toEqual(STARTED_AT);
    } finally {
      distinctQuery.mockRestore();
      fullQuery.mockRestore();
    }
  });
});
