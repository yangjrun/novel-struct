import { describe, expect, it } from 'vitest';
import type { EvalReport } from '@novelstruct/pipeline';
import { formatEvalReport, formatProgress } from '../src/commands/eval.js';
import { formatImportSummary } from '../src/commands/import.js';

const report: EvalReport = {
  attributor: 'heuristic',
  promptVersion: 'heuristic/0.2',
  total: 3,
  correct: 2,
  wrong: 1,
  unattributed: 0,
  accuracy: 2 / 3,
  chapters: [{ chapter: 1, chapterIndex: 1, total: 3, correct: 2, wrong: 1, unattributed: 0 }],
  items: [
    {
      gold: { chapter: 1, quote: '修好了', speaker: '铁老', aliases: [] },
      chapterIndex: 1,
      quoteText: '“修好了。”',
      expected: '铁老',
      predicted: '铁老',
      confidence: 0.6,
      outcome: 'correct',
    },
    {
      gold: { chapter: 1, quote: '走吧', speaker: '沈青崖', aliases: [] },
      chapterIndex: 1,
      quoteText: '“走吧。”',
      expected: '沈青崖',
      predicted: '铁老',
      confidence: 0.6,
      outcome: 'wrong',
    },
    {
      gold: { chapter: 1, quote: '好', speaker: '顾小满', aliases: [] },
      chapterIndex: 1,
      quoteText: '“好。”',
      expected: '顾小满',
      predicted: '顾小满',
      confidence: 0.7,
      outcome: 'correct',
    },
  ],
};

describe('formatEvalReport', () => {
  it('prints a summary and per-chapter lines', () => {
    expect(formatEvalReport(report, false)).toEqual([
      '归属器 heuristic (heuristic/0.2)',
      '金标 3 条：正确 2  错误 1  未归属 0  准确率 66.7%',
      '  第 1 章 [1]  2/3  错误 1  未归属 0',
    ]);
  });

  it('lists misses when verbose', () => {
    const lines = formatEvalReport({ ...report, model: 'gpt-x', usage: { inputTokens: 10, outputTokens: 2 } }, true);
    expect(lines[0]).toBe('归属器 heuristic (heuristic/0.2)  模型 gpt-x');
    expect(lines[1]).toContain('token 输入 10 输出 2');
    expect(lines.at(-1)).toBe('  第 1 章  期望 沈青崖  得到 铁老 (0.6)  “走吧。”');
  });
});

describe('formatProgress', () => {
  it('announces a chapter and reports its duration with warnings', () => {
    expect(
      formatProgress({ type: 'chapter_start', chapter: 2, chapterIndex: 2, charCount: 3200, goldCount: 12 }, 'llm'),
    ).toEqual(['第 2 章 [2]  3200 字，12 条金标，llm 归属中…']);
    expect(
      formatProgress({ type: 'chapter_done', chapter: 2, chapterIndex: 2, elapsedMs: 12345, warnings: ['odd'] }, 'llm'),
    ).toEqual(['第 2 章 [2]  完成，用时 12.3 s', '    ! odd']);
  });
});

describe('formatImportSummary', () => {
  const base = {
    bookId: 'bk_1',
    editionId: 'ed_1',
    chapterCount: 3,
    volumeCount: 0,
    normalized: { encoding: 'utf-8' },
  };

  it('prints two lines for a fresh import', () => {
    expect(formatImportSummary(base)).toEqual(['书籍 bk_1', '版本 ed_1  编码 utf-8  卷 0  章 3']);
  });

  it('adds a re-import line when chapter ids were reused', () => {
    expect(formatImportSummary({ ...base, reimport: { kept: 2, updated: 1, added: 0, removed: 0 } })[2]).toBe(
      '重复导入：章节 ID 已复用，未变 2  内容更新 1  新增 0  删除 0',
    );
  });
});
