import { bucketItems, type Bucket } from './bucket.js';
import { renderHeatmap } from './charts/heatmap.js';
import { renderRankedBars, type RankedBar } from './charts/ranked-bars.js';
import { renderStackedColumns } from './charts/stacked-columns.js';
import { renderStatTiles, type StatTile } from './charts/stat-tiles.js';
import { renderFigure, renderLegend } from './figure.js';
import { fmtCompact, fmtInt, fmtPct } from './html.js';
import type { ReportChapter, ReportCharacter, ReportData } from './types.js';

/** Column charts stay hit-target sized (>= 24px) by folding long books into at most this many groups. */
const MAX_COLUMNS = 30;
const TOP_SPEAKERS = 10;
const TOP_MENTIONED = 12;

export function statTiles(data: ReportData): string {
  const parsed = data.chapters.filter((c) => c.parsed);
  const totals = parsed.reduce(
    (acc, c) => ({
      resolved: acc.resolved + c.dialogue.resolved,
      surfaceOnly: acc.surfaceOnly + c.dialogue.surfaceOnly,
      unknown: acc.unknown + c.dialogue.unknown,
    }),
    { resolved: 0, surfaceOnly: 0, unknown: 0 },
  );
  const spoken = totals.resolved + totals.surfaceOnly + totals.unknown;
  const ratio = spoken === 0 ? 0 : totals.resolved / spoken;
  const tiles: StatTile[] = [
    { label: '已解析章节', value: fmtInt(parsed.length), sub: `共 ${fmtInt(data.chapters.length)} 章` },
    {
      label: '对白分段',
      value: fmtCompact(spoken),
      sub: `旁白 ${fmtCompact(sumBy(parsed, (c) => c.narrationChars))} 字，对白 ${fmtCompact(sumBy(parsed, (c) => c.spokenChars))} 字`,
    },
    {
      label: '说话人已消解到实体',
      value: fmtPct(ratio),
      meter: ratio,
      sub: `${fmtInt(totals.resolved)} / ${fmtInt(spoken)} 条`,
    },
    { label: '未知说话人', value: fmtInt(totals.unknown), sub: `仅有称呼未匹配实体 ${fmtInt(totals.surfaceOnly)} 条` },
  ];
  return renderStatTiles(tiles);
}

export function attributionFigure(chapters: readonly ReportChapter[]): string {
  const buckets = chapterBuckets(chapters);
  const series = [
    { name: '已消解到实体', role: 'status-good', icon: '✓' },
    { name: '仅有称呼', role: 'status-warning', icon: '~' },
    { name: '未知说话人', role: 'status-serious', icon: '?' },
  ];
  const { svg, table } = renderStackedColumns({
    series,
    rowHeader: '章节',
    columns: buckets.map((b) => ({
      label: b.label,
      tipTitle: bucketTitle(b),
      values: [
        sumBy(b.items, (c) => c.dialogue.resolved),
        sumBy(b.items, (c) => c.dialogue.surfaceOnly),
        sumBy(b.items, (c) => c.dialogue.unknown),
      ],
    })),
  });
  return renderFigure({
    id: 'attribution',
    title: '每章对白归属状态',
    subtitle: '对白分段数，按说话人是否消解到实体分层',
    legend: renderLegend(series),
    svg,
    table,
  });
}

export function shareFigure(chapters: readonly ReportChapter[]): string {
  const buckets = chapterBuckets(chapters);
  const series = [
    { name: '旁白', role: 'series-1' },
    { name: '对白', role: 'series-2' },
  ];
  const { svg, table } = renderStackedColumns({
    series,
    percent: true,
    rowHeader: '章节',
    columns: buckets.map((b) => ({
      label: b.label,
      tipTitle: bucketTitle(b),
      values: [sumBy(b.items, (c) => c.narrationChars), sumBy(b.items, (c) => c.spokenChars)],
    })),
  });
  return renderFigure({
    id: 'share',
    title: '每章旁白与对白字数占比',
    subtitle: '按字数归一化到 100%',
    legend: renderLegend(series),
    svg,
    table,
  });
}

export function speakersFigure(characters: readonly ReportCharacter[]): string {
  const speaking = [...characters].filter((c) => c.dialogueCount > 0).sort((a, b) => b.dialogueCount - a.dialogueCount);
  const top = speaking.slice(0, TOP_SPEAKERS);
  const rest = speaking.slice(TOP_SPEAKERS);
  const bars: RankedBar[] = [
    ...top.map((c) => ({ label: c.name, value: c.dialogueCount })),
    ...(rest.length > 0
      ? [{ label: `其他 ${rest.length} 人`, value: sumBy(rest, (c) => c.dialogueCount), role: 'other' }]
      : []),
  ];
  const { svg, table } = renderRankedBars({ bars, rowHeader: '角色', valueHeader: '对白数' });
  return renderFigure({
    id: 'speakers',
    title: '角色对白数量',
    subtitle: `已消解到实体的对白，按角色排序，最多显示 ${TOP_SPEAKERS} 人`,
    svg,
    table,
  });
}

export function mentionsFigure(chapters: readonly ReportChapter[], characters: readonly ReportCharacter[]): string {
  const buckets = chapterBuckets(chapters);
  const top = [...characters]
    .filter((c) => c.mentionCount > 0)
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, TOP_MENTIONED);
  const { svg, table, scale } = renderHeatmap({
    rows: top.map((c) => ({
      label: c.name,
      values: buckets.map((b) => sumBy(b.items, (ch) => ch.mentionsByEntity[c.id] ?? 0)),
    })),
    columns: buckets.map((b) => ({ label: b.label, tipTitle: bucketTitle(b) })),
    rowHeader: '角色',
    valueName: '提及次数',
  });
  return renderFigure({
    id: 'mentions',
    title: '角色出场分布',
    subtitle: `原文提及次数，按章节，最多显示 ${TOP_MENTIONED} 人`,
    legend: scale,
    svg,
    table,
  });
}

function chapterBuckets(chapters: readonly ReportChapter[]): Bucket<ReportChapter>[] {
  return bucketItems(
    chapters.filter((c) => c.parsed),
    MAX_COLUMNS,
    (group) => (group.length === 1 ? String(group[0]!.index) : `${group[0]!.index}-${group[group.length - 1]!.index}`),
  );
}

function bucketTitle(bucket: Bucket<ReportChapter>): string {
  const first = bucket.items[0]!;
  if (bucket.items.length === 1) return `[${first.index}] ${first.title}`;
  const last = bucket.items[bucket.items.length - 1]!;
  return `章节 ${first.index} 到 ${last.index}（${bucket.items.length} 章）`;
}

function sumBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((acc, item) => acc + value(item), 0);
}
