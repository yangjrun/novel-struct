import { performance } from 'node:perf_hooks';
import type { Command } from 'commander';
import {
  type Db,
  getEdition,
  listBooks,
  listChapterSegmentCounts,
  listChapterSummaries,
  listEditionParseRuns,
} from '@novelstruct/db';
import { buildUsageReport, importBook, parseEdition } from '@novelstruct/pipeline';
import { fail, withDatabase } from '../context.js';
import { print } from '../output.js';

export interface BenchOptions {
  readonly books: number;
  readonly chapters: number;
  /** Chapters parsed per book; 0 skips the parse phase. */
  readonly parse: number;
  /** Books parsed at the same time. */
  readonly parallel: number;
}

const BENCH_LABEL = 'bench';
const BENCH_AUTHOR = '压测';

export function registerBench(program: Command): void {
  program
    .command('bench')
    .description('压测：生成合成小说批量导入，再并行解析每本的前几章，打印每个阶段的耗时。可重复运行，第二次走重复导入')
    .option('--books <n>', '书的数量', parsePositive, 100)
    .option('--chapters <n>', '每本的章数', parsePositive, 200)
    .option('--parse <n>', '每本解析的章数，0 跳过解析', parseNonNegative, 10)
    .option('--parallel <n>', '同时解析的书数', parsePositive, 4)
    .action(async (options: BenchOptions) => {
      const lines = await withDatabase((db) => runBench(db, options, print));
      lines.forEach((line) => print(line));
    });
}

/** Runs every phase and returns the summary lines; `progress` gets one line per finished phase. */
export async function runBench(db: Db, options: BenchOptions, progress: (line: string) => void): Promise<string[]> {
  const summary: string[] = [];
  const rssBefore = process.memoryUsage().rss;

  const importStart = performance.now();
  const editions: { editionId: string; bookId: string }[] = [];
  let chapters = 0;
  let chars = 0;
  let reimported = 0;
  for (let i = 1; i <= options.books; i += 1) {
    const novel = syntheticNovel(i, options.chapters);
    const result = await importBook(db, {
      bytes: new TextEncoder().encode(novel.text),
      title: novel.title,
      author: BENCH_AUTHOR,
      label: BENCH_LABEL,
      filename: `${novel.title}.txt`,
    });
    editions.push({ editionId: result.editionId, bookId: result.bookId });
    chapters += result.chapterCount;
    chars += novel.text.length;
    if (result.reimport !== undefined) reimported += 1;
    if (i % 10 === 0) progress(`  已导入 ${i}/${options.books} 本`);
  }
  const importMs = performance.now() - importStart;
  summary.push(
    `导入 ${options.books} 本 × ${options.chapters} 章：${seconds(importMs)}，平均 ${Math.round(importMs / options.books)} ms/本，共 ${chapters} 章 ${chars} 字${reimported > 0 ? `，其中 ${reimported} 本走重复导入` : ''}`,
  );
  summary.push(`导入后常驻内存增加 ${Math.round((process.memoryUsage().rss - rssBefore) / 1024 / 1024)} MB`);

  summary.push(`listBooks（${options.books} 本）：${await timed(() => listBooks(db))}`);
  const last = editions[editions.length - 1];
  if (last !== undefined) {
    summary.push(
      `版本详情查询（${options.chapters} 章）：${await timed(async () => {
        await getEdition(db, last.editionId);
        await listChapterSummaries(db, last.editionId);
        await listChapterSegmentCounts(db, last.editionId);
        await listEditionParseRuns(db, last.editionId);
      })}`,
    );
  }

  if (options.parse > 0) {
    const parseStart = performance.now();
    let blocked = 0;
    let failed = 0;
    let parsedChapters = 0;
    await runPool(editions, options.parallel, async ({ editionId }, index) => {
      const result = await parseEdition(db, { editionId, from: 0, to: options.parse - 1, workerId: `bench:${index}` });
      if (result.blockedBy !== undefined) blocked += 1;
      failed += result.failed;
      parsedChapters += result.succeeded + result.skipped;
      if ((index + 1) % 10 === 0) progress(`  已解析 ${index + 1}/${options.books} 本`);
    });
    const parseMs = performance.now() - parseStart;
    summary.push(
      `解析 ${options.books} 本 × ${options.parse} 章，并行 ${options.parallel}：${seconds(parseMs)}，平均 ${Math.round(parseMs / options.books)} ms/本，共 ${parsedChapters} 章，失败 ${failed} 章，被书锁挡回 ${blocked} 次`,
    );
  }

  summary.push(`用量汇总：${await timed(() => buildUsageReport(db))}`);
  return summary;
}

