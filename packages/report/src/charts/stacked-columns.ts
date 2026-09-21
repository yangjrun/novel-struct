import { renderTable } from '../figure.js';
import {
  el,
  esc,
  estimateTextWidth,
  fmtInt,
  fmtPct,
  n,
  niceTicks,
  tipPayload,
  truncateToWidth,
  type TipRow,
} from '../html.js';
import { columnPath } from '../paths.js';

export interface StackedSeries {
  readonly name: string;
  readonly role: string;
}

export interface StackedColumn {
  readonly label: string;
  readonly tipTitle: string;
  /** One value per series, in series order (bottom of the stack first). */
  readonly values: readonly number[];
}

export interface StackedColumnsOptions {
  readonly series: readonly StackedSeries[];
  readonly columns: readonly StackedColumn[];
  /** Normalize every column to 100%. */
  readonly percent?: boolean;
  readonly rowHeader: string;
}

const WIDTH = 880;
const PLOT_HEIGHT = 200;
const TOP = 12;
const LEFT = 48;
const RIGHT = 88;
const AXIS_BAND = 28;
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const LABEL_FONT = 11;
const MIN_LABEL_SEGMENT = 14;
const LABEL_COLLISION = 13;
const MIN_HIT = 24;
const DIRECT_LABEL_MAX = RIGHT - 12;

interface Segment {
  readonly seriesIndex: number;
  readonly top: number;
  readonly height: number;
  readonly isTop: boolean;
}

/** Stacked column chart: 2px surface gaps between segments, rounded top, per-column hover, table twin. */
export function renderStackedColumns(opts: StackedColumnsOptions): { svg: string; table: string } {
  const { series, columns } = opts;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const band = plotWidth / Math.max(columns.length, 1);
  const barWidth = Math.max(4, Math.min(MAX_BAR, band - 2 * GAP));
  const baseline = TOP + PLOT_HEIGHT;
  const totals = columns.map((c) => c.values.reduce((a, b) => a + b, 0));
  const ticks = opts.percent ? [0, 25, 50, 75, 100] : niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] ?? 1;
  const scale = (value: number, total: number): number =>
    opts.percent ? (total === 0 ? 0 : (value / total) * PLOT_HEIGHT) : (value / top) * PLOT_HEIGHT;

  const layout = columns.map((column, i) => ({
    x: LEFT + band * i + (band - barWidth) / 2,
    segments: stackSegments(
      column.values.map((v) => scale(v, totals[i] ?? 0)),
      baseline,
    ),
  }));

  const grid = ticks
    .filter((t) => t > 0)
    .map((t) => {
      const y = n(baseline - (t / top) * PLOT_HEIGHT);
      return (
        el('line', { class: 'grid', x1: LEFT, x2: WIDTH - RIGHT, y1: y, y2: y }) +
        el('text', { class: 'tick', x: LEFT - 8, y: y + 4, 'text-anchor': 'end' }, opts.percent ? `${t}%` : fmtInt(t))
      );
    });

  const labelEvery = labelStride(
    columns.map((c) => c.label),
    band,
  );
  const xLabels = columns.flatMap((c, i) =>
    i % labelEvery === 0
      ? [
          el(
            'text',
            { class: 'tick', x: n(LEFT + band * i + band / 2), y: baseline + 18, 'text-anchor': 'middle' },
            esc(c.label),
          ),
        ]
      : [],
  );

  const marks = columns.map((column, i) => {
    const { x, segments } = layout[i]!;
    const hitWidth = Math.max(band, MIN_HIT);
    const rows: TipRow[] = series
      .map((s, k) => ({
        name: s.name,
        value: cellText(column.values[k] ?? 0, totals[i] ?? 0, opts.percent),
        role: s.role,
      }))
      .reverse();
    const tip = tipPayload(
      column.tipTitle,
      opts.percent ? rows : [...rows, { name: '合计', value: fmtInt(totals[i] ?? 0), role: 'baseline' }],
    );
    return el(
      'g',
      { class: 'hit', tabindex: 0, 'data-tip': tip },
      el('rect', {
        class: 'hit-area',
        x: n(LEFT + band * i + band / 2 - hitWidth / 2),
        y: TOP,
        width: n(hitWidth),
        height: PLOT_HEIGHT,
      }),
      ...segments.map((seg) => segmentMark(seg, x, barWidth, series[seg.seriesIndex]!.role)),
    );
  });

  const directLabels = endLabels(layout[layout.length - 1], barWidth, series);
  const svg = el(
    'svg',
    {
      viewBox: `0 0 ${WIDTH} ${TOP + PLOT_HEIGHT + AXIS_BAND}`,
      role: 'group',
      'aria-label': `${opts.rowHeader}堆叠柱状图`,
    },
    ...grid,
    el('line', { class: 'baseline', x1: LEFT, x2: WIDTH - RIGHT, y1: baseline, y2: baseline }),
    ...marks,
    ...xLabels,
    ...directLabels,
  );

  const table = renderTable(
    [opts.rowHeader, ...series.map((s) => s.name), ...(opts.percent ? [] : ['合计'])],
    columns.map((c, i) => [
      c.tipTitle,
      ...series.map((_, k) => cellText(c.values[k] ?? 0, totals[i] ?? 0, opts.percent)),
      ...(opts.percent ? [] : [fmtInt(totals[i] ?? 0)]),
    ]),
  );
  return { svg, table };
}

