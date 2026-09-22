import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DbHandle,
  finishParseRun,
  getChapterByIndex,
  getEdition,
  heartbeatParseRun,
  listChapterSegments,
  listChapterSummaries,
  listEditionParseRuns,
  openDatabase,
  startParseRun,
} from '@novelstruct/db';
import {
  chooseAttributor,
  DEFAULT_MAX_ATTEMPTS,
  evaluateAttribution,
  importBook,
  parseEdition,
  parseGoldSet,
  PipelineError,
  planEditionParse,
  STALE_RUN_AFTER_MS,
  type ParseChapterEvent,
} from '../src/index.js';
import { demoEpub3 } from '../../ingest/test/helpers/build-epub.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));
const fixtureText = new TextDecoder().decode(fixture);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

let handle: DbHandle;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
});

afterAll(async () => {
  await handle.close();
});

describe('importBook', () => {
  it('rejects an empty title', async () => {
    await expect(importBook(handle.db, { bytes: fixture, title: '  ' })).rejects.toBeInstanceOf(PipelineError);
  });

  it('rejects empty bytes', async () => {
    await expect(importBook(handle.db, { bytes: new Uint8Array(), title: 'x' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('derives the source format from the filename', async () => {
    const result = await importBook(handle.db, { bytes: fixture, title: '示例', filename: 'C:/novels/demo.TXT' });
    expect(result.chapterCount).toBe(5);
    expect(result.editionId.startsWith('ed_')).toBe(true);
    expect(result.reimport).toBeUndefined();
  });

  it('re-imports the same title and label into the same edition, keeping chapter ids and parse results', async () => {
    const first = await importBook(handle.db, { bytes: fixture, title: '重复导入', author: '甲' });
    await parseEdition(handle.db, { editionId: first.editionId, from: 1, to: 1 });
    const before = await listChapterSummaries(handle.db, first.editionId);

    const edited = fixtureText
      .replace('石桥断成两截', '石桥断成了两截')
      .replace('番外 铁老的信\n', '番外 铁老的信\n\n新增的一段。\n');
    const second = await importBook(handle.db, { bytes: utf8(edited), title: '重复导入', author: '甲' });
    expect(second.bookId).toBe(first.bookId);
    expect(second.editionId).toBe(first.editionId);
    expect(second.reimport).toEqual({ kept: 3, updated: 2, added: 0, removed: 0 });

    const after = await listChapterSummaries(handle.db, first.editionId);
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    const chapterOne = await getChapterByIndex(handle.db, first.editionId, 1);
    expect((await listChapterSegments(handle.db, chapterOne!.id)).length).toBeGreaterThan(0);
    const chapterTwo = await getChapterByIndex(handle.db, first.editionId, 2);
    expect(chapterTwo?.text).toContain('石桥断成了两截');
    expect((await listEditionParseRuns(handle.db, first.editionId)).map((r) => r.chapterId)).toEqual([chapterOne!.id]);
  });

  it('creates a second edition for a new label of a known book', async () => {
    const first = await importBook(handle.db, { bytes: fixture, title: '多版本' });
    const second = await importBook(handle.db, { bytes: fixture, title: '多版本', label: 'v2' });
    expect(second.bookId).toBe(first.bookId);
    expect(second.editionId).not.toBe(first.editionId);
    expect(second.reimport).toBeUndefined();
  });

  it('keeps chapter and volume ids when a chapter is inserted at the front', async () => {
    const first = await importBook(handle.db, { bytes: fixture, title: '插章' });
    const before = await listChapterSummaries(handle.db, first.editionId);
    const beforeRows = await Promise.all(before.map((c) => getChapterByIndex(handle.db, first.editionId, c.index)));

    const withIntro = '作者的话：先说两句。\n\n' + fixtureText;
    const second = await importBook(handle.db, { bytes: utf8(withIntro), title: '插章' });
    expect(second.reimport).toEqual({ kept: 5, updated: 0, added: 1, removed: 0 });

    const after = await listChapterSummaries(handle.db, first.editionId);
    expect(after.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(after.slice(1).map((c) => c.id)).toEqual(before.map((c) => c.id));
    const afterRows = await Promise.all(after.map((c) => getChapterByIndex(handle.db, first.editionId, c.index)));
    expect(afterRows.slice(1).map((c) => c?.volumeId)).toEqual(beforeRows.map((c) => c?.volumeId));
  });

  it('imports an EPUB, taking title and author from its metadata when not given', async () => {
    const result = await importBook(handle.db, { bytes: demoEpub3(), filename: 'demo.epub' });
    expect(result).toMatchObject({ title: '示例小说', author: '示例作者', chapterCount: 6, volumeCount: 1 });
    expect(result.normalized.format).toBe('epub');
    const edition = await getEdition(handle.db, result.editionId);
    expect(edition?.edition.sourceFormat).toBe('epub');
    expect(edition?.edition.sourceFilename).toBe('demo.epub');

    const again = await importBook(handle.db, { bytes: demoEpub3() });
    expect(again.editionId).toBe(result.editionId);
    expect(again.reimport).toEqual({ kept: 6, updated: 0, added: 0, removed: 0 });

    const renamed = await importBook(handle.db, { bytes: demoEpub3(), title: '改名' });
    expect(renamed.title).toBe('改名');
    expect(renamed.bookId).not.toBe(result.bookId);
  });

  it('rejects a zip that is not an EPUB, and a TXT without a title', async () => {
    const zip = zipSync({ 'a.txt': strToU8('x') });
    await expect(importBook(handle.db, { bytes: zip })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(importBook(handle.db, { bytes: fixture })).rejects.toThrow(/书名不能为空/);
  });
});

describe('parseEdition', () => {
  it('fails to plan for an unknown edition', async () => {
    await expect(planEditionParse(handle.db, { editionId: 'ed_nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('fails to plan an inverted range', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '范围' });
    await expect(planEditionParse(handle.db, { editionId, from: 2, to: 1 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('needs llm config for the llm attributor', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '配置' });
    await expect(planEditionParse(handle.db, { editionId, attributor: 'llm' })).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('parses a range, reports events, then skips on rerun', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '解析' });
    const events: ParseChapterEvent[] = [];
    const first = await parseEdition(
      handle.db,
      { editionId, from: 1, to: 2 },
      {
        onEvent: (e) => {
          events.push(e);
        },
      },
    );
    expect(first).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0, stopped: false });
    expect(events.map((e) => e.chapter.index)).toEqual([1, 2]);

    const chapter = await getChapterByIndex(handle.db, editionId, 1);
    expect(chapter).toBeDefined();
    expect((await listChapterSegments(handle.db, chapter!.id)).length).toBeGreaterThan(0);

    const second = await parseEdition(handle.db, { editionId, from: 1, to: 2 });
    expect(second.skipped).toBe(2);
    const forced = await parseEdition(handle.db, { editionId, from: 1, to: 1, force: true });
    expect(forced.succeeded).toBe(1);
  });

  it('stops early when asked', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '取消' });
    let seen = 0;
    const result = await parseEdition(
      handle.db,
      { editionId },
      {
        onEvent: () => {
          seen += 1;
        },
        shouldStop: () => seen >= 1,
      },
    );
    expect(result.stopped).toBe(true);
    expect(result.succeeded + result.skipped + result.failed).toBe(1);
  });
});

describe('parse run recovery', () => {
  function heuristicKey() {
    const { attributor } = chooseAttributor('heuristic', undefined);
    return { pass: 'structure', attributor: attributor.name, promptVersion: attributor.promptVersion } as const;
  }

  async function collect(options: Parameters<typeof parseEdition>[1]): Promise<ParseChapterEvent[]> {
    const events: ParseChapterEvent[] = [];
    await parseEdition(handle.db, options, {
      onEvent: (e) => {
        events.push(e);
      },
    });
    return events;
  }

  it('rejects a non-positive attempt limit', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '上限校验' });
    await expect(planEditionParse(handle.db, { editionId, maxAttempts: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('skips a chapter that failed maxAttempts times until the limit is raised or forced', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '重试上限' });
    const chapter = (await getChapterByIndex(handle.db, editionId, 1))!;
    const key = heuristicKey();
    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      const runId = await startParseRun(handle.db, { editionId, chapterId: chapter.id, ...key, attempt });
      await finishParseRun(handle.db, runId, { status: 'failed', error: 'boom' });
    }

    const [skipped] = await collect({ editionId, from: 1, to: 1 });
    expect(skipped).toMatchObject({ type: 'skipped', reason: expect.stringContaining('上限') });

    const [raised] = await collect({ editionId, from: 1, to: 1, maxAttempts: DEFAULT_MAX_ATTEMPTS + 2 });
    expect(raised?.type).toBe('succeeded');
    const [forced] = await collect({ editionId, from: 1, to: 1, force: true });
    expect(forced?.type).toBe('succeeded');

    const attempts = (await listEditionParseRuns(handle.db, editionId))
      .filter((r) => r.chapterId === chapter.id)
      .map((r) => [r.attempt, r.status] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(attempts).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'failed'],
      [4, 'succeeded'],
      [5, 'succeeded'],
    ]);
  });

  it('leaves a chapter to the live process that holds it, and takes over once its heartbeat stops', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '接管' });
    const chapter = (await getChapterByIndex(handle.db, editionId, 2))!;
    const foreign = await startParseRun(handle.db, {
      editionId,
      chapterId: chapter.id,
      ...heuristicKey(),
      attempt: 1,
      workerId: 'other-host:42',
    });

    const [respected] = await collect({ editionId, from: 2, to: 2, workerId: 'me:1' });
    expect(respected).toMatchObject({ type: 'skipped', reason: expect.stringContaining('other-host:42') });

    await heartbeatParseRun(handle.db, foreign, new Date(Date.now() - 2 * STALE_RUN_AFTER_MS));
    const [taken] = await collect({ editionId, from: 2, to: 2, workerId: 'me:1' });
    expect(taken?.type).toBe('succeeded');

    const runs = (await listEditionParseRuns(handle.db, editionId)).filter((r) => r.chapterId === chapter.id);
    expect(runs.find((r) => r.id === foreign)).toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('心跳'),
    });
    expect(runs.find((r) => r.id !== foreign)).toMatchObject({ status: 'succeeded', attempt: 2, workerId: 'me:1' });
  });
});

