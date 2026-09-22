import { describe, expect, it } from 'vitest';
import { formatUsageReport } from '../src/commands/usage.js';

const row = {
  bookId: 'bk_1',
  bookTitle: '示例',
  editionId: 'ed_1',
  editionLabel: 'v1',
  attributor: 'llm',
  model: 'mimo',
  runs: 3,
  succeeded: 2,
  failed: 1,
  chapters: 2,
  inputTokens: 1500,
  outputTokens: 100,
  lastRunAt: new Date('2026-09-22T00:00:00Z'),
  cost: 0.0038,
};

describe('formatUsageReport', () => {
  it('says so when nothing was parsed', () => {
    expect(
      formatUsageReport({
        pricing: null,
        rows: [],
        total: { runs: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, cost: null },
      }),
    ).toEqual(['还没有解析记录。']);
  });

  it('prints prices, one line per group and a total', () => {
    const lines = formatUsageReport({
      pricing: { inputPerMillion: 2, outputPerMillion: 8, currency: 'CNY' },
      rows: [row, { ...row, attributor: 'heuristic', model: null, inputTokens: 0, outputTokens: 0, cost: null }],
      total: { runs: 6, succeeded: 4, failed: 2, inputTokens: 1500, outputTokens: 100, cost: 0.0038 },
    });
    expect(lines).toEqual([
      '单价：每百万 token 输入 2 输出 8 CNY',
      '示例 v1  llm/mimo  运行 3（成功 2 失败 1）  章 2  输入 1500  输出 100  成本 0.0038 CNY',
      '示例 v1  heuristic  运行 3（成功 2 失败 1）  章 2  输入 0  输出 0',
      '合计  运行 6（成功 4 失败 2）  输入 1500  输出 100  成本 0.0038 CNY',
    ]);
  });

  it('omits cost without prices', () => {
    const lines = formatUsageReport({
      pricing: null,
      rows: [{ ...row, cost: null }],
      total: { runs: 3, succeeded: 2, failed: 1, inputTokens: 1500, outputTokens: 100, cost: null },
    });
    expect(lines[0]).toContain('不估算成本');
    expect(lines[1]).not.toContain('成本');
  });
});