function stackSegments(heights: readonly number[], baseline: number): Segment[] {
  const topIndex = heights.reduce((found, h, i) => (h > 0 ? i : found), -1);
  let cursor = baseline;
  return heights.flatMap((height, seriesIndex) => {
    if (height <= 0) return [];
    const isTop = seriesIndex === topIndex;
    const trim = isTop ? 0 : GAP;
    const segment: Segment = { seriesIndex, top: cursor - height + trim, height: height - trim, isTop };
    cursor -= height;
    return segment.height > 0 ? [segment] : [];
  });
}

function segmentMark(seg: Segment, x: number, width: number, role: string): string {
  const common = { class: 'seg', 'data-role': role, style: `fill:var(--${role})` };
  return seg.isTop
    ? el('path', { ...common, d: columnPath(x, seg.top, width, seg.height, RADIUS) })
    : el('rect', { ...common, x: n(x), y: n(seg.top), width: n(width), height: n(seg.height) });
}

/** Series names beside the last column's segments; dropped entirely when any two would collide. */
function endLabels(
  last: { x: number; segments: readonly Segment[] } | undefined,
  barWidth: number,
  series: readonly StackedSeries[],
): string[] {
  if (last === undefined) return [];
  const candidates = last.segments
    .filter((s) => s.height >= MIN_LABEL_SEGMENT)
    .map((s) => ({ y: s.top + s.height / 2, name: series[s.seriesIndex]!.name }));
  const sorted = [...candidates].sort((a, b) => a.y - b.y);
  const collides = sorted.some((c, i) => i > 0 && c.y - sorted[i - 1]!.y < LABEL_COLLISION);
  if (collides) return [];
  return candidates.map((c) =>
    el(
      'text',
      { class: 'direct', x: n(last.x + barWidth + 6), y: n(c.y + 4) },
      esc(truncateToWidth(c.name, LABEL_FONT, DIRECT_LABEL_MAX)),
    ),
  );
}

function labelStride(labels: readonly string[], band: number): number {
  const widest = Math.max(...labels.map((l) => estimateTextWidth(l, LABEL_FONT)), 0) + 8;
  return Math.max(1, Math.ceil(widest / band));
}

function cellText(value: number, total: number, percent: boolean | undefined): string {
  return percent ? fmtPct(total === 0 ? 0 : value / total) : fmtInt(value);
}

/** Exposed for tests. */
export { stackSegments as stackSegmentsForTest };