describe('parseGoldSet', () => {
  it('parses JSON lines, skipping comments and blanks', () => {
    const items = parseGoldSet('# header\n\n{"chapter":1,"quote":"修好了","speaker":"铁老"}\n');
    expect(items).toEqual([{ chapter: 1, quote: '修好了', speaker: '铁老', aliases: [] }]);
  });

  it('reports the offending line', () => {
    expect(() => parseGoldSet('{"chapter":1}')).toThrow(/第 1 行/);
    expect(() => parseGoldSet('not json')).toThrow(/第 1 行不是合法 JSON/);
    expect(() => parseGoldSet('# only a comment')).toThrow(/没有任何条目/);
  });
});

describe('evaluateAttribution', () => {
  const gold = parseGoldSet(
    [
      '{"chapter":1,"quote":"剑修好了吗","speaker":"沈青崖","aliases":["他"]}',
      '{"chapter":1,"quote":"修是修好了","speaker":"铁老"}',
      '{"chapter":1,"quote":"能撑到凝气境就行","speaker":"沈青崖"}',
      '{"chapter":1,"quote":"青崖哥！","speaker":"顾小满"}',
      '{"chapter":2,"quote":"人在哪儿","speaker":"沈青崖"}',
      '{"chapter":2,"quote":"我不走","speaker":"顾小满"}',
    ].join('\n'),
  );

  it('scores the heuristic baseline without writing to the database', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '评测' });
    const report = await evaluateAttribution(handle.db, { editionId, gold });
    expect(report.attributor).toBe('heuristic');
    expect(report.total).toBe(6);
    expect(report.correct + report.wrong + report.unattributed).toBe(6);
    expect(report.items.find((i) => i.gold.quote === '修是修好了')).toMatchObject({
      predicted: '铁老',
      outcome: 'correct',
    });
    expect(report.items.find((i) => i.gold.quote === '剑修好了吗')).toMatchObject({
      predicted: '他',
      outcome: 'correct',
    });
    expect(report.chapters.map((c) => [c.chapter, c.total])).toEqual([
      [1, 4],
      [2, 2],
    ]);
    const chapter = await getChapterByIndex(handle.db, editionId, 1);
    expect(await listChapterSegments(handle.db, chapter!.id)).toEqual([]);
  });

  it('rejects gold quotes it cannot locate or that are ambiguous', async () => {
    const { editionId } = await importBook(handle.db, { bytes: fixture, title: '评测2' });
    await expect(
      evaluateAttribution(handle.db, {
        editionId,
        gold: parseGoldSet('{"chapter":1,"quote":"不存在的话","speaker":"x"}'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      evaluateAttribution(handle.db, { editionId, gold: parseGoldSet('{"chapter":1,"quote":"了","speaker":"x"}') }),
    ).rejects.toThrow(/occurrence/);
    await expect(
      evaluateAttribution(handle.db, { editionId, gold: parseGoldSet('{"chapter":99,"quote":"x","speaker":"x"}') }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