export interface SyntheticNovel {
  readonly title: string;
  readonly text: string;
}

const SURNAMES = ['沈', '顾', '林', '陆', '苏', '楚', '叶', '萧', '秦', '云'] as const;
const GIVEN = ['青崖', '小满', '知远', '明川', '晚照', '长歌', '无忧', '临风', '书宁', '照夜'] as const;

/**
 * A deterministic TXT novel: numbered chapters, each with narration and tagged dialogue between
 * two characters whose names depend on the book index, so entity resolution has real work.
 */
export function syntheticNovel(index: number, chapterCount: number): SyntheticNovel {
  const title = `压测小说${String(index).padStart(3, '0')}`;
  const a = `${SURNAMES[index % SURNAMES.length]}${GIVEN[index % GIVEN.length]}`;
  const b = `${SURNAMES[(index + 3) % SURNAMES.length]}${GIVEN[(index + 7) % GIVEN.length]}`;
  const chapters = Array.from({ length: chapterCount }, (_, i) => chapterText(i + 1, a, b));
  return { title, text: `${title}\n作者：${BENCH_AUTHOR}\n\n${chapters.join('\n\n')}\n` };
}

function chapterText(number: number, a: string, b: string): string {
  return [
    `第${chineseNumber(number)}章 第${number}天`,
    '',
    `　　${a}推开铁匠铺的门，雨水顺着斗笠边沿滴成一条线。炉火映着墙上的影子，屋里只有锤子落在铁砧上的声音。`,
    `　　“剑修好了吗？”${a}问。`,
    `　　${b}没有抬头，慢悠悠地说道：“修是修好了，可这剑再断就真的没救了。”`,
    `　　“能撑到凝气境就行。”${a}说。`,
    `　　门外传来一阵急促的脚步声，${b}放下锤子，朝门口望去。`,
  ].join('\n');
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** Chinese numerals for 1 to 9999, as chapter headings write them. */
export function chineseNumber(n: number): string {
  if (n < 10) return DIGITS[n] ?? String(n);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens === 1 ? '' : DIGITS[tens]}十${ones === 0 ? '' : DIGITS[ones]}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return `${DIGITS[hundreds]}百`;
    return `${DIGITS[hundreds]}百${rest < 10 ? `零${DIGITS[rest]}` : chineseNumber(rest).replace(/^十/, '一十')}`;
  }
  if (n < 10_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    if (rest === 0) return `${DIGITS[thousands]}千`;
    return `${DIGITS[thousands]}千${rest < 100 ? `零${chineseNumber(rest).replace(/^十/, '一十')}` : chineseNumber(rest)}`;
  }
  return String(n);
}

async function runPool<T>(
  items: readonly T[],
  parallel: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(parallel, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await work(item, index);
    }
  });
  await Promise.all(lanes);
}

async function timed(fn: () => Promise<unknown>): Promise<string> {
  const start = performance.now();
  await fn();
  return `${Math.round(performance.now() - start)} ms`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function parsePositive(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`参数必须是正整数，收到 ${value}`);
  return n;
}

function parseNonNegative(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`参数必须是非负整数，收到 ${value}`);
  return n;
}
