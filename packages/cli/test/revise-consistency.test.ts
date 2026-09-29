import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getChapterByIndex, openDatabase, type Db, type DbHandle } from '@novelstruct/db';
import { importBook, reviewConsistencyPreview } from '@novelstruct/pipeline';
import { registerParse } from '../src/commands/parse.js';

let handle: DbHandle;
let dir: string;
vi.mock('../src/context.js', async (original) => ({
  ...(await original<object>()),
  withDatabase: (fn: (db: Db) => Promise<unknown>) => fn(handle.db),
}));
vi.mock('../src/output.js', () => ({ print: vi.fn(), printError: vi.fn() }));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'novelstruct-revision-'));
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const book = await importBook(handle.db, {
    title: '修订命令',
    bytes: new TextEncoder().encode('第一章 初遇\n下雨了。'),
  });
  const chapter = (await getChapterByIndex(handle.db, book.editionId, 0))!;
  const preview = {
    chapterId: chapter.id,
    editionId: book.editionId,
    promptVersion: 'consistency-pass/0.3',
    model: 'test',
    facts: {
      states: [],
      relationships: [],
      foreshadows: [],
      resolveForeshadowIds: [],
      events: [
        {
          type: '天气',
          summary: '下雨',
          evidence: { quote: chapter.text, charStart: 0, charEnd: chapter.text.length },
        },
      ],
    },
  };
  const report = await reviewConsistencyPreview(handle.db, preview, {
    model: 'test',
    async choose() {
      return {};
    },
  });
  await writeFile(path.join(dir, 'preview.json'), JSON.stringify(preview));
  await writeFile(
    path.join(dir, 'patch.json'),
    JSON.stringify({
      sourceHash: report.sourceHash,
      previewHash: report.previewHash,
      editor: '测试编辑者',
      revisions: [
        {
          key: 'events:0',
          candidateHash: report.items[0]!.candidateHash,
          reason: '缩小摘要',
          replacement: { ...preview.facts.events[0], summary: '下雨了' },
        },
      ],
    }),
  );
});
afterAll(async () => {
  await handle.close();
  await rm(dir, { recursive: true, force: true });
});

function run(output: string, revisionFile = path.join(dir, 'patch.json')) {
  const program = new Command().exitOverride();
  registerParse(program);
  return program.parseAsync(['revise-consistency', path.join(dir, 'preview.json'), revisionFile, '--output', output], {
    from: 'user',
  });
}

it('writes an audited revision through the command and refuses to overwrite either input or output', async () => {
  const output = path.join(dir, 'revised.json');
  const original = await readFile(path.join(dir, 'preview.json'), 'utf8');
  await run(output);
  const saved = await readFile(output, 'utf8');
  expect(JSON.parse(saved)).toMatchObject({
    facts: { events: [{ summary: '下雨了' }] },
    revision: { editor: '测试编辑者', humanReview: 'pending' },
  });
  await expect(run(output)).rejects.toThrow('已存在');
  await expect(run(path.join(dir, 'preview.json'))).rejects.toThrow('已存在');
  const patch = await readFile(path.join(dir, 'patch.json'), 'utf8');
  await expect(run(path.join(dir, 'patch.json'))).rejects.toThrow('已存在');
  expect(await readFile(path.join(dir, 'patch.json'), 'utf8')).toBe(patch);
  expect(await readFile(output, 'utf8')).toBe(saved);
  expect(await readFile(path.join(dir, 'preview.json'), 'utf8')).toBe(original);
});

it('reports malformed revision JSON and does not create an output', async () => {
  const revisionFile = path.join(dir, 'invalid.json');
  const output = path.join(dir, 'invalid-output.json');
  await writeFile(revisionFile, '{');
  await expect(run(output, revisionFile)).rejects.toThrow('不是合法 JSON');
  await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
});
