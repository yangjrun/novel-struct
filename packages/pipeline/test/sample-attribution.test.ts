import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createBook,
  ensureDefaultLibrary,
  getChapterByNumber,
  importNormalizedBook,
  openDatabase,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { extractQuotes } from '@novelstruct/parser';
import { paragraphsFromText } from '@novelstruct/ingest';
import { formatAttributionDrafts, sampleAttributionDrafts } from '../src/sample-attribution.js';
import { parseGoldSet } from '../src/gold.js';

let handle: DbHandle;
let editionId: string;
beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const bookId = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title: '抽样测试' });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(
        new TextEncoder().encode(
          [
            '作者的话：给大家打个招呼。',
            '第一章 初见',
            '“早上好。”他说。',
            '她回道：“早上好。”',
            '“你好吗？”',
            '“晚安。”',
            '第二章 再见',
            '“第二章你好。”',
            '“欢迎回来。”',
          ].join('\n'),
        ),
      ),
    })
  ).editionId;
});
afterAll(async () => {
  await handle.close();
});

it('selects stable quotes by heading number and excludes an already labelled occurrence', async () => {
  const firstChapter = (await getChapterByNumber(handle.db, editionId, 1))!;
  const quotes = extractQuotes(firstChapter.text, paragraphsFromText(firstChapter.text)).quotes;
  expect(quotes.map((q) => q.inner)).toEqual(['早上好。', '早上好。', '你好吗？', '晚安。']);
  const gold = parseGoldSet('{"chapter":1,"quote":"早上好。","occurrence":1,"speaker":"甲"}');
  const options = { editionId, from: 1, to: 2, perChapter: 3, gold };
  const drafts = await sampleAttributionDrafts(handle.db, options);
  expect(drafts).toEqual(await sampleAttributionDrafts(handle.db, options));
  expect(drafts.map((item) => [item.chapter, item.quote, item.occurrence])).toEqual([
    [1, '早上好。', 2],
    [1, '你好吗？', undefined],
    [1, '晚安。', undefined],
    [2, '第二章你好。', undefined],
    [2, '欢迎回来。', undefined],
  ]);
  expect(drafts.every((item) => item.speaker === null && item.context.includes(item.quote))).toBe(true);
  expect(() => parseGoldSet(formatAttributionDrafts(drafts))).toThrow('speaker');
  const reviewed = formatAttributionDrafts(drafts)
    .split('\n')
    .map((line) => {
      if (!line || line.startsWith('#')) return line;
      return JSON.stringify({ ...JSON.parse(line), speaker: '甲' });
    })
    .join('\n');
  expect(parseGoldSet(reviewed).map((item) => [item.chapter, item.quote, item.occurrence, item.speaker])).toEqual(
    drafts.map((item) => [item.chapter, item.quote, item.occurrence, '甲']),
  );
});

it('rejects missing chapters, invalid ranges and ambiguous existing gold without guessing', async () => {
  await expect(sampleAttributionDrafts(handle.db, { editionId, from: 0 })).rejects.toMatchObject({
    code: 'invalid_input',
  });
  await expect(sampleAttributionDrafts(handle.db, { editionId, from: 1, to: 3 })).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(
    sampleAttributionDrafts(handle.db, {
      editionId,
      from: 1,
      to: 1,
      gold: parseGoldSet('{"chapter":1,"quote":"早上好。","speaker":"甲"}'),
    }),
  ).rejects.toThrow('不唯一');
});
