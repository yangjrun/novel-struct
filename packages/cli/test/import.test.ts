import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectNovelFiles, formatBatchLine, inferredMeta } from '../src/commands/import.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'novelstruct-import-'));
  await Promise.all([
    writeFile(path.join(dir, '乙书(作者乙).txt'), 'x'),
    writeFile(path.join(dir, '甲书(作者甲).TXT'), 'x'),
    writeFile(path.join(dir, '丙书.epub'), 'x'),
    writeFile(path.join(dir, 'README.md'), 'x'),
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('collectNovelFiles', () => {
  it('expands a directory to its novel files, keeps explicit files, and drops duplicates', async () => {
    const explicit = path.join(dir, 'README.md');
    const files = await collectNovelFiles([dir, explicit, explicit]);
    expect(files.map((f) => path.basename(f))).toEqual([
      '丙书.epub',
      '甲书(作者甲).TXT',
      '乙书(作者乙).txt',
      'README.md',
    ]);
  });

  it('fails on a missing path', async () => {
    await expect(collectNovelFiles([path.join(dir, 'nope')])).rejects.toThrow(/找不到/);
  });
});

describe('inferredMeta', () => {
  it('reads TXT names and leaves EPUBs to their metadata', () => {
    expect(inferredMeta('x/甲书(作者甲).TXT')).toEqual({ title: '甲书', author: '作者甲' });
    expect(inferredMeta('x/丙书.epub')).toEqual({});
  });
});

describe('formatBatchLine', () => {
  const result = { title: '甲书', author: '作者甲', chapterCount: 12, normalized: { format: 'txt' } };

  it('reports a fresh import and a reimport', () => {
    expect(formatBatchLine('d/甲书(作者甲).txt', { ...result, reimport: undefined })).toBe(
      '导入 甲书  作者甲  txt  12 章  甲书(作者甲).txt',
    );
    expect(
      formatBatchLine('d/甲书.txt', {
        ...result,
        author: undefined,
        reimport: { kept: 10, updated: 1, added: 1, removed: 0 },
      }),
    ).toBe('更新 甲书  txt  12 章  甲书.txt（未变 10 更新 1 新增 1 删除 0）');
  });
});
