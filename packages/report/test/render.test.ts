import { describe, expect, it } from 'vitest';
import { aggregateReport, renderReport, type AggregateInput } from '../src/index.js';

function input(overrides: Partial<AggregateInput> = {}): AggregateInput {
  return {
    bookTitle: '示例<小说>',
    author: '作者 & 编辑',
    editionId: 'ed_1',
    editionLabel: 'v1',
    generatedAt: '2026-09-20T00:00:00.000Z',
    chapters: Array.from({ length: 3 }, (_, i) => ({
      id: `chp_${i}`,
      index: i,
      kind: 'chapter' as const,
      number: i + 1,
      title: `第${i + 1}章`,
      charCount: 100,
    })),
    segments: [0, 1, 2].flatMap((i) => [
      {
        chapterId: `chp_${i}`,
        kind: 'narration' as const,
        charStart: 0,
        charEnd: 60,
        speakerEntityId: null,
        speakerSurface: null,
      },
      {
        chapterId: `chp_${i}`,
        kind: 'dialogue' as const,
        charStart: 60,
        charEnd: 80,
        speakerEntityId: 'ent_a',
        speakerSurface: '甲',
      },
      {
        chapterId: `chp_${i}`,
        kind: 'dialogue' as const,
        charStart: 80,
        charEnd: 90,
        speakerEntityId: null,
        speakerSurface: '他',
      },
      {
        chapterId: `chp_${i}`,
        kind: 'dialogue' as const,
        charStart: 90,
        charEnd: 100,
        speakerEntityId: null,
        speakerSurface: '[unknown]',
      },
    ]),
    mentions: [
      { chapterId: 'chp_0', entityId: 'ent_a', count: 4 },
      { chapterId: 'chp_2', entityId: 'ent_b', count: 1 },
    ],
    entities: [
      { id: 'ent_a', type: 'character', canonicalName: '甲' },
      { id: 'ent_b', type: 'character', canonicalName: '乙 <script>' },
    ],
    ...overrides,
  };
}

const tipPayloads = (html: string): unknown[] =>
  [...html.matchAll(/data-tip="([^"]*)"/g)].map((m) =>
    JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')),
  );

describe('renderReport', () => {
  const html = renderReport(aggregateReport(input()));

  it('is a complete standalone document with the four figures and the kpi row', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const id of ['attribution', 'share', 'speakers', 'mentions']) {
      expect(html).toContain(`<figure class="card" id="${id}">`);
    }
    expect(html).toContain('class="kpis"');
    expect(html).not.toContain('src=');
  });

  it('escapes every user derived string', () => {
    expect(html).not.toContain('乙 <script>');
    expect(html).toContain('乙 &lt;script&gt;');
    expect(html).toContain('示例&lt;小说&gt;');
    expect(html).toContain('作者 &amp; 编辑');
  });

  it('gives every chart a table twin and a legend where there are two or more series', () => {
    expect(html.match(/class="table-view" hidden/g)).toHaveLength(4);
    expect(html.match(/<ul class="legend">/g)).toHaveLength(2);
    expect(html).toContain('class="scale"');
  });

  it('carries hover payloads as JSON with value, name and role per row', () => {
    const payloads = tipPayloads(html) as { title: string; rows: [string, string, string][] }[];
    expect(payloads.length).toBeGreaterThan(10);
    const attribution = payloads.find((p) => p.title === '[0] 第1章' && p.rows.some((r) => r[0] === '未知说话人'));
    expect(attribution?.rows.map((r) => r[0])).toEqual(['未知说话人', '仅有称呼', '已消解到实体', '合计']);
    expect(attribution?.rows.every((r) => /^[a-z0-9-]+$/.test(r[2]))).toBe(true);
  });

  it('shows the resolved ratio as a meter', () => {
    expect(html).toContain('aria-valuenow="33"');
  });

  it('renders an empty state when nothing has been parsed', () => {
    const empty = renderReport(aggregateReport(input({ segments: [], mentions: [] })));
    expect(empty).toContain('class="card empty"');
    expect(empty).not.toContain('id="attribution"');
  });

  it('folds long books into at most thirty columns', () => {
    const many = input({
      chapters: Array.from({ length: 200 }, (_, i) => ({
        id: `chp_${i}`,
        index: i,
        kind: 'chapter' as const,
        number: i + 1,
        title: null,
        charCount: 10,
      })),
      segments: Array.from({ length: 200 }, (_, i) => ({
        chapterId: `chp_${i}`,
        kind: 'narration' as const,
        charStart: 0,
        charEnd: 10,
        speakerEntityId: null,
        speakerSurface: null,
      })),
      mentions: [],
    });
    const out = renderReport(aggregateReport(many));
    const shareHits = out.slice(out.indexOf('id="share"'), out.indexOf('id="speakers"')).match(/class="hit"/g) ?? [];
    expect(shareHits.length).toBeLessThanOrEqual(30);
    expect(out).toContain('章节 0 到 6（7 章）');
  });
});
